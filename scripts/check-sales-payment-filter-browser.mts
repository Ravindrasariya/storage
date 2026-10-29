// Actual application UI with every API call intercepted; no database writes or auth bypass.
import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";

assert.match(process.env.REPLIT_DEV_DOMAIN ?? "", /^[a-z0-9.-]+\.replit\.dev$/i);
const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const sales = [
  { id: "due-a", farmerName: "Beta", paymentStatus: "due", coldStorageCharge: 100, paidAmount: 0, quantitySold: 10, exited: 3 },
  { id: "partial-b", farmerName: "arun", paymentStatus: "partial", coldStorageCharge: 300, paidAmount: 50, quantitySold: 20, exited: 4 },
  { id: "paid-c", farmerName: "Arun", paymentStatus: "paid", coldStorageCharge: 200, paidAmount: 200, quantitySold: 30, exited: 5 },
  { id: "due-d", farmerName: "सीता", paymentStatus: "due", coldStorageCharge: 150, paidAmount: 0, quantitySold: 40, exited: 6 },
].map((row, index) => ({
  ...row, lotNo: row.id, village: "Filter Village", coldStorageBillNumber: index + 1,
  bagType: index === 3 ? "wafer" : "seed", originalLotSize: 100, remainingSizeAtSale: 100,
  soldAt: "2026-10-01T06:30:00Z", entryDate: "2026-03-01T06:30:00Z",
  payments: [], isSelfSale: 1, paidCash: row.paidAmount, paymentMode: "cash",
}));
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    (window as any).__name = (fn: unknown) => fn;
    localStorage.setItem("cold_store_auth_token", "browser-payment-fixture");
    if (!localStorage.getItem("language")) localStorage.setItem("language", "en");
  });
  const errors: string[] = [], writes: string[] = [];
  const exportQueries: URLSearchParams[] = [];
  await context.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (request.method() !== "GET") {
      if (path === "/api/export/token" && request.method() === "POST")
        return route.fulfill({ json: { downloadToken: "browser-filter-download" } });
      writes.push(`${request.method()} ${path}`);
      return route.abort();
    }
    const params = url.searchParams, status = params.get("paymentStatus");
    const rows = sales.filter(row =>
      (!status || status === "all" || (status === "due_partial"
        ? row.paymentStatus === "due" || row.paymentStatus === "partial" : row.paymentStatus === status)) &&
      (!params.get("farmerName") || row.farmerName.toLowerCase().includes(params.get("farmerName")!.toLowerCase())) &&
      (!params.get("bagType") || row.bagType === params.get("bagType")) &&
      (!params.get("coldStorageBillNumber") || String(row.coldStorageBillNumber) === params.get("coldStorageBillNumber")));
    if (path === "/api/export/sales") {
      exportQueries.push(params);
      return route.fulfill({ contentType: "text/csv",
        headers: { "Content-Disposition": 'attachment; filename="payment-filter.csv"' },
        body: ["Receipt #", ...rows.map(row => row.id)].join("\n") });
    }
    const responses: Record<string, unknown> = {
      "/api/auth/session": {
        user: { id: "filter-user", name: "Filter Operator", mobileNumber: "0000000000", accessType: "edit", coldStorageId: "filter" },
        coldStorage: { id: "filter", name: "Payment Filter Check", totalCapacity: 100, waferRate: 60, seedRate: 60 },
      },
      "/api/sales-history": rows,
      "/api/sales-history/years": [2026],
      "/api/sales-history/exits-summary": { totalBagsExited: rows.reduce((sum, row) => sum + row.exited, 0) },
    };
    await route.fulfill({ json: responses[path] ?? [] });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const waitRows = async (expected: string[]) => {
    await expect(page.locator('[data-testid^="row-sale-"]')).toHaveCount(expected.length);
    await expect.poll(() => page.locator('[data-testid^="row-sale-"]').evaluateAll(nodes =>
      nodes.map(node => node.getAttribute("data-testid")!.replace("row-sale-", "")))).toEqual(expected);
  };
  for (const language of ["en", "hi"]) {
    await page.goto(base, { waitUntil: "networkidle" });
    await page.evaluate(language => {
      localStorage.setItem("language", language);
      localStorage.removeItem("salesHistoryFilters");
    }, language);
    await page.goto(`${base}/sales-history`, { waitUntil: "networkidle" });
    await waitRows(sales.map(row => row.id));
    const combinedLabel = language === "en" ? "Due+Partial" : "बकाया+आंशिक";
    const select = async (label: string) => {
      await page.getByTestId("select-payment-filter").click();
      await page.getByRole("option", { name: label, exact: true }).click();
    };
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const [label, expected] of [
        [language === "en" ? "Due" : "बकाया", ["due-a", "due-d"]],
        [language === "en" ? "Partial" : "आंशिक", ["partial-b"]],
        [language === "en" ? "Paid" : "भुगतान किया", ["paid-c"]],
        [language === "en" ? "All" : "सभी", sales.map(row => row.id)],
        [combinedLabel, ["due-a", "partial-b", "due-d"]],
      ] as Array<[string, string[]]>) {
        await select(label);
        await waitRows(expected);
      }
      await expect(page.getByTestId("text-total-bags")).toHaveText("70");
      await expect(page.getByTestId("text-bags-sold-exited")).toHaveText("70/13");
      await expect(page.getByTestId("text-amount-due")).toContainText("500");
      await expect(page.getByTestId("card-summary-cold-charges")).toContainText("550");
      await page.getByTestId("select-payment-filter").click();
      assert.equal(await page.getByRole("option").count(), 5);
      await page.screenshot({ path: `/tmp/due-partial-${language}-${width}.png` });
      await page.keyboard.press("Escape");
    }
    await page.reload({ waitUntil: "networkidle" });
    await waitRows(["due-a", "partial-b", "due-d"]);
    await expect(page.getByTestId("select-payment-filter")).toHaveText(combinedLabel);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("salesHistoryFilters")!).paymentFilter), "due_partial");
    await page.getByTestId("sort-sales-coldStorageCharge").click();
    await waitRows(["partial-b", "due-d", "due-a"]);
    await page.evaluate(() => {
      (window as any).printedFilterDocument = "";
      window.open = (() => ({ document: {
        write(html: string) { (window as any).printedFilterDocument = html; }, close() {},
      } })) as any;
    });
    await page.getByTestId("button-print-sales").click();
    const printed = await page.evaluate(() => {
      const doc = new DOMParser().parseFromString((window as any).printedFilterDocument, "text/html");
      return {
        receipts: Array.from(doc.querySelectorAll("tbody tr")).map(row => row.querySelectorAll("td")[3]?.textContent),
        meta: doc.querySelector(".meta")?.textContent,
      };
    });
    assert.deepEqual(printed.receipts, ["partial-b", "due-d", "due-a"]);
    assert.ok(printed.meta?.includes(combinedLabel));
    for (const type of ["overall", "kata"]) {
      await expect(page.getByTestId("button-export-sales")).toBeEnabled();
      // ArrowDown explicitly opens the menu rather than toggling a closing menu.
      await page.getByTestId("button-export-sales").press("ArrowDown");
      const option = page.getByTestId(`menu-export-sales-${type}`);
      await expect(option).not.toHaveAttribute("data-disabled", "");
      await Promise.all([
        page.waitForEvent("download"),
        option.press("Enter"),
      ]).catch(async error => {
        console.error("Download check failed", { language, type, exportRequests: exportQueries.length,
          toast: await page.locator('[role="status"]').allTextContents(), errors, writes });
        throw error;
      });
      const query = exportQueries.at(-1)!;
      assert.equal(query.get("paymentStatus"), "due_partial");
      assert.equal(query.get("exportType"), type);
      assert.equal(query.get("language"), language);
      await page.keyboard.press("Escape");
      await expect(option).toBeHidden();
    }
    await page.getByTestId("input-farmer-filter").fill("arun");
    await waitRows(["partial-b"]);
    await expect(page.getByTestId("text-bags-sold-exited")).toHaveText("20/4");
    await page.getByTestId("input-farmer-filter").fill("");
    await page.getByTestId("select-type-filter").click();
    await page.getByRole("option", { name: language === "en" ? "Seed" : "बीज", exact: true }).click();
    await waitRows(["partial-b", "due-a"]);
    await expect(page.getByTestId("text-bags-sold-exited")).toHaveText("30/7");
    await page.getByTestId("input-cold-bill-filter").fill("999999");
    await waitRows([]);
    await expect(page.getByTestId("button-print-sales")).toBeDisabled();
    await page.getByTestId("button-clear-filters").click();
    await waitRows(sales.map(row => row.id));
    await expect(page.getByTestId("select-payment-filter")).toHaveText(language === "en" ? "All" : "सभी");
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  assert.equal(exportQueries.length, 4);
  console.log("Payment status browser checks passed: Due/Partial/Paid/All/Due+Partial, totals, exit summary, sorting, print rows and localized filter label, both CSV requests, persistence/reset, intersecting filters and empty states on English/Hindi desktop/mobile. Every API intercepted.");
} finally {
  await browser.close();
}
