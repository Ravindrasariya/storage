// Actual source components, authenticated synthetic local-development fixtures.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, type Browser } from "playwright";
import { auth, cleanup, farmerId, id, lot, pool, setup, token, legacySaleFixture } from "./tulai-fixtures.mts";

const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
let browser: Browser | undefined;
try {
  await setup();
  const buyerA = randomUUID(), buyerB = randomUUID();
  for (const [buyer, name, initials] of [[buyerA, "Sauda Existing A", "AB"], [buyerB, "Sauda Existing B", null]]) {
    await pool.query(`INSERT INTO buyer_ledger (id,cold_storage_id,buyer_id,buyer_name,initials)
      VALUES ($1,$2,$1::varchar,$3,$4)`, [buyer, id, name, initials]);
  }
  const markerLot = await lot("SAUDA"), mixedLot = await lot("MIXED"), zeroLot = await lot("ZERO"), masterLot = await lot("MASTER");
  const mixedSale = await legacySaleFixture(mixedLot);
  const zeroSale = await legacySaleFixture(zeroLot);
  await pool.query(`UPDATE lots SET remaining_size=0 WHERE id=$1`, [zeroLot]);
  async function api(path: string, body?: object, method = "GET") {
    const response = await fetch(base + path, { method, headers: auth, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.ok(response.ok, `${path}: ${await response.clone().text()}`);
    return response.json();
  }
  await api(`/api/sales-history/${mixedSale.id}/exits`, { bagsExited: 4, exitDate: "2016-06-16" }, "POST");
  const master = await api("/api/farmers/master-nikasi", { farmerLedgerId: farmerId,
    exitDate: "2016-06-15", rows: [{ lotId: masterLot, soldBags: 20, exitBags: 3 }] }, "POST");
  const masterSale = { id: master.sales[0].saleId };
  const lots = (await api("/api/lots")).lots;
  const info = lots.find((l: any) => l.id === markerLot);
  const wrappers = lots.filter((l: any) => [markerLot, mixedLot, zeroLot, masterLot].includes(l.id))
    .map((l: any) => ({ lot: l, lotPaidCharge: 0, lotDueCharge: l.totalDueCharge || 0, expectedColdCharge: l.remainingSize * 60 }));
  browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Kolkata" });
  await context.addInitScript("window.__name=(fn)=>fn;");
  await context.addInitScript(value => {
    localStorage.setItem("cold_store_auth_token", value);
    localStorage.setItem("language", "en");
  }, token);
  const page = await context.newPage();
  const errors: string[] = [];
  const requests: { path: string; method: string; body: any }[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base, { waitUntil: "networkidle" });
  page.on("request", request => {
    if (request.url().includes("/api/")) requests.push({
      path: new URL(request.url()).pathname, method: request.method(),
      body: request.method() === "POST" ? request.postDataJSON() : undefined,
    });
  });
  const field = (testId: string) => page.getByTestId(testId);
  async function mount(component: string, props: object) {
    await page.evaluate(async ({ component, props }) => {
      const dependency = (name: string) => {
        const entry = performance.getEntriesByType("resource")
          .find(entry => entry.name.includes(`/deps/${name}?`) || entry.name.endsWith(`/deps/${name}`));
        if (!entry) throw new Error(`Dependency not loaded: ${name}`);
        return entry.name;
      };
      const React = (await import(dependency("react.js"))).default;
      const ReactDOM = await import(dependency("react-dom_client.js"));
      const { QueryClientProvider } = await import(dependency("@tanstack_react-query.js"));
      const { queryClient } = await import("/src/lib/queryClient.ts");
      const { I18nProvider } = await import("/src/lib/i18n.tsx");
      const { AuthProvider } = await import("/src/lib/auth.tsx");
      const mod = await import(`/src/components/${component}.tsx`);
      const win = window as any;
      win.saudaRoot?.unmount();
      let container = document.getElementById("sauda-check");
      if (!container) {
        container = document.createElement("div"); container.id = "sauda-check";
        document.body.replaceChildren(container);
      }
      win.saudaRoot = (ReactDOM.createRoot ?? ReactDOM.default.createRoot)(container);
      const h = React.createElement;
      const callbacks = {
        onOpenChange: () => { win.saudaClosed = true; }, onEdit: () => {},
        onSale: () => {}, onExitSale: (saleId: string) => { win.lastExitSale = saleId; },
        onEditSale: () => {}, onPrintSale: () => {},
      };
      win.saudaClosed = false;
      win.saudaRoot.render(h(QueryClientProvider, { client: queryClient }, h(I18nProvider, null,
        h(AuthProvider, null, h(mod[component], { ...props, ...callbacks, open: true })))));
    }, { component, props });
    await page.waitForTimeout(350);
  }
  await mount("SaleDialog", { lot: info });
  await field("select-sauda-buyer").waitFor();
  const dialog = page.getByRole("dialog");
  assert.equal(await dialog.locator("input").count(), 1);
  assert.equal(await dialog.getByRole("combobox").count(), 1);
  assert.equal(await dialog.getByRole("button").count(), 2, "Only Cancel and Submit");
  assert.equal(await field("button-submit-sauda").isDisabled(), true);
  await field("input-sauda-quantity").fill("2147483648");
  assert.equal(await field("button-submit-sauda").isDisabled(), true);
  await field("input-sauda-quantity").fill("1.5");
  assert.equal(await field("button-submit-sauda").isDisabled(), true);
  await field("input-sauda-quantity").fill("250");
  await field("select-sauda-buyer").click();
  await page.getByRole("option", { name: "Sauda Existing A", exact: true }).click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(await api("/api/sauda"), [], "Cancel wrote a marker");
  await mount("SaleDialog", { lot: info });
  assert.equal(await field("input-sauda-quantity").inputValue(), "", "Cancel leaked into reopening");
  await field("input-sauda-quantity").fill("250");
  await field("select-sauda-buyer").click();
  await page.getByRole("option", { name: "Sauda Existing A", exact: true }).click();
  for (const [language, width] of [["en", 1440], ["hi", 390], ["hi", 320]] as const) {
    await page.evaluate(lang => localStorage.setItem("language", lang), language);
    await page.setViewportSize({ width, height: 900 });
    await mount("SaleDialog", { lot: info });
    await field("input-sauda-quantity").fill("250");
    await field("select-sauda-buyer").click();
    await page.getByRole("option", { name: "Sauda Existing A", exact: true }).click();
    const bounds = await dialog.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.screenshot({ path: `/tmp/sauda-${language}-${width}.png` });
  }
  const response = page.waitForResponse(r => new URL(r.url()).pathname === `/api/lots/${markerLot}/sauda` && r.request().method() === "POST");
  await field("button-submit-sauda").click();
  assert.equal((await response).status(), 200);
  const writes = requests.filter(r => !["GET", "HEAD"].includes(r.method));
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body, { quantity: 250, buyerLedgerId: buyerA });
  assert.ok(requests.every(r => !/partial-sale|next-cs-bill|farmer-dues|sale-info|cash-receipts|manual-payment/.test(r.path)),
    "Sauda called old financial/bill/payment wiring");
  await mount("SaleDialog", { lot: info });
  assert.equal(await field("input-sauda-quantity").inputValue(), "", "New Sauda must never seed an old entry");
  await field("input-sauda-quantity").fill("150");
  await field("select-sauda-buyer").click();
  await page.getByRole("option", { name: "Sauda Existing B", exact: true }).click();
  const additional = page.waitForResponse(r => r.url().endsWith(`/api/lots/${markerLot}/sauda`) && r.request().method() === "POST");
  await field("button-submit-sauda").click();
  await additional;
  assert.equal((await api("/api/sauda")).length, 2);
  assert.equal((await api("/api/sauda"))[1].buyerInitials, null);
  const duplicate = await api(`/api/lots/${markerLot}/sauda`, { quantity: 25, buyerLedgerId: buyerA }, "POST");
  const mixedMarker = await api(`/api/lots/${mixedLot}/sauda`, { quantity: 20, buyerLedgerId: buyerA }, "POST");
  const firstMarker = (await api("/api/sauda"))[0];
  const summary = await api(`/api/lots/sales-summary?lotIds=${encodeURIComponent([markerLot, mixedLot, zeroLot, masterLot].join(","))}`);
  const markers = (await api("/api/sauda")).reduce((map: any, s: any) => {
    (map[s.lotId] ??= []).push(s); return map;
  }, {});
  const groupProps = { farmerName: "Tulai Farmer", village: "Tulai Village", contactNumber: "0000000000",
    lots: wrappers, chamberMap: { [`${id}_chamber`]: "Tulai Chamber" },
    salesByLot: summary, saudaByLot: markers, canEdit: true };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mount("FarmerLotGroup", groupProps);
  assert.match(await field(`sauda-initials-${firstMarker.id}`).innerText(), /AB/);
  assert.match(await field(`sauda-initials-${duplicate.id}`).innerText(), /AB/);
  assert.match(await field(`sauda-initials-${mixedMarker.id}`).innerText(), /AB/);
  // Sauda actions belong in the same trailing action column as sale bill
  // controls, never inside or alongside the initials badge.
  assert.equal(await field(`sauda-entry-${mixedMarker.id}`).getByRole("button").count(), 0);
  const printBounds = await field(`button-print-sale-${mixedSale.id}`).boundingBox();
  const deleteBounds = await field(`button-delete-sauda-${mixedMarker.id}`).boundingBox();
  const initialsBounds = await field(`sauda-initials-${mixedMarker.id}`).boundingBox();
  assert.ok(printBounds && deleteBounds && initialsBounds);
  assert.ok(Math.abs((printBounds.x + printBounds.width / 2) - (deleteBounds.x + deleteBounds.width / 2)) < 2,
    "Sauda delete must align vertically with the sale Print Bill action");
  assert.ok(deleteBounds.x > initialsBounds.x + initialsBounds.width, "Delete must be separate from initials");
  assert.ok(Math.abs((deleteBounds.y + deleteBounds.height / 2) - (initialsBounds.y + initialsBounds.height / 2)) < 2,
    "Each Sauda's initials and delete action must share their own row");
  assert.match(await field(`cell-mr-${mixedSale.id}`).innerText(), /Self/);
  assert.equal(await field(`cell-remaining-${markerLot}`).innerText(), "100");
  assert.equal(await field(`button-exit-sale-empty-${markerLot}`).count(), 0);
  for (const sale of [mixedSale, zeroSale, masterSale]) {
    await field(`button-exit-sale-${sale.id}`).click();
    assert.equal(await page.evaluate(() => (window as any).lastExitSale), sale.id);
  }
  await page.screenshot({ path: "/tmp/sauda-register-desktop.png" });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: "/tmp/sauda-register-mobile.png" });
  // Submit a real exit using the unchanged ExitDialog and original historical ID.
  await mount("ExitDialog", { sale: await api(`/api/sales-history/${zeroSale.id}`) });
  const exitInput = page.getByTestId("input-bags-to-exit");
  await exitInput.waitFor();
  await exitInput.fill("4");
  const exitResponse = page.waitForResponse(r => r.url().endsWith(`/api/sales-history/${zeroSale.id}/exits`) && r.request().method() === "POST");
  await page.getByTestId("button-submit-exit").click();
  assert.equal((await exitResponse).status(), 201);

  // The actual Stock Register wiring, not just isolated components: confirmed
  // deletion refreshes the list and exact duplicate-initial siblings survive.
  await page.evaluate(() => sessionStorage.setItem("stockRegisterState", JSON.stringify({ selectedYear: 2016 })));
  await page.goto(base + "/stock-register", { waitUntil: "networkidle" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await field(`sauda-entry-${firstMarker.id}`).waitFor();
  assert.equal(await field(`sauda-initials-${firstMarker.id}`).evaluate(el => el.tagName), "SPAN");
  await field(`sauda-initials-${firstMarker.id}`).click();
  assert.equal(await page.getByRole("dialog").count(), 0, "Initials must not open an edit dialog");
  const deleteCount = () => requests.filter(r => r.method === "DELETE").length;
  const beforeCancel = deleteCount();
  await field(`button-delete-sauda-${firstMarker.id}`).click();
  const confirmation = field(`dialog-confirm-delete-sauda-${firstMarker.id}`);
  await confirmation.waitFor();
  assert.match(await confirmation.innerText(), /Are you sure you want to delete this Sauda\?/);
  assert.match(await confirmation.innerText(), /Sauda Existing A/);
  assert.match(await confirmation.innerText(), /250 bags/);
  await field(`button-cancel-delete-sauda-${firstMarker.id}`).click();
  await confirmation.waitFor({ state: "hidden" });
  assert.equal(deleteCount(), beforeCancel, "Cancel sent a delete");
  assert.ok((await api("/api/sauda")).some((s: any) => s.id === firstMarker.id));

  // Deletion failure leaves the row and confirmation intact, allowing retry.
  const deletePath = `/api/lots/${markerLot}/sauda/${firstMarker.id}`;
  await page.route("**" + deletePath, route => route.fulfill({
    status: 500, contentType: "application/json", body: JSON.stringify({ error: "Synthetic deletion failure" }),
  }));
  await field(`button-delete-sauda-${firstMarker.id}`).click();
  await field(`button-confirm-delete-sauda-${firstMarker.id}`).click();
  await page.getByText("Synthetic deletion failure", { exact: false }).first().waitFor();
  assert.equal(await field(`sauda-entry-${firstMarker.id}`).count(), 1);
  assert.equal(await confirmation.isVisible(), true);
  await page.unroute("**" + deletePath);
  const deleting = page.waitForResponse(r => new URL(r.url()).pathname === deletePath && r.request().method() === "DELETE");
  await field(`button-confirm-delete-sauda-${firstMarker.id}`).click();
  assert.equal((await deleting).status(), 200);
  await field(`sauda-entry-${firstMarker.id}`).waitFor({ state: "hidden" });
  await field(`sauda-entry-${duplicate.id}`).waitFor();

  // Delete-and-recreate correction uses only POST, never PATCH.
  if (await field(`expanded-lot-${markerLot}`).getAttribute("aria-hidden") === "true") {
    await field(`row-lot-${markerLot}`).getByRole("button", { name: `Expand lot SAUDA`, exact: true }).click();
  }
  assert.equal(await field(`expanded-lot-${markerLot}`).getAttribute("aria-hidden"), "false");
  await field(`button-sauda-lot-${markerLot}`).click();
  assert.equal(await field("input-sauda-quantity").inputValue(), "");
  await field("input-sauda-quantity").fill("175");
  await field("select-sauda-buyer").click();
  await page.getByRole("option", { name: "Sauda Existing A", exact: true }).click();
  const recreatedResponse = page.waitForResponse(r => new URL(r.url()).pathname === `/api/lots/${markerLot}/sauda` && r.request().method() === "POST");
  await field("button-submit-sauda").click();
  const recreated = await (await recreatedResponse).json();
  assert.notEqual(recreated.id, firstMarker.id);
  await field(`sauda-entry-${recreated.id}`).waitFor();
  // Fully sold lots still allow informational creation.
  await field(`row-lot-${zeroLot}`).click();
  assert.equal(await field(`button-sauda-lot-${zeroLot}`).isVisible(), true);
  assert.equal(await field(`cell-remaining-${markerLot}`).innerText(), "100");
  await page.screenshot({ path: "/tmp/sauda-manual-register-desktop.png" });
  await page.setViewportSize({ width: 390, height: 900 });
  await field(`button-delete-sauda-${recreated.id}`).click();
  const mobileConfirm = field(`dialog-confirm-delete-sauda-${recreated.id}`);
  await mobileConfirm.waitFor();
  const mobileBounds = await mobileConfirm.boundingBox();
  assert.ok(mobileBounds && mobileBounds.x >= 0 && mobileBounds.x + mobileBounds.width <= 390);
  await page.screenshot({ path: "/tmp/sauda-manual-delete-mobile.png" });
  await field(`button-cancel-delete-sauda-${recreated.id}`).click();
  // Viewers see markers, but no create or delete controls.
  await pool.query(`UPDATE cold_storage_users SET access_type='view' WHERE id=$1`, [`${id}_user`]);
  await page.reload({ waitUntil: "networkidle" });
  await field(`sauda-entry-${duplicate.id}`).waitFor();
  assert.equal(await page.locator('[data-testid^="button-delete-sauda-"]').count(), 0);
  assert.equal(await page.locator('[data-testid^="button-sauda-lot-"]').count(), 0);
  assert.equal(requests.filter(r => r.method === "PATCH" && r.path.includes("/sauda")).length, 0);
  assert.deepEqual(errors, []);
  console.log("Sauda browser: actual register create/delete/recreate, confirmation/cancel/error retry, exact identity, no edits/caps, viewer restrictions, English/Hindi desktop/mobile, isolated writes, legacy controls and zero-unsold exits passed.");
} finally {
  await browser?.close();
  await cleanup();
}
