// All API traffic is intercepted. This test never reads or writes a database.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { farmerRows } from "./check-discount-farmers.mts";
import { sortedDiscountFarmers } from "../client/src/lib/discount-farmers.ts";

assert.match(process.env.REPLIT_DEV_DOMAIN ?? "", /^[a-z0-9.-]+\.replit\.dev$/i);
const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true });
  await context.addInitScript(() => {
    (window as any).__name = (fn: unknown) => fn;
    localStorage.setItem("cold_store_auth_token", "mock-discount-test-only");
    if (!localStorage.getItem("language")) localStorage.setItem("language", "en");
  });
  let rows = [...farmerRows];
  const posts: any[] = [];
  const errors: string[] = [];
  await context.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      assert.equal(path, "/api/discounts", `Unexpected write: ${path}`);
      posts.push(request.postDataJSON());
      return route.fulfill({ json: { id: "mock-discount" } });
    }
    const responses: Record<string, unknown> = {
      "/api/auth/session": {
        user: { id: "mock-user", name: "Test Operator", mobileNumber: "0000000000", accessType: "edit", coldStorageId: "mock" },
        coldStorage: { id: "mock", name: "Discount picker test", totalCapacity: 100, waferRate: 60, seedRate: 60 },
      },
      "/api/farmer-ledger/dues-for-discount": rows,
      "/api/farmer-ledger": { farmers: [] },
      "/api/buyer-ledger": { buyers: [] },
      "/api/analytics/payments": {},
      "/api/dashboard/stats": {},
    };
    await route.fulfill({ json: responses[path] ?? [] });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/cash-management`, { waitUntil: "networkidle" });
  const field = (id: string) => page.getByTestId(id);
  await field("tab-expense").click();
  async function mode(label: string) {
    await field("select-expense-payment-mode").click();
    await page.getByRole("option", { name: label, exact: true }).click();
  }
  await mode("Discount");
  const trigger = field("select-discount-farmer");
  const search = field("input-discount-farmer-search");
  const options = page.locator('[data-testid^="discount-farmer-option-"]');
  const option = (id: string) => field(`discount-farmer-option-${id}`);
  const ids = async () => options.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-testid")!.replace("discount-farmer-option-", "")));
  const all = sortedDiscountFarmers(farmerRows, "en").map(row => row.id);
  await trigger.click();
  await search.waitFor();
  assert.deepEqual(await ids(), all);
  for (const [query, expected] of [
    ["  ARUN ", ["a0", "a1", "a2"]], ["  WEST ", ["b"]], ["000000004", ["a2"]],
    ["सीता", ["h2"]], ["उज्जैन", ["h2"]], ["not found", []], ["   ", all],
  ] as [string, string[]][]) {
    await search.fill(query);
    await page.waitForTimeout(70);
    assert.deepEqual(await ids(), expected, query);
    if (!expected.length) assert.equal(await page.getByText("No farmers found", { exact: true }).isVisible(), true);
  }
  await search.fill("000000004");
  // The actual command input must support keyboard selection by ID.
  await search.press("ArrowDown");
  await search.press("Enter");
  await search.waitFor({ state: "hidden" });
  assert.match(await trigger.innerText(), /9000000004/);
  await field("input-discount-amount").fill("25");
  const allocation = field("input-allocation-farmer-self");
  await allocation.waitFor({ timeout: 5000 }).catch(async error => {
    console.error((await page.locator("main").innerText()).slice(0, 5500));
    console.error("Browser errors:", errors);
    throw error;
  });
  assert.equal(await allocation.inputValue(), "25");
  await trigger.click();
  assert.equal(await search.inputValue(), "");
  await search.fill("  WEST ");
  rows = [...rows].reverse();
  await page.evaluate(async () => {
    const { queryClient } = await import("/src/lib/queryClient.ts");
    await queryClient.invalidateQueries({ queryKey: ["/api/farmer-ledger/dues-for-discount"] });
  });
  assert.equal(await search.inputValue(), "  WEST ", "Background refresh erased search");
  assert.match(await trigger.innerText(), /9000000004/);
  await search.press("Escape");
  await search.waitFor({ state: "hidden" });
  assert.equal(await allocation.inputValue(), "25", "Dismissing search changed allocation");
  await trigger.click();
  assert.equal(await search.inputValue(), "");
  await option("b").click();
  assert.match(await trigger.innerText(), /bala/);
  assert.equal(await allocation.inputValue(), "25");
  await field("input-discount-remarks").fill("Picker regression");
  await field("button-record-discount").click();
  await page.waitForTimeout(250);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].farmerId, "b");
  assert.equal(posts[0].totalAmount, 25);
  assert.equal(posts[0].remarks, "Picker regression");
  assert.deepEqual(posts[0].buyerAllocations, [{
    buyerName: "bala - 9000000002 - West", buyerLedgerId: null, isFarmerSelf: true, amount: 25,
  }]);
  assert.ok(Number.isFinite(new Date(posts[0].discountDate).getTime()));
  await trigger.click();
  await search.fill("stale");
  await search.press("Escape");
  await mode("Cash");
  await mode("Discount");
  await trigger.click();
  assert.equal(await search.inputValue(), "");
  assert.deepEqual(await ids(), all);
  await search.press("Escape");
  await field("tab-inward").click();
  await field("tab-expense").click();
  await trigger.click();
  assert.equal(await search.inputValue(), "");
  await search.press("Escape");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await trigger.click();
    await search.fill("arun");
    const bounds = await field("discount-farmer-popover").boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
    await page.screenshot({ path: `/tmp/discount-farmers-${width}.png` });
    if (width === 390) await option("a1").tap();
    else await option("a1").click();
    assert.match(await trigger.innerText(), /9000000003/);
  }
  rows = rows.filter(row => row.totalDue < 1);
  await page.evaluate(async () => {
    const { queryClient } = await import("/src/lib/queryClient.ts");
    await queryClient.invalidateQueries({ queryKey: ["/api/farmer-ledger/dues-for-discount"] });
  });
  await trigger.click();
  await page.getByText("No farmers with pending dues", { exact: true }).waitFor();
  assert.equal(await options.count(), 0);
  rows = [...farmerRows];
  await page.evaluate(() => localStorage.setItem("language", "hi"));
  await page.reload({ waitUntil: "networkidle" });
  await field("tab-expense").click();
  await trigger.click();
  await search.waitFor();
  assert.deepEqual(await ids(), sortedDiscountFarmers(farmerRows, "hi").map(row => row.id));
  await search.fill("देवास");
  assert.deepEqual(await ids(), ["h1"]);
  await search.fill("missing");
  await page.getByText("कोई किसान नहीं मिला", { exact: true }).waitFor();
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("Discount picker browser checks passed: actual Cash form, search, sort, duplicates, keyboard, lifecycle, refresh, allocation/submit payload and desktop/mobile bounds.");
} finally {
  await browser.close();
}
