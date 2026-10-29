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
  // Capture the actual print document without opening the system print dialog.
  const capturePrint = async () => {
    await page.evaluate(() => {
      (window as any).salesPrintedHtml = "";
      window.open = (() => ({
        document: {
          write(html: string) { (window as any).salesPrintedHtml = html; },
          close() {},
        },
      })) as any;
    });
    await page.getByTestId("button-print-sales").click();
    return page.evaluate(() => {
      const html = (window as any).salesPrintedHtml as string;
      const doc = new DOMParser().parseFromString(html, "text/html");
      return {
        rows: Array.from(doc.querySelectorAll("tbody tr")).map(row =>
          Array.from(row.querySelectorAll("td")).map(cell => cell.textContent)),
        headers: Array.from(doc.querySelectorAll("th")).map(cell => cell.textContent),
        totals: doc.querySelector(".cards")?.textContent,
        filters: doc.querySelector(".meta")?.textContent,
        columns: doc.querySelector("colgroup")?.innerHTML,
        styles: doc.querySelector("style")?.textContent,
      };
    });
  };
  const checkPrint = async (baseline: Awaited<ReturnType<typeof capturePrint>>, expected: string[]) => {
    const printed = await capturePrint();
    const byId = new Map(baseline.rows.map(row => [row[3]!.replace("receipt-", ""), row]));
    assert.deepEqual(printed, {
      ...baseline,
      rows: expected.map(id => {
        assert.ok(byId.has(id), `Missing baseline print row ${id}`);
        return byId.get(id);
      }),
    }, "Print must match table order without changing row cells, totals, filters, columns or styles");
  };
  for (const language of ["en", "hi"]) {
    await page.goto(base, { waitUntil: "networkidle" });
    await page.evaluate(language => {
      localStorage.setItem("language", language);
      localStorage.removeItem("salesHistoryFilters");
    }, language);
    await page.goto(`${base}/sales-history`, { waitUntil: "networkidle" });
    await waitOrder(sales.map(row => row.id));
    // Use the same filter state as Clear Filters/reload for full-document comparisons.
    await page.getByTestId("button-clear-filters").click();
    await waitOrder(sales.map(row => row.id));
    const summaries = await page.locator('[data-testid^="card-summary-"]').allTextContents();
    const defaultPrint = await capturePrint();
    assert.equal(defaultPrint.headers.length, 14);
    assert.deepEqual(defaultPrint.rows.map(row => row[3]), sales.map(row => row.lotNo));
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await checkPrint(defaultPrint, await ids());
      for (const field of ["soldAt", "farmerName", "coldStorageCharge"] as const) {
        const button = page.getByTestId(`sort-sales-${field}`);
        assert.equal(await button.count(), 1);
        for (const direction of [field === "farmerName" ? "asc" : "desc", field === "farmerName" ? "desc" : "asc"] as const) {
          await button.click();
          const expected = sortSalesHistory(sales, { field, direction } as SalesSort, language).map(row => row.id);
          await waitOrder(expected);
          assert.equal(await button.locator("..").getAttribute("aria-sort"), direction === "asc" ? "ascending" : "descending");
          assert.deepEqual(await page.locator('[data-testid^="card-summary-"]').allTextContents(), summaries);
          await checkPrint(defaultPrint, expected);
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
    const filteredPrint = await capturePrint();
    assert.deepEqual(filteredPrint.rows.map(row => row[3]), ["receipt-a", "receipt-e", "receipt-c"]);
    assert.notEqual(filteredPrint.filters, defaultPrint.filters);
    assert.notEqual(filteredPrint.totals, defaultPrint.totals);
    assert.equal(await page.getByTestId("sort-sales-coldStorageCharge").locator("..").getAttribute("aria-sort"), "descending");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const field of ["soldAt", "farmerName", "coldStorageCharge"] as const) {
        for (let click = 0; click < 2; click++) {
          await page.getByTestId(`sort-sales-${field}`).click();
          await checkPrint(filteredPrint, await ids());
        }
      }
    }
    await page.getByTestId("button-clear-filters").click();
    await waitOrder(["a", "b", "c", "d", "e"]);
    await checkPrint(defaultPrint, sales.map(row => row.id));
    for (const field of ["soldAt", "farmerName", "coldStorageCharge"]) {
      assert.equal(await page.getByTestId(`sort-sales-${field}`).locator("..").getAttribute("aria-sort"), "none");
    }
    await page.getByTestId("sort-sales-farmerName").click();
    await page.getByTestId("input-farmer-filter").fill("arun");
    await waitOrder(["b", "c"]);
    assert.deepEqual((await capturePrint()).rows.map(row => row[3]), ["receipt-b", "receipt-c"]);
    await page.getByTestId("input-cold-bill-filter").fill("999999");
    await waitOrder([]);
    assert.equal(await page.getByTestId("button-print-sales").isDisabled(), true);
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
    await checkPrint(defaultPrint, sales.map(row => row.id));
    assert.equal(await page.getByTestId("sort-sales-coldStorageCharge").locator("..").getAttribute("aria-sort"), "none");
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpectedWrites, []);
  assert.equal(exports.length, 2);
  console.log("Sales sorting and printing browser checks passed: three headers, both directions, keyboard, stable ties, English/Hindi desktop/mobile print invocation, unchanged print cells/columns/totals/styles, filters/reset/empty/reload and unchanged CSV requests. All API traffic intercepted; no database changes.");
} finally {
  await browser.close();
}
