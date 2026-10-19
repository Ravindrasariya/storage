#!/usr/bin/env tsx
// Actual source components, real authenticated APIs, synthetic development data.
import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import { auth, cleanup, farmerId, id, lot, pool, setup, token } from "./tulai-fixtures.mts";

const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
let browser: Browser | undefined;
try {
  assert.match(process.env.REPLIT_DEV_DOMAIN ?? "", /^[a-z0-9.-]+\.replit\.dev$/i);
  const ready = await fetch(`${base}/src/lib/queryClient.ts`);
  assert.ok(ready.ok, "Start/restart the development application first");
  await setup();
  async function api(path: string, body?: object, method = "POST") {
    const response = await fetch(base + path, {
      headers: auth, method, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.ok(response.ok, `${path}: ${await response.clone().text()}`);
    return response.json();
  }
  const lotId = await lot("remark-UI");
  const secondLotId = await lot("remark-second");
  const info = await api(`/api/lots/${lotId}/sale-info`, undefined, "GET");
  const secondInfo = await api(`/api/lots/${secondLotId}/sale-info`, undefined, "GET");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || "/repl/tools/bin/chromium",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript("window.__name = (fn) => fn;");
  await context.addInitScript(value => localStorage.setItem("cold_store_auth_token", value), token);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base, { waitUntil: "networkidle" });
  async function mount(component: string, props: object, keepInstance = false) {
    await page.evaluate(async ({ component, props, keepInstance }) => {
      const dependency = (name: string) => {
        const entry = performance.getEntriesByType("resource")
          .find(entry => entry.name.includes(`/deps/${name}?`) || entry.name.endsWith(`/deps/${name}`));
        if (!entry) throw new Error(`Missing loaded dependency ${name}`);
        return entry.name;
      };
      const React = (await import(dependency("react.js"))).default;
      const ReactDOM = await import(dependency("react-dom_client.js"));
      const { QueryClientProvider } = await import(dependency("@tanstack_react-query.js"));
      const { queryClient } = await import("/src/lib/queryClient.ts");
      const { I18nProvider } = await import("/src/lib/i18n.tsx");
      const { AuthProvider } = await import("/src/lib/auth.tsx");
      const module = await import(`/src/components/${component}.tsx`);
      const win = window as any;
      if (!keepInstance && win.remarkRoot) { win.remarkRoot.unmount(); win.remarkRoot = null; }
      let container = document.getElementById("remark-check");
      if (!container) {
        container = document.createElement("div"); container.id = "remark-check";
        document.body.appendChild(container);
      }
      win.remarkRoot ??= (ReactDOM.createRoot ?? ReactDOM.default.createRoot)(container);
      const h = React.createElement;
      win.remarkRender = (next: object) => {
        win.remarkProps = next;
        win.remarkRoot.render(h(QueryClientProvider, { client: queryClient },
          h(I18nProvider, null, h(AuthProvider, null, h(module[component], {
            open: true, ...next,
            onOpenChange: (open: boolean) => win.remarkRender({ ...win.remarkProps, open }),
          })))));
      };
      win.remarkRender(props);
    }, { component, props, keepInstance });
    await page.waitForTimeout(250);
  }
  const field = (name: string) => page.getByTestId(name);
  const read = async (saleId: string) =>
    (await pool.query(`SELECT * FROM sales_history WHERE id=$1`, [saleId])).rows[0];
  async function placement(inputId: string, before: string, after?: string) {
    const result = await field(inputId).evaluate((input, { before, after }) => {
      const dialog = input.closest('[role="dialog"]')!;
      const next = dialog.querySelector(before)!;
      const previous = after ? dialog.querySelector(after) : null;
      return {
        tag: input.tagName, type: input.getAttribute("type"), max: input.getAttribute("maxlength"),
        before: !!next && !!(input.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING),
        after: !after || (!!previous && !!(previous.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING)),
        width: input.getBoundingClientRect().width,
        documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    }, { before, after });
    assert.equal(result.tag, "INPUT");
    assert.equal(result.type, "text");
    assert.equal(result.max, "500");
    assert.equal(result.before, true, `${inputId} is not before ${before}`);
    assert.equal(result.after, true, `${inputId} is not after ${after}`);
    assert.ok(result.width > 100);
    assert.equal(result.documentOverflow, false);
  }
  await mount("SaleDialog", { lot: info });
  assert.equal(await field("input-partial-remarks").count(), 1, "Remark must exist with zero quantity/no preview");
  await field("input-partial-quantity").fill("10");
  await field("checkbox-partial-self-buyer").click();
  await field("input-partial-sale-date").fill("2016-06-15");
  await field("input-partial-remarks").fill("टिप्पणी <script>literal only</script>");
  await mount("SaleDialog", { lot: { ...info } }, true);
  assert.equal(await field("input-partial-remarks").inputValue(), "टिप्पणी <script>literal only</script>", "Refetch reset sale typing");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await placement("input-partial-remarks", ".text-2xl.font-bold");
    await field("input-partial-remarks").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/sale-remarks-create-${width}.png` });
  }
  const saleResponse = page.waitForResponse(response => response.url().endsWith(`/api/lots/${lotId}/partial-sale`) && response.request().method() === "POST");
  await field("button-confirm-sale").click();
  assert.equal((await saleResponse).status(), 200);
  const created = (await pool.query(`SELECT id FROM sales_history WHERE lot_id=$1`, [lotId])).rows[0];
  assert.equal((await read(created.id)).remarks, "टिप्पणी <script>literal only</script>");
  await mount("SaleDialog", { lot: secondInfo }, true);
  assert.equal(await field("input-partial-remarks").inputValue(), "", "Switching lots leaked a remark");
  await field("input-partial-remarks").fill("Discard me");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await mount("SaleDialog", { lot: secondInfo }, true);
  assert.equal(await field("input-partial-remarks").inputValue(), "", "Reopening leaked a cancelled remark");

  // A deliberately different historical total must not be repaired by note edits.
  await pool.query(`UPDATE sales_history SET cold_storage_charge=777,due_amount=777 WHERE id=$1`, [created.id]);
  let sale = await api(`/api/sales-history/${created.id}`, undefined, "GET");
  await mount("EditSaleDialog", { sale });
  assert.equal(await field("input-edit-remarks").inputValue(), sale.remarks);
  await field("input-edit-remarks").fill("Independent edit");
  await mount("EditSaleDialog", { sale: { ...sale } }, true);
  assert.equal(await field("input-edit-remarks").inputValue(), "Independent edit", "Refetch reset edit typing");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await placement("input-edit-remarks", '[data-testid="sale-payment-overview"]', '[data-testid="input-edit-net-weight"]');
    await field("input-edit-remarks").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/sale-remarks-edit-${width}.png` });
  }
  let before = await read(created.id);
  const editResponse = page.waitForResponse(response => response.url().endsWith(`/api/sales-history/${created.id}`) && response.request().method() === "PATCH");
  await field("button-save-edit").click();
  const savedResponse = await editResponse;
  assert.equal(savedResponse.status(), 200, await savedResponse.text());
  assert.deepEqual(savedResponse.request().postDataJSON(), { remarks: "Independent edit" });
  let after = await read(created.id);
  delete before.remarks; delete after.remarks;
  assert.deepEqual(after, before);
  await page.reload({ waitUntil: "networkidle" });
  sale = await api(`/api/sales-history/${created.id}`, undefined, "GET");
  await mount("EditSaleDialog", { sale });
  assert.equal(await field("input-edit-remarks").inputValue(), "Independent edit", "Saved remark did not survive reload");
  await field("input-edit-remarks").fill("");
  const clearResponse = page.waitForResponse(response => response.url().endsWith(`/api/sales-history/${created.id}`) && response.request().method() === "PATCH");
  await field("button-save-edit").click();
  assert.equal((await clearResponse).status(), 200);
  assert.equal((await read(created.id)).remarks, null);
  await mount("EditSaleDialog", { sale: await api(`/api/sales-history/${created.id}`, undefined, "GET") });
  const restoreResponse = page.waitForResponse(response => response.url().endsWith(`/api/sales-history/${created.id}`) && response.request().method() === "PATCH");
  await field("button-restore-remark-edit").click();
  assert.equal((await restoreResponse).status(), 200);
  assert.equal((await read(created.id)).remarks, "Independent edit");

  const batchIds = await Promise.all(["remark-batch-1", "remark-batch-2"].map(name => lot(name)));
  const listing = await api("/api/lots", undefined, "GET");
  const lots = listing.lots.filter((row: any) => batchIds.includes(row.id)).map((row: any) => ({
    lot: row, lotPaidCharge: row.totalPaidCharge ?? 0, lotDueCharge: row.totalDueCharge ?? 0,
    expectedColdCharge: row.remainingSize * 60,
  }));
  const props = { farmerName: "Tulai Farmer", village: "Tulai Village",
    contactNumber: "0000000000", farmerLedgerId: farmerId, lots };
  await page.evaluate(() => { window.open = () => null; });
  await mount("MasterNikasiDialog", props);
  await field("input-mn-exit-date").fill("2016-06-16");
  await field("input-mn-remarks").fill("Shared at creation");
  await mount("MasterNikasiDialog", { ...props, lots: lots.map((row: any) => ({ ...row })) }, true);
  assert.equal(await field("input-mn-remarks").inputValue(), "Shared at creation", "Lot refresh erased Master Nikasi typing");
  for (const [n, name] of ["remark-batch-1", "remark-batch-2"].entries()) {
    if (n > 0) await field("button-mn-add-row").click();
    await field(`select-mn-lot-${n}`).click();
    await field(`option-mn-lot-${n}-${name}`).click();
    await field(`input-mn-bags-${n}`).fill("2");
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await placement("input-mn-remarks", '[data-testid="button-mn-submit"]');
    await field("input-mn-remarks").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/sale-remarks-master-${width}.png` });
  }
  const batchResponse = page.waitForResponse(response => response.url().endsWith("/api/farmers/master-nikasi") && response.request().method() === "POST");
  await field("button-mn-submit").click();
  const batchSaved = await batchResponse;
  assert.equal(batchSaved.status(), 201, await batchSaved.text());
  const batch = await batchSaved.json();
  for (const row of batch.sales) assert.equal((await read(row.saleId)).remarks, "Shared at creation");
  // Each copied value is visible in the real individual edit dialog.
  for (const row of batch.sales) {
    await mount("EditSaleDialog", { sale: await api(`/api/sales-history/${row.saleId}`, undefined, "GET") });
    assert.equal(await field("input-edit-remarks").inputValue(), "Shared at creation");
  }
  const first = batch.sales[0].saleId, sibling = batch.sales[1].saleId;
  await mount("EditSaleDialog", { sale: await api(`/api/sales-history/${first}`, undefined, "GET") });
  await field("input-edit-remarks").fill("First only");
  const independent = page.waitForResponse(response => response.url().endsWith(`/api/sales-history/${first}`) && response.request().method() === "PATCH");
  await field("button-save-edit").click();
  assert.equal((await independent).status(), 200);
  assert.equal((await read(sibling)).remarks, "Shared at creation");
  await api(`/api/sales/${first}/manual-payment`, { receiptType: "cash", amount: 10, receivedAt: "2016-06-16" });
  await mount("EditSaleDialog", { sale: await api(`/api/sales-history/${first}`, undefined, "GET") });
  assert.equal(await field("input-edit-remarks").isDisabled(), true, "Payment-recorded remarks must be locked");
  await mount("MasterNikasiDialog", props);
  assert.equal(await field("input-mn-remarks").inputValue(), "", "New Master Nikasi leaked the last remark");
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("Sale remarks browser checks passed: all placements desktop/mobile, real create/edit/clear/restore, refresh/reset, batch independence and payment lock.");
} finally {
  await browser?.close();
  await cleanup();
}
