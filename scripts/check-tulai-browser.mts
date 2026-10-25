#!/usr/bin/env tsx
// Uses real components and synthetic authenticated development fixtures.
// Requires playwright, Replit Chromium, pdftoppm and tesseract (English OCR).
// PDFs, rendered images and OCR diagnostics stay in /tmp.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { format } from "date-fns";
import { chromium, type Browser } from "playwright";
import { auth, cleanup, farmerId, id, lot, pool, setup, token, legacySaleFixture } from "./tulai-fixtures.mts";
import { checkTulaiSubmissions } from "./tulai-browser-submissions.mts";
import { checkNikasiLayout } from "./nikasi-browser-layout.mts";
const execFileAsync = promisify(execFile);
const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
let browser: Browser | undefined;
let fixturesStarted = false;
try {
  assert.match(process.env.REPLIT_DEV_DOMAIN ?? "", /^[a-z0-9.-]+\.replit\.dev$/i,
    "Browser validation requires a Replit development domain, not a published app");
  // The Project workflow launches this gate alongside the application.
  // Wait for Vite to serve current source before creating any fixture data.
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const source = await fetch(`${base}/src/lib/queryClient.ts`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (source.ok && (await source.text()).includes("QueryClient")) {
        ready = true;
        break;
      }
    } catch {
      // Cold starts can briefly refuse connections or return proxy errors.
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready, "Development app was not ready within 60 seconds; start npm run dev and rerun browser validation");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || "/repl/tools/bin/chromium",
    args: ["--no-sandbox"],
  });
  fixturesStarted = true;
  await setup();
  const lotId = await lot("UI");
  const editLotId = await lot("Edit");
  const rawLot = (await pool.query(`SELECT * FROM lots WHERE id=$1`, [lotId])).rows[0];
  async function api(path: string, body?: object, method = "POST") {
    const response = await fetch(base + path, {
      headers: auth, method, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.ok(response.ok, `${path}: ${await response.clone().text()}`);
    return response.json();
  }
  await legacySaleFixture(lotId);
  await legacySaleFixture(editLotId);
  const saleId = (await pool.query(`SELECT id FROM sales_history WHERE lot_id=$1`, [lotId])).rows[0].id;
  const editSaleId = (await pool.query(`SELECT id FROM sales_history WHERE lot_id=$1`, [editLotId])).rows[0].id;
  // Distinct date/amount pairs distinguish every bottom row from summary
  // totals and from the other payments; all four leave the bill partial.
  const expectedPayments = [51, 62, 73, 84].map((amount, n) => ({
    amount, receivedAt: `2016-06-${16 + n}`,
  }));
  for (const payment of expectedPayments) {
    await api(`/api/sales/${saleId}/manual-payment`, {
      receiptType: "cash", ...payment,
    });
  }
  await api(`/api/sales-history/${editSaleId}`, { tulaiCharges: 80 }, "PATCH");
  const sale = await api(`/api/sales-history/${saleId}`, undefined, "GET");
  assert.equal(sale.paymentStatus, "partial", "Fixture must show the bottom payment timeline");
  assert.equal(sale.payments.length, expectedPayments.length, "Fixture must return every payment");
  for (const expected of expectedPayments) {
    assert.ok(sale.payments.some((payment: any) =>
      payment.amount === expected.amount &&
      format(new Date(payment.receivedAt), "dd/MM/yyyy") === format(new Date(expected.receivedAt), "dd/MM/yyyy")),
    `Fixture payment missing: ${expected.receivedAt}, amount ${expected.amount}`);
  }
  const editSale = await api(`/api/sales-history/${editSaleId}`, undefined, "GET");
  const lotList = await api("/api/lots", undefined, "GET");
  const lots = lotList.lots.map((lot: any) => ({
    lot, lotPaidCharge: lot.totalPaidCharge ?? 0, lotDueCharge: lot.totalDueCharge ?? 0,
    expectedColdCharge: lot.remainingSize * 60,
  }));
  const lotInfo = await api(`/api/lots/${lotId}/sale-info`, undefined, "GET");
  assert.ok(lotInfo, "Fixture lot must be visible to the authenticated operator");
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  // tsx's keepNames transform injects this helper into serialized callbacks.
  await context.addInitScript("window.__name = (fn) => fn;");
  await context.addInitScript(value => localStorage.setItem("cold_store_auth_token", value), token);
  const page = await context.newPage();
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  await page.goto(base, { waitUntil: "networkidle" });
  // Mount the actual source component, not a mock. Providers use the normal
  // session token and APIs; no auth middleware is removed or bypassed.
  async function mount(component: string, props: object) {
    await page.evaluate(async ({ component, props }) => {
      const dependency = (name: string) => {
        const loaded = performance.getEntriesByType("resource")
          .find(entry => entry.name.includes(`/deps/${name}?`) || entry.name.endsWith(`/deps/${name}`));
        if (!loaded) throw new Error(`Application did not load ${name}`);
        return loaded.name;
      };
      const React = (await import(dependency("react.js"))).default;
      const ReactDOM = await import(dependency("react-dom_client.js"));
      const createRoot = ReactDOM.createRoot ?? ReactDOM.default.createRoot;
      const { QueryClientProvider } = await import(dependency("@tanstack_react-query.js"));
      const { queryClient } = await import("/src/lib/queryClient.ts");
      const { I18nProvider } = await import("/src/lib/i18n.tsx");
      const { AuthProvider } = await import("/src/lib/auth.tsx");
      const module = await import(`/src/components/${component}.tsx`);
      const win = window as any;
      if (win.tulaiRoot) win.tulaiRoot.unmount();
      let container = document.getElementById("tulai-check");
      if (!container) {
        container = document.createElement("div"); container.id = "tulai-check";
        document.body.appendChild(container);
      }
      win.tulaiRoot = createRoot(container);
      const h = React.createElement;
      win.tulaiRoot.render(h(QueryClientProvider, { client: queryClient },
        h(I18nProvider, null, h(AuthProvider, null,
          h(module[component], { ...props, open: true, onOpenChange: () => {} })))));
    }, { component, props });
    await page.waitForTimeout(450);
  }
  await mount("EditSaleDialog", { sale: editSale });
  await page.getByRole("button", { name: /^Cold Storage Charges/ }).click();
  await page.getByTestId("input-edit-grading-per-bag").waitFor({ state: "visible" });
  assert.equal(await page.getByText("Tulai (Manual Weighing)", { exact: true }).count(), 1);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.waitForTimeout(250);
    const perBag = page.getByTestId("input-edit-grading-per-bag");
    await perBag.scrollIntoViewIfNeeded();
    const grading = await perBag.evaluate(input => {
      const first = input.parentElement!.parentElement!;
      const grid = first.parentElement!;
      const total = grid.querySelector('[data-testid="input-edit-grading-charges"]')!.parentElement!.parentElement!;
      const a = first.getBoundingClientRect(), b = total.getBoundingClientRect();
      const tulai = grid.querySelector('[data-testid="input-edit-tulai-charges"]')!.getBoundingClientRect();
      return { left: a.x, right: b.right, top: a.y, otherTop: b.y,
        firstWidth: a.width, secondWidth: b.width, gridLeft: grid.getBoundingClientRect().left,
        gridRight: grid.getBoundingClientRect().right, tulaiBottom: tulai.bottom };
    });
    assert.ok(Math.abs(grading.top - grading.otherTop) < 2, `Grading fields must share one row at ${width}px`);
    assert.ok(Math.abs(grading.firstWidth - grading.secondWidth) < 2, "Grading fields must have equal widths");
    assert.ok(Math.abs(grading.left - grading.gridLeft) < 2 &&
      Math.abs(grading.right - grading.gridRight) < 2, "Grading row must cover the full charge grid");
    assert.ok(grading.top >= grading.tulaiBottom, "Grading row must be below the Tulai charge row");
    await page.screenshot({ path: `/tmp/tulai-edit-grading-${width}.png` });
  }
  await page.getByTestId("input-edit-grading-per-bag").fill("2");
  assert.equal(await page.getByTestId("input-edit-grading-charges").inputValue(), "20",
    "Layout correction must preserve per-bag grading auto-fill");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-testid="button-restore-tulai-edit"]').click();
  await page.waitForTimeout(700);
  const restored = await api(`/api/sales-history/${editSaleId}`, undefined, "GET");
  assert.equal(restored.tulaiCharges, 50);
  assert.equal(restored.coldStorageCharge, 740);
  await checkNikasiLayout(page, mount, { farmerName: "Tulai Farmer", village: "Tulai Village",
    contactNumber: "0000000000", farmerLedgerId: farmerId, lots });
  await mount("MasterNikasiDialog", { farmerName: "Tulai Farmer", village: "Tulai Village",
    contactNumber: "0000000000", farmerLedgerId: farmerId, lots });
  assert.equal(await page.locator('[data-testid="input-mn-tulai-0"]').count(), 1);
  await page.screenshot({ path: "/tmp/tulai-mn-desktop.png" });
  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(desktopOverflow, false, "Master Nikasi must not overflow the document");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/tulai-mn-mobile.png" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Receipts stay in Hindi even when the operator's app language is English.
  await page.evaluate(() => localStorage.setItem("language", "en"));
  for (const type of ["deduction", "sales"]) {
    await mount("PrintBillDialog", { sale });
    await page.evaluate(() => {
      const win = window as any;
      win.tulaiPrintHtml = "";
      win.open = () => ({
        document: { write: (html: string) => { win.tulaiPrintHtml = html; }, close() {} },
        focus() {}, print() {}, close() {},
      });
    });
    await page.locator(`[data-testid="button-${type}-bill-print"]`).click();
    await page.waitForFunction(() => Boolean((window as any).tulaiPrintHtml));
    const html = await page.evaluate(() => (window as any).tulaiPrintHtml as string);
    assert.ok(html.includes("तुलाई"));
    if (type === "deduction") {
      for (const payment of sale.payments) assert.ok(html.includes(`row-payment-${payment.receiptId}`), "Every bottom payment entry must be retained");
    }
    const printPage = await context.newPage();
    await printPage.setContent(html, { waitUntil: "networkidle" });
    const pdfPath = `/tmp/tulai-${type}-print.pdf`;
    await printPage.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
    const printPages = ((await readFile(pdfPath)).toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
    assert.equal(printPages, 1, `${type} actual A4 print page count`);
    await printPage.screenshot({ path: `/tmp/tulai-${type}-bill.png`, fullPage: true });
    await printPage.close();
    await mount("PrintBillDialog", { sale });
    const downloaded = page.waitForEvent("download");
    await page.locator(`[data-testid="button-${type}-bill-share"]`).click();
    const download = await downloaded;
    const sharedPath = `/tmp/tulai-${type}-shared.pdf`;
    await download.saveAs(sharedPath);
    const sharedPages = ((await readFile(sharedPath)).toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
    assert.equal(sharedPages, 1, `${type} actual generated/shared PDF page count`);
    if (type === "deduction") {
      // shareReceiptAsPdf embeds a canvas image, not searchable PDF text.
      // Read the saved download itself: DOM markers or a one-page count
      // alone cannot prove that its bottom payment rows survived rendering.
      const imagePrefix = "/tmp/tulai-deduction-shared";
      await execFileAsync("pdftoppm", ["-f", "1", "-singlefile", "-r", "300",
        "-png", sharedPath, imagePrefix]);
      const { stdout: ocr } = await execFileAsync("tesseract", [
        `${imagePrefix}.png`, "stdout", "-l", "eng", "--psm", "6",
      ]);
      await writeFile(`${imagePrefix}-ocr.txt`, ocr);
      const lines = ocr.split(/\r?\n/).map(line => line.replace(/\s+/g, " ").trim());
      for (const payment of expectedPayments) {
        const date = format(new Date(payment.receivedAt), "dd/MM/yyyy");
        // Match both fields on the SAME line, including numeric boundaries:
        // a matching total elsewhere cannot hide a missing payment amount.
        const row = new RegExp(`(?:^|\\D)${date}\\s*:?.*\\b${payment.amount}(?:\\.00)?\\s*$`);
        assert.ok(lines.some(line => row.test(line)),
          `Downloaded Cold Storage Bill PDF is missing payment ${date}, amount ${payment.amount}. ` +
          `See ${imagePrefix}.png and ${imagePrefix}-ocr.txt`);
      }
      console.log(`deduction: all ${expectedPayments.length} payment date/amount pairs found in downloaded PDF`);
    }
    console.log(`${type}: A4 print = ${printPages} page; shared PDF = ${sharedPages} page`);
  }
  await page.evaluate(() => (window as any).tulaiRoot.unmount());
  for (const language of ["en", "hi"]) {
    await page.evaluate(language => localStorage.setItem("language", language), language);
    await page.goto(`${base}/sales-history`, { waitUntil: "networkidle" });
    await page.getByTestId("button-export-sales").click();
    assert.deepEqual(await page.getByRole("menuitem").allTextContents(), ["Overall", "Kata + Tulai"],
      "Sales downloads must offer one combined Kata/Tulai option, alongside Overall");
    assert.equal(await page.getByTestId("menu-export-sales-tulai").count(), 0);
    await page.screenshot({ path: `/tmp/sales-csv-menu-${language}.png` });
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("menu-export-sales-kata").click();
    const csvDownload = await downloadPromise;
    assert.match(csvDownload.suggestedFilename(), /^sales_kata_/);
    const csvPath = await csvDownload.path();
    assert.ok(csvPath);
    const csv = await readFile(csvPath, "utf8");
    assert.ok(csv.split("\n")[0].endsWith("Kata Charges,Tulai Charges"),
      "Combined download must include both adjacent charge columns");
  }
  await page.evaluate(() => localStorage.setItem("language", "hi"));
  await page.goto(`${base}/cash-management`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="tab-expense"]').click();
  await page.locator('[data-testid="btn-revenue-expense"]').click();
  await page.locator('[data-testid="select-expense-type"]').click();
  const tulaiOption = page.getByRole("option", { name: /तुलाई/ });
  assert.match(await tulaiOption.innerText(), /₹100/);
  await tulaiOption.click();
  await page.locator('[data-testid="input-expense-receiver"]').fill("Himmal");
  await page.locator('[data-testid="input-expense-amount"]').fill("20");
  await page.locator('[data-testid="button-record-expense"]').click();
  await page.waitForTimeout(650);
  const unpaid = await api("/api/analytics/payments", undefined, "GET");
  assert.equal(unpaid.tulaiDue, 80);
  const recorded = (await pool.query(`SELECT * FROM expenses WHERE cold_storage_id=$1
    AND expense_type='tulai' AND is_reversed=0`, [id])).rows[0];
  assert.equal(recorded.amount, 20);
  await page.locator('[data-testid="select-expense-type"]').click();
  assert.match(await page.getByRole("option", { name: /तुलाई/ }).innerText(), /₹80/,
    "The unpaid bracket must refresh after the payout");
  await page.keyboard.press("Escape");
  await api(`/api/expenses/${recorded.id}/reverse`, {});
  assert.equal((await api("/api/analytics/payments", undefined, "GET")).tulaiDue, 100);
  // Keep new-submission fixtures after the existing payout checks so their
  // independently known unpaid totals remain unchanged.
  await page.evaluate(() => localStorage.setItem("language", "en"));
  await page.goto(base, { waitUntil: "networkidle" });
  await checkTulaiSubmissions(page, mount, api);
  assert.deepEqual(browserErrors, [], "No browser runtime errors in tested components");
  console.log("Tulai browser checks passed: Master Nikasi submissions, decimal/blank/zero persistence, totals and validation, historical Sale Edit/Master Nikasi desktop/mobile layouts, latest Tulai edit restoration, and both real print/shared PDF paths with four bottom payment entries.");
} finally {
  try {
    await browser?.close();
  } finally {
    if (fixturesStarted) await cleanup();
    else await pool.end();
  }
}
