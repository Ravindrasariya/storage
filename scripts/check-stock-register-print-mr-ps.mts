// Exercise the real print and shared-PDF buttons with fully intercepted APIs.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "playwright/test";

assert.match(process.env.REPLIT_DEV_DOMAIN ?? "", /^[a-z0-9.-]+\.replit\.dev$/i);
const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const output = "generated-artifacts/stock-print-mr-ps";
await mkdir(output, { recursive: true });
const year = new Date().getFullYear();
const lots = ["sold", "unsold"].map((id, index) => ({
  id, coldStorageId: "fixture", farmerName: "Print Fixture", village: "Village",
  contactNumber: "0000000000", lotNo: String(index + 1), marka: "131/36",
  size: 150, remainingSize: 50, chamberId: "chamber", floor: 3, position: "38/25+37/11",
  type: "LR", bagType: "seed", quality: "good", potatoSize: "large",
  upForSale: 0, saleStatus: "available", createdAt: `${year}-03-01T06:30:00Z`,
}));
const statuses = ["due", "paid", "partial", null, "unknown", "due"];
const sales = statuses.map((paymentStatus, index) => ({
  saleId: `s${index}`, buyerInitials: index === 3 ? null : index === 4 ? "<b>BY</b>" : "RLT",
  isSelfSale: index === 1 || index === 5 ? 1 : 0, paymentStatus,
  soldAt: `${year}-08-20T06:30:00Z`, quantitySold: 10, totalExited: 5,
  coldStorageBillNumber: 300 + index,
  exits: Array.from({ length: index === 1 ? 3 : 1 }, (_, exit) => ({
    billNumber: 600 + index + exit, bagsExited: 5, exitDate: `${year}-08-${21 + exit}T06:30:00Z`,
  })),
}));
let mode = "ready";
let release: (() => void) | undefined;
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(() => {
    (window as any).__name = (fn: unknown) => fn;
    // html2canvas also creates sandboxed/about:blank frames without storage.
    if (location.hostname.endsWith(".replit.dev")) {
      localStorage.setItem("cold_store_auth_token", "print-fixture");
      if (!localStorage.getItem("language")) localStorage.setItem("language", "en");
    }
    window.print = () => {};
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
  });
  const mutations: string[] = [], errors: string[] = [];
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  await context.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      mutations.push(`${request.method()} ${path}`);
      return route.abort();
    }
    if (path === "/api/lots/sales-summary") {
      if (mode === "error") return route.fulfill({ status: 500, json: { error: "Fixture unavailable" } });
      if (mode === "loading") await new Promise<void>(resolve => { release = resolve; });
      return route.fulfill({ json: { sold: sales, unsold: [] } });
    }
    const responses: Record<string, unknown> = {
      "/api/auth/session": {
        user: { id: "user", name: "Operator", mobileNumber: "0000000000", accessType: "edit", coldStorageId: "fixture" },
        coldStorage: { id: "fixture", name: "Stock print fixture", totalCapacity: 1000 },
      },
      "/api/lots": { lots, totalCount: 2, totalGroups: 1, returnedGroups: 1, nextGroupOffset: 1 },
      "/api/lots/search": lots,
      "/api/analytics/years": [year],
      "/api/chambers": [{ id: "chamber", name: "Chamber 1", capacity: 1000 }],
      "/api/chamber-floors": {},
      "/api/cold-storage": { seedColdCharge: 50, seedHammali: 10, chargeUnit: "bag" },
      "/api/lots/summary": { totalBags: 300, remainingBags: 100, totalSold: 60, totalSoldNotExited: 30,
        expectedColdCharges: 15000, chargesPaid: 600, chargesDue: 1200 },
      "/api/sauda": [],
      "/api/sales-history": sales.map(sale => ({
        id: sale.saleId, lotId: "sold", ...sale, farmerName: "Print Fixture", village: "Village",
        contactNumber: "0000000000", bagType: "seed", coldStorageCharge: 600,
        paidAmount: 0, extraDueToMerchant: 0, payments: [],
      })),
    };
    return route.fulfill({ json: responses[path] ?? [] });
  });
  const page = await context.newPage();
  const field = (id: string) => page.getByTestId(id);
  const search = async () => {
    await page.goto(`${base}/stock-register`, { waitUntil: "networkidle" });
    await field("tab-search-phone").click();
    await field("input-search-phone").fill("0000000000");
    await field("input-search-phone").press("Enter");
    await expect(field("button-print-filtered")).toBeVisible();
  };
  const print = async () => {
    await field("button-print-filtered").click();
    const waiting = page.waitForEvent("popup");
    await field("menu-print").click();
    const popup = await waiting;
    await popup.locator(".lot-table").waitFor();
    return popup;
  };
  for (const language of ["en", "hi"]) {
    await page.goto(base, { waitUntil: "networkidle" });
    await page.evaluate(value => localStorage.setItem("language", value), language);
    await search();
    await expect(field("cell-payment-status-s0")).toHaveText(language === "en" ? "Due" : "बकाया");
    const popup = await print();
    await popup.setViewportSize({ width: 794, height: 1123 });
    await popup.emulateMedia({ media: "print" });
    const table = popup.locator(".lot-table").first();
    const headings = await table.locator("th").allTextContents();
    assert.equal(headings.length, 13);
    assert.deepEqual(headings.slice(-2), ["MR", "PS"]);
    const rows = table.locator("tbody tr");
    assert.equal(await rows.count(), 7);
    for (const [index, mr] of [[0, "RLT"], [1, "Self"], [3, ""], [4, "<b>BY</b>"], [5, "Self"], [6, ""]] as const) {
      const cells = rows.nth(index).locator("td.rh");
      assert.equal(await cells.count(), 6);
      await expect(cells.nth(4)).toHaveText(mr);
    }
    assert.equal(await rows.first().locator("td.lh").count(), 7);
    await expect(rows.first().locator("td.lh").first()).toHaveAttribute("rowspan", "6");
    const labels = language === "en" ? ["Due", "Paid", "Partial"] : ["बकाया", "भुगतान किया", "आंशिक"];
    for (let index = 0; index < 3; index++) {
      const cell = rows.nth(index).locator("td.rh").nth(5);
      await expect(cell).toHaveText(labels[index]);
      const badge = cell.locator("span");
      const geometry = await badge.evaluate(el => {
        const box = el.getBoundingClientRect(), cell = el.parentElement!.getBoundingClientRect();
        return { color: getComputedStyle(el).backgroundColor, scroll: el.scrollWidth, client: el.clientWidth,
          left: box.left, right: box.right, cellLeft: cell.left, cellRight: cell.right };
      });
      assert.ok(geometry.left >= geometry.cellLeft && geometry.right <= geometry.cellRight + 0.5);
      assert.ok(geometry.scroll <= geometry.client + 1, JSON.stringify(geometry));
      assert.ok(!["rgb(254, 243, 199)", "rgba(0, 0, 0, 0)"].includes(geometry.color));
      if (index === 2) assert.equal(geometry.color, "rgb(226, 232, 240)");
    }
    for (const index of [3, 4, 6]) await expect(rows.nth(index).locator("td.rh").nth(5)).toBeEmpty();
    assert.equal(await table.locator("b, img, script").count(), 0, "Escape buyer initials");
    await expect(rows.nth(1).locator("td.rh").nth(1)).toContainText(`23-08-${year}`);
    await expect(rows.nth(1).locator("td.rh").nth(2)).toContainText("603");
    const widths = await table.evaluate(el => {
      const widths = Array.from(el.querySelectorAll("col")).map(col => Number.parseFloat(col.style.width));
      return { blue: widths.slice(0, 7).reduce((a, b) => a + b, 0), total: widths.reduce((a, b) => a + b, 0),
        width: el.getBoundingClientRect().width, parentWidth: el.parentElement!.clientWidth };
    });
    assert.equal(widths.total, 100);
    assert.ok(widths.blue < 50 && widths.width <= widths.parentWidth);
    await popup.screenshot({ path: `${output}/print-${language}.png`, fullPage: true });
    await popup.pdf({ path: `${output}/print-${language}.pdf`, format: "A4", printBackground: true });
    await popup.close();
    await field("button-print-filtered").click();
    const downloading = page.waitForEvent("download", { timeout: 60000 });
    await field("menu-share").click();
    const download = await downloading;
    assert.match(download.suggestedFilename(), /Stock_Report\.pdf$/);
    await download.saveAs(`${output}/shared-${language}.pdf`);
  }
  // Error/loading summaries must not invent status badges or Self identity.
  for (const state of ["error", "loading"]) {
    mode = state;
    if (state === "loading") {
      await page.goto(`${base}/stock-register`, { waitUntil: "domcontentloaded" });
      await field("tab-search-phone").click();
      await field("input-search-phone").fill("0000000000");
      await field("input-search-phone").press("Enter");
    } else await search();
    const popup = await print();
    for (const cell of await popup.locator("tbody tr").all()) {
      const right = cell.locator("td.rh");
      assert.equal(await right.count(), 6);
      await expect(right.nth(4)).toBeEmpty();
      await expect(right.nth(5)).toBeEmpty();
    }
    await popup.close();
    release?.();
  }
  assert.deepEqual(mutations, []);
  assert.deepEqual(errors, []);
  console.log("Stock print/PDF checks passed: MR, Self, compact colored PS, blank/missing/unknown/error/loading, 13-column rowspans, escaping, multiple exits, 44% blue area, print and actual shared PDF downloads in English/Hindi; no accounting writes.");
} finally {
  release?.();
  await browser.close();
}
