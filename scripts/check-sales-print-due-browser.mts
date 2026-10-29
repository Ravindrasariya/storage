// UI and generated PDF checks use intercepted API fixtures; never access a database.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { chromium, expect } from "playwright/test";

assert.match(process.env.REPLIT_DEV_DOMAIN ?? "", /^[a-z0-9.-]+\.replit\.dev$/i);
const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const output = "generated-artifacts/sales-print-due";
await mkdir(output, { recursive: true });
const cases = [
  { coldStorageCharge: 99999.99, paidAmount: 0, extraDueToMerchant: 0, paymentStatus: "due", expected: 99999.99 },
  { coldStorageCharge: 90000, paidAmount: 20000, extraDueToMerchant: 123.45, paymentStatus: "partial", expected: 70123.45 },
  { coldStorageCharge: 500, paidAmount: 600, extraDueToMerchant: 0, paymentStatus: "paid", expected: 0 },
  { coldStorageCharge: 700, paidAmount: 700, extraDueToMerchant: 12.5, paymentStatus: "paid", expected: 12.5 },
  { coldStorageCharge: null, paidAmount: null, extraDueToMerchant: null, paymentStatus: "due", expected: 0 },
  { coldStorageCharge: 40000, paidAmount: 30000, extraDueToMerchant: 0, paymentStatus: "partial", expected: 10000 },
];
const currency = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
let many = false;
const fixtureRows = () => Array.from({ length: many ? 80 : cases.length }, (_, index) => {
  const item = cases[index % cases.length];
  return {
    ...item, id: `print-${index}`, lotNo: `R${String(index).padStart(3, "0")}`, marka: "265/158",
    farmerName: index % 2 ? "विष्णु प्रसाद पिता लक्ष्मण प्रसाद पाटीदार" : "Vishnu Prasad s/o Laxman Prasad Patidar",
    buyerName: "Shree Ganesh Potato Trading Company", village: "Sunwal Gopali",
    coldStorageBillNumber: 700 + index, bagType: "seed", isSelfSale: 0,
    originalLotSize: 150, remainingSizeAtSale: 140, quantitySold: 80,
    soldAt: "2026-10-01T06:30:00Z", entryDate: "2026-03-01T06:30:00Z",
    payments: [], paidCash: item.paidAmount ? 15000 : 0,
    paidAccount: item.paidAmount ? 14999.99 : 0,
    dueAmount: 999999, // Deliberately stale: the display must match summary calculation instead.
  };
});
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    (window as any).__name = (fn: unknown) => fn;
    localStorage.setItem("cold_store_auth_token", "print-due-fixture");
    if (!localStorage.getItem("language")) localStorage.setItem("language", "en");
  });
  const errors: string[] = [], unexpectedWrites: string[] = [];
  await context.route("**/api/**", async route => {
    if (route.request().method() !== "GET") {
      unexpectedWrites.push(route.request().method() + " " + new URL(route.request().url()).pathname);
      return route.abort();
    }
    const path = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      "/api/auth/session": {
        user: { id: "print-user", name: "Print Operator", mobileNumber: "0000000000", accessType: "edit", coldStorageId: "print" },
        coldStorage: { id: "print", name: "Printed Due Check", totalCapacity: 100, waferRate: 60, seedRate: 60 },
      },
      "/api/sales-history": fixtureRows(),
      "/api/sales-history/years": [2026],
      "/api/sales-history/exits-summary": { totalBagsExited: 0 },
    };
    return route.fulfill({ json: responses[path] ?? [] });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  for (const language of ["en", "hi"]) {
    await page.goto(base, { waitUntil: "networkidle" });
    await page.evaluate(language => {
      localStorage.setItem("language", language);
      localStorage.removeItem("salesHistoryFilters");
    }, language);
    many = false;
    await page.goto(`${base}/sales-history`, { waitUntil: "networkidle" });
    for (const size of ["single", "multi"]) {
      many = size === "multi";
      if (many) await page.reload({ waitUntil: "networkidle" });
      await expect(page.locator('[data-testid^="row-sale-"]')).toHaveCount(fixtureRows().length);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await page.evaluate(() => {
          (window as any).duePrintHtml = "";
          window.open = (() => ({ document: {
            write(html: string) { (window as any).duePrintHtml = html; }, close() {},
          } })) as any;
        });
        await page.getByTestId("button-print-sales").click();
        const html = await page.evaluate(() => (window as any).duePrintHtml as string);
        const print = await context.newPage();
        await print.setViewportSize({ width: 1062, height: 740 });
        await print.emulateMedia({ media: "print" });
        await print.setContent(html.replace(/<script>[\s\S]*?<\/script>/g, ""));
        await print.evaluate(() => document.fonts.ready);
        const layout = await print.evaluate(() => {
          const table = document.querySelector("table")!;
          const rows = Array.from(table.querySelectorAll("tbody tr"));
          const header = table.querySelector("th:last-child")!;
          const overflow = rows.flatMap((row, index) =>
            Array.from(row.querySelectorAll("td")).flatMap((cell, column) => {
              const range = document.createRange();
              range.selectNodeContents(cell);
              const box = cell.getBoundingClientRect();
              return Array.from(range.getClientRects()).some(rect => rect.right > box.right + 0.6 || rect.left < box.left - 0.6)
                ? [{ index, column, text: cell.textContent }] : [];
            }));
          return {
            headers: table.querySelectorAll("th").length,
            headerLines: (header as HTMLElement).innerText,
            amounts: rows.map(row => row.lastElementChild?.textContent),
            columns: table.querySelectorAll("col").length,
            font: getComputedStyle(table).fontSize,
            dueAlign: getComputedStyle(rows[0].lastElementChild!).textAlign,
            dueWidth: rows[0].lastElementChild!.getBoundingClientRect().width,
            tableWidth: table.getBoundingClientRect().width,
            right: table.getBoundingClientRect().right,
            available: document.documentElement.clientWidth,
            overflow,
          };
        });
        assert.equal(layout.headers, 15);
        assert.equal(layout.columns, 15);
        assert.equal(layout.headerLines, language === "en" ? "Due\nAmount" : "बकाया\nराशि");
        assert.deepEqual(layout.amounts, fixtureRows().map(row => currency(row.expected)));
        assert.equal(layout.font, "11px", "Keep existing report text size");
        assert.equal(layout.dueAlign, "right");
        assert.ok(layout.dueWidth / layout.tableWidth <= 0.075, "Due remains narrow");
        assert.ok(layout.right <= layout.available, "No horizontal page overflow");
        assert.deepEqual(layout.overflow, [], "All row text must stay inside its cell");
        if (width === 1440) {
          const file = `${output}/${language}-${size}.pdf`;
          await print.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
          const info = execFileSync("pdfinfo", [file], { encoding: "utf8" });
          const pages = Number(info.match(/Pages:\s+(\d+)/)?.[1]);
          assert.ok(size === "single" ? pages === 1 : pages > 1, info);
          const dimensions = info.match(/Page size:\s+([\d.]+) x ([\d.]+) pts/)!;
          assert.ok(Math.abs(Number(dimensions[1]) - 841.89) < 1 && Math.abs(Number(dimensions[2]) - 595.28) < 1, "A4 landscape with Chromium rounding tolerance");
          const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
          for (let index = 0; index < fixtureRows().length; index++) {
            assert.ok(text.includes(`R${String(index).padStart(3, "0")}`), "Every sale survives PDF pagination");
          }
          assert.ok(text.includes("99,999.99"), "Five-digit due survives PDF rendering");
          if (language === "en") assert.ok((text.match(/Due/g) ?? []).length >= pages, "Repeat final header on every page");
          console.log(`${language}/${size}: ${pages} A4 landscape page(s), narrow due fits ₹99,999.99, no row-cell overflow`);
        }
        await print.close();
      }
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpectedWrites, []);
  console.log("Printed Due checks passed: 15 columns, exact summary-aligned values, two-line bilingual headers, desktop/mobile invocation, single/multi-page PDFs, long names and mixed payment modes. No database access.");
} finally {
  await browser.close();
}
