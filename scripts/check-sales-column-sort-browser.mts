// Runs the actual page with browser-only API fixtures; no database access or auth bypass.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { rows } from "./check-sales-column-sort.mts";
import { sortSalesHistory, type SalesSort } from "../client/src/lib/sales-history-sort.ts";

assert.match(process.env.REPLIT_DEV_DOMAIN ?? "", /^[a-z0-9.-]+\.replit\.dev$/i);
const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const sales = rows.map((row, index) => ({
  ...row, village: "Sort Village", lotNo: `receipt-${row.id}`, marka: row.id,
  coldStorageBillNumber: index + 1, bagType: index % 2 ? "wafer" : "seed",
  originalLotSize: 20, quantitySold: 10, remainingSizeAtSale: 20,
  paymentStatus: "due", paidAmount: 0, dueAmount: row.coldStorageCharge,
  isSelfSale: 1, pricePerKg: 0, payments: [], extraDueToMerchant: 0,
  entryDate: "2026-03-01T06:30:00Z", createdAt: row.soldAt,
}));
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    (window as any).__name = (fn: unknown) => fn;
    localStorage.setItem("cold_store_auth_token", "mock-sales-sort-only");
    if (!localStorage.getItem("language")) localStorage.setItem("language", "en");
  });
  const errors: string[] = [];
  const unexpectedWrites: string[] = [];
  const exports: string[] = [];
  await context.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (request.method() !== "GET") {
      if (path === "/api/export/token" && request.method() === "POST") {
        return route.fulfill({ json: { downloadToken: "browser-only-download" } });
      }
      unexpectedWrites.push(`${request.method()} ${path}`);
      return route.abort();
    }
    if (path === "/api/export/sales") {
      exports.push(request.url());
      return route.fulfill({ contentType: "text/csv",
        headers: { "Content-Disposition": 'attachment; filename="sales-sort-check.csv"' },
        body: "Sale Date,Farmer Name,Cold Storage Charges\n2026-09-30,Beta,1000.5\n" });
    }
    const filtered = sales.filter(row =>
      (!url.searchParams.get("farmerName") || row.farmerName.toLowerCase().includes(url.searchParams.get("farmerName")!.toLowerCase())) &&
      (!url.searchParams.get("coldStorageBillNumber") || String(row.coldStorageBillNumber) === url.searchParams.get("coldStorageBillNumber")));
    const responses: Record<string, unknown> = {
      "/api/auth/session": {
        user: { id: "sort-user", name: "Sort Operator", mobileNumber: "0000000000", accessType: "edit", coldStorageId: "sort" },
        coldStorage: { id: "sort", name: "Sales sorting check", totalCapacity: 100, waferRate: 60, seedRate: 60 },
      },
      "/api/sales-history": filtered,
      "/api/sales-history/years": [2026],
      "/api/sales-history/exits-summary": { totalBagsExited: 0 },
    };
    await route.fulfill({ json: responses[path] ?? [] });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const ids = () => page.locator('[data-testid^="row-sale-"]').evaluateAll(nodes =>
    nodes.map(node => node.getAttribute("data-testid")!.replace("row-sale-", "")));
  const waitOrder = async (expected: string[]) => {
    await page.waitForFunction(expected => JSON.stringify(
      Array.from(document.querySelectorAll('[data-testid^="row-sale-"]')).map(node =>
        node.getAttribute("data-testid")!.replace("row-sale-", ""))) === JSON.stringify(expected), expected);
    assert.deepEqual(await ids(), expected);
  };
  for (const language of ["en", "hi"]) {
    await page.goto(base, { waitUntil: "networkidle" });
    await page.evaluate(language => {
      localStorage.setItem("language", language);
      localStorage.removeItem("salesHistoryFilters");
    }, language);
    await page.goto(`${base}/sales-history`, { waitUntil: "networkidle" });
    await waitOrder(sales.map(row => row.id));
    const summaries = await page.locator('[data-testid^="card-summary-"]').allTextContents();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const field of ["soldAt", "farmerName", "coldStorageCharge"] as const) {
        const button = page.getByTestId(`sort-sales-${field}`);
        assert.equal(await button.count(), 1);
        for (const direction of [field === "farmerName" ? "asc" : "desc", field === "farmerName" ? "desc" : "asc"] as const) {
          await button.click();
          const expected = sortSalesHistory(sales, { field, direction } as SalesSort, language).map(row => row.id);
          await waitOrder(expected);
          assert.equal(await button.locator("..").getAttribute("aria-sort"), direction === "asc" ? "ascending" : "descending");
          assert.deepEqual(await page.locator('[data-testid^="card-summary-"]').allTextContents(), summaries);
        }
      }
      assert.equal(await page.locator('th button[data-testid^="sort-sales-"]').count(), 3);
      await page.getByTestId("sort-sales-soldAt").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/tmp/sales-sort-${language}-${width}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Keyboard activation has the same behavior as clicking.
    const dateButton = page.getByTestId("sort-sales-soldAt");
    await dateButton.focus();
    await page.keyboard.press("Enter");
    await waitOrder(["b", "d", "c", "e", "a"]);
    await page.keyboard.press("Space");
    await waitOrder(["a", "c", "e", "b", "d"]);
    await page.getByTestId("sort-sales-coldStorageCharge").click();
    await page.getByTestId("select-type-filter").click();
    await page.getByRole("option", { name: language === "en" ? "Seed" : "बीज", exact: true }).click();
    await waitOrder(["a", "e", "c"]);
    assert.equal(await page.getByTestId("sort-sales-coldStorageCharge").locator("..").getAttribute("aria-sort"), "descending");
    await page.getByTestId("button-clear-filters").click();
    await waitOrder(["a", "b", "c", "d", "e"]);
    for (const field of ["soldAt", "farmerName", "coldStorageCharge"]) {
      assert.equal(await page.getByTestId(`sort-sales-${field}`).locator("..").getAttribute("aria-sort"), "none");
    }
    await page.getByTestId("sort-sales-farmerName").click();
    await page.getByTestId("input-farmer-filter").fill("arun");
    await waitOrder(["b", "c"]);
    await page.getByTestId("input-cold-bill-filter").fill("999999");
    await waitOrder([]);
    await page.getByTestId("button-clear-filters").click();
    await waitOrder(["a", "b", "c", "d", "e"]);
    await page.getByTestId("sort-sales-coldStorageCharge").click();
    await page.getByTestId("button-export-sales").click();
    const download = page.waitForEvent("download");
    await page.getByTestId("menu-export-sales-overall").click();
    await download;
    assert.equal(new URL(exports.at(-1)!).searchParams.has("sort"), false);
    await page.reload({ waitUntil: "networkidle" });
    await waitOrder(["a", "b", "c", "d", "e"]);
    assert.equal(await page.getByTestId("sort-sales-coldStorageCharge").locator("..").getAttribute("aria-sort"), "none");
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpectedWrites, []);
  assert.equal(exports.length, 2);
  console.log("Sales sorting browser checks passed: three headers, both directions, keyboard, stable ties, English/Hindi desktop/mobile, unchanged totals, filters/reset/empty/reload and unchanged CSV requests. All API traffic intercepted; no database changes.");
} finally {
  await browser.close();
}
