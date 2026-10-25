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
  await field("input-sauda-quantity").fill("101");
  assert.equal(await field("button-submit-sauda").isDisabled(), true);
  await field("input-sauda-quantity").fill("1.5");
  assert.equal(await field("button-submit-sauda").isDisabled(), true);
  await field("input-sauda-quantity").fill("25");
  await field("select-sauda-buyer").click();
  await page.getByRole("option", { name: "Sauda Existing A", exact: true }).click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(await api("/api/sauda"), [], "Cancel wrote a marker");
  await mount("SaleDialog", { lot: info });
  assert.equal(await field("input-sauda-quantity").inputValue(), "", "Cancel leaked into reopening");
  await field("input-sauda-quantity").fill("25");
  await field("select-sauda-buyer").click();
  await page.getByRole("option", { name: "Sauda Existing A", exact: true }).click();
  for (const [language, width] of [["en", 1440], ["hi", 390], ["hi", 320]] as const) {
    await page.evaluate(lang => localStorage.setItem("language", lang), language);
    await page.setViewportSize({ width, height: 900 });
    await mount("SaleDialog", { lot: info });
    await field("input-sauda-quantity").fill("25");
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
  assert.deepEqual(writes[0].body, { quantity: 25, buyerLedgerId: buyerA });
  assert.ok(requests.every(r => !/partial-sale|next-cs-bill|farmer-dues|sale-info|cash-receipts|manual-payment/.test(r.path)),
    "Sauda called old financial/bill/payment wiring");
  await mount("SaleDialog", { lot: info });
  assert.equal(await field("input-sauda-quantity").inputValue(), "25");
  await field("select-sauda-buyer").click();
  await page.getByRole("option", { name: "Sauda Existing B", exact: true }).click();
  const replacement = page.waitForResponse(r => r.url().endsWith(`/api/lots/${markerLot}/sauda`) && r.request().method() === "POST");
  await field("button-submit-sauda").click();
  await replacement;
  assert.equal((await api("/api/sauda"))[0].buyerInitials, null);
  await api(`/api/lots/${markerLot}/sauda`, { quantity: 25, buyerLedgerId: buyerA }, "POST");
  await api(`/api/lots/${mixedLot}/sauda`, { quantity: 20, buyerLedgerId: buyerA }, "POST");
  const summary = await api(`/api/lots/sales-summary?lotIds=${encodeURIComponent([markerLot, mixedLot, zeroLot, masterLot].join(","))}`);
  const markers = Object.fromEntries((await api("/api/sauda")).map((s: any) => [s.lotId, s]));
  const groupProps = { farmerName: "Tulai Farmer", village: "Tulai Village", contactNumber: "0000000000",
    lots: wrappers, chamberMap: { [`${id}_chamber`]: "Tulai Chamber" },
    salesByLot: summary, saudaByLot: markers, canEdit: true };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mount("FarmerLotGroup", groupProps);
  assert.match(await field(`cell-sauda-initials-${markerLot}`).innerText(), /AB/);
  assert.match(await field(`cell-sauda-initials-${mixedLot}`).innerText(), /AB/);
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
  assert.deepEqual(errors, []);
  console.log("Sauda browser: exact fields/actions, English/Hindi desktop/mobile, cancel/reopen, submit/replacement, request isolation, mixed initials, genuine historical sale controls and zero-unsold exit submission passed.");
} finally {
  await browser?.close();
  await cleanup();
}
