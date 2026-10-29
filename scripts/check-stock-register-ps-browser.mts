// Real app UI, all API traffic intercepted; no real accounting writes.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "playwright/test";

assert.match(process.env.REPLIT_DEV_DOMAIN ?? "", /^[a-z0-9.-]+\.replit\.dev$/i);
const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const output = "generated-artifacts/stock-ps";
await mkdir(output, { recursive: true });
const year = new Date().getFullYear();
const lots = ["sold", "unsold"].map((id, index) => ({
  id, coldStorageId: "fixture", farmerName: "Register Farmer", village: "Village",
  contactNumber: "0000000000", lotNo: String(index + 1), marka: "175/158",
  size: 150, remainingSize: 50, chamberId: "chamber", floor: 1, position: "12/5",
  type: "LR", bagType: "wafer", quality: "good", potatoSize: "large",
  upForSale: 0, saleStatus: "available", createdAt: `${year}-03-01T06:30:00Z`,
}));
let status = "due";
let mode = "ready";
let releaseSummary: (() => void) | undefined;
let summaryCount = 0;
const summaryRows = () => [status, "paid", "partial", null, "unknown", undefined].map((paymentStatus, index) => ({
  saleId: `s${index}`, buyerInitials: index === 1 ? "WRONG" : "BY", isSelfSale: index === 1 ? 1 : 0,
  paymentStatus, soldAt: `${year}-08-20T06:30:00Z`, quantitySold: 10, totalExited: 5,
  coldStorageBillNumber: 300 + index,
  exits: [{ billNumber: 600 + index, bagsExited: 5, exitDate: `${year}-08-21T06:30:00Z` }],
}));
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    (window as any).__name = (fn: unknown) => fn;
    localStorage.setItem("cold_store_auth_token", "stock-ps-fixture");
    if (!localStorage.getItem("language")) localStorage.setItem("language", "en");
  });
  const mutations: string[] = [], errors: string[] = [];
  await context.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== "GET") {
      mutations.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    }
    if (url.pathname === "/api/lots/sales-summary") {
      summaryCount++;
      if (mode === "error") return route.fulfill({ status: 500, json: { error: "Fixture unavailable" } });
      if (mode === "loading") await new Promise<void>(resolve => { releaseSummary = resolve; });
      return route.fulfill({ json: { sold: summaryRows(), unsold: [] } });
    }
    const responses: Record<string, unknown> = {
      "/api/auth/session": {
        user: { id: "user", name: "Operator", mobileNumber: "0000000000", accessType: "edit", coldStorageId: "fixture" },
        coldStorage: { id: "fixture", name: "PS register check", totalCapacity: 1000 },
      },
      "/api/lots": { lots, totalCount: 2, totalGroups: 1, returnedGroups: 1, nextGroupOffset: 1 },
      "/api/analytics/years": [year],
      "/api/chambers": [{ id: "chamber", name: "Chamber 1", capacity: 1000 }],
      "/api/chamber-floors": {},
      "/api/cold-storage": { waferColdCharge: 50, waferHammali: 10, chargeUnit: "bag" },
      "/api/lots/summary": { totalBags: 300, remainingBags: 100, totalSold: 60, totalSoldNotExited: 30 },
      "/api/sauda": [{ id: "promise", lotId: "sold", buyerName: "Promise Buyer", buyerInitials: "SA", quantity: 5 }],
      "/api/sales-history": summaryRows().map(sale => ({
        id: sale.saleId, lotId: "sold", ...sale, farmerName: "Register Farmer", village: "Village",
        contactNumber: "0000000000", bagType: "wafer", quantitySold: 10,
        coldStorageCharge: 600, paidAmount: 0, extraDueToMerchant: 0, payments: [],
      })),
    };
    return route.fulfill({ json: responses[url.pathname] ?? [] });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const field = (id: string) => page.getByTestId(id);
  const ps = (id: string) => field(`cell-payment-status-${id}`);
  const open = () => page.goto(`${base}/stock-register`, { waitUntil: "networkidle" });
  for (const language of ["en", "hi"]) {
    await page.goto(base, { waitUntil: "networkidle" });
    await page.evaluate(value => localStorage.setItem("language", value), language);
    status = "due";
    await open();
    await expect(ps("s0")).toHaveText(language === "en" ? "Due" : "बकाया");
    await expect(ps("s1")).toHaveText(language === "en" ? "Paid" : "भुगतान किया");
    await expect(ps("s2")).toHaveText(language === "en" ? "Partial" : "आंशिक");
    for (const id of ["s3", "s4", "s5", "empty-unsold", "sauda-promise"]) await expect(ps(id)).toBeEmpty();
    await expect(field("cell-mr-s1")).toHaveText("Self");
    await expect(field("cell-mr-s0")).toHaveText("BY");
    await expect(field("cell-mr-sauda-promise")).toContainText("SA");
    const header = page.getByText("PS", { exact: true });
    await expect(header).toHaveAttribute("title", language === "en" ? "Payment Status" : "भुगतान स्थिति");
    const headings = await header.locator("..").locator(":scope > span").allTextContents();
    assert.equal(headings.length, 15);
    assert.equal(headings[headings.indexOf("PS") - 1], "MR");
    assert.equal(headings.indexOf("PS"), 13);
    for (const width of [1440, 1280, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const id of ["s0", "s1", "s2"]) {
        const geometry = await ps(id).evaluate(el => {
          const badge = el.firstElementChild!;
          const rect = el.getBoundingClientRect(), br = badge.getBoundingClientRect();
          const mr = el.previousElementSibling!.getBoundingClientRect();
          const actions = el.nextElementSibling!.getBoundingClientRect();
          return { left: rect.left, right: rect.right, badgeLeft: br.left, badgeRight: br.right,
            mrRight: mr.right, actionsLeft: actions.left, cellWidth: rect.width,
            badgeScroll: badge.scrollWidth, badgeWidth: badge.clientWidth,
            background: getComputedStyle(badge).backgroundColor };
        });
        assert.ok(geometry.badgeLeft >= geometry.left && geometry.badgeRight <= geometry.right + 0.5, JSON.stringify(geometry));
        assert.ok(geometry.left >= geometry.mrRight && geometry.right <= geometry.actionsLeft, "MR/PS/actions must not overlap");
        assert.ok(geometry.cellWidth <= 135, "PS remains narrow");
        assert.ok(geometry.badgeScroll <= geometry.badgeWidth + 1, `Badge text is not clipped: ${JSON.stringify(geometry)}`);
        if (id === "s1") assert.equal(geometry.background, "rgb(22, 163, 74)");
        if (id === "s2") assert.equal(geometry.background, "rgb(226, 232, 240)");
      }
      const row = field("row-lot-sold");
      for (const target of [header.locator(".."), field("row-lot-sold-sale-1")]) {
        assert.equal(await target.evaluate(el => getComputedStyle(el).gridTemplateColumns),
          await row.evaluate(el => getComputedStyle(el).gridTemplateColumns));
      }
      assert.ok(await page.locator(".max-h-\\[70vh\\]").evaluate(el => el.scrollWidth <= el.clientWidth));
      await ps("s2").scrollIntoViewIfNeeded();
      if (width === 1440 || width === 390) await page.screenshot({ path: `${output}/${language}-${width}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Simulate another operator recording and reversing a payment: focus triggers
    // the same live summary refetch; never issue a financial write.
    for (const [next, text] of [
      ["paid", language === "en" ? "Paid" : "भुगतान किया"],
      ["partial", language === "en" ? "Partial" : "आंशिक"],
      ["due", language === "en" ? "Due" : "बकाया"],
    ]) {
      const before = summaryCount;
      status = next;
      await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
      await expect(ps("s0")).toHaveText(text);
      assert.ok(summaryCount > before);
    }
    for (const id of ["button-exit-sale-s0", "button-print-sale-s0", "button-edit-sale-s0"]) {
      await expect(field(id)).toBeEnabled();
    }
    await field("button-edit-sale-s0").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    assert.equal(await ps("s2").locator(":scope > *").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(226, 232, 240)");
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
  }
  mode = "error";
  await open();
  await expect(ps("sauda-promise")).toBeEmpty();
  await expect(ps("empty-unsold")).toBeEmpty();
  await expect(field("cell-exited-sold-sauda-promise")).toContainText("त्रुटि");
  mode = "loading";
  await page.goto(`${base}/stock-register`, { waitUntil: "domcontentloaded" });
  await expect(ps("sauda-promise")).toBeEmpty();
  await expect(ps("empty-unsold")).toBeEmpty();
  await expect(field("cell-exited-sold-sauda-promise")).toContainText("लोड");
  releaseSummary!();
  await expect(ps("s0")).toHaveText("बकाया");
  assert.deepEqual(mutations, []);
  assert.deepEqual(errors, []);
  console.log("Stock PS browser checks passed: per-sale colors/labels, Hindi/English, null/unknown/absent/unsold/Sauda/loading/error, MR, 15-column alignment, desktop/tablet/mobile, focus refresh through paid/partial/due, edit action and dark-mode silver. All API intercepted; no accounting writes.");
} finally {
  releaseSummary?.();
  await browser.close();
}
