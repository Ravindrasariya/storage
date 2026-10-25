// Real Stock Register with all API calls intercepted; never touches a database.
import assert from "node:assert/strict";
import { chromium } from "playwright";

assert.match(process.env.REPLIT_DEV_DOMAIN ?? "", /^[a-z0-9.-]+\.replit\.dev$/i);
const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    (window as any).__name = (fn: unknown) => fn;
    localStorage.setItem("cold_store_auth_token", "mock-stock-mr-only");
    localStorage.setItem("language", "en");
  });
  const year = new Date().getFullYear();
  const lot = (id: string, farmer = "Register Farmer") => ({
    id, coldStorageId: "mock", farmerName: farmer, village: "Village", tehsil: "T", district: "D",
    state: "S", contactNumber: "0000000000", lotNo: id === "one" ? "1" : "2", marka: "M1",
    size: 100, remainingSize: 50, chamberId: "chamber", floor: 1, position: "12/5",
    type: "Jyoti", bagType: "wafer", quality: "good", potatoSize: "large", assayingType: "visual",
    upForSale: 0, saleStatus: "available", createdAt: `${year}-03-01T12:00:00+05:30`,
  });
  const lots = [lot("one"), lot("unsold")];
  let initials: string | null = "rLt";
  let summaryMode = "ready";
  let paging = false;
  let pageTwoRequested = false;
  let summaryRequests = 0;
  let searches = 0;
  let edits = 0;
  const long = "आरएलटी-LONG-INITIALS-EXAMPLE";
  const sale = (saleId: string, buyerInitials: string | null, isSelfSale = 0) => ({
    saleId, buyerInitials, isSelfSale, soldAt: `${year}-08-20T12:00:00+05:30`,
    quantitySold: 10, totalExited: 5, coldStorageBillNumber: 321,
    exits: [{ billNumber: 654, bagsExited: 5, exitDate: `${year}-08-21T12:00:00+05:30` }],
  });
  await context.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === "/api/buyer-ledger/buyer/check-merge") {
      return route.fulfill({ json: { willMerge: false } });
    }
    if (request.method() === "PATCH" && url.pathname === "/api/buyer-ledger/buyer") {
      initials = request.postDataJSON().initials?.trim() || null;
      edits++;
      return route.fulfill({ json: { merged: false } });
    }
    assert.equal(request.method(), "GET", `Unexpected mutation: ${url.pathname}`);
    if (url.pathname === "/api/lots/sales-summary") {
      summaryRequests++;
      if (summaryMode === "error") return route.fulfill({ status: 500, json: { error: "Test summary failure" } });
      if (summaryMode === "loading") await new Promise(resolve => setTimeout(resolve, 1500));
      return route.fulfill({ json: Object.fromEntries((url.searchParams.get("lotIds") ?? "").split(",").map(id => [
        id, id === "unsold" ? [] : [sale("merchant", initials), sale("self", "Wrong", 1), sale("blank", null), sale("long", long)],
      ])) });
    }
    if (url.pathname === "/api/lots") {
      const offset = Number(url.searchParams.get("groupOffset") ?? 0);
      if (offset > 0) pageTwoRequested = true;
      return route.fulfill({ json: {
        lots: offset > 0 ? [lot("later", "Later Farmer")] : lots,
        totalCount: paging ? 3 : 2, totalGroups: paging ? 2 : 1,
        returnedGroups: 1, nextGroupOffset: offset > 0 ? 2 : 1,
      } });
    }
    if (url.pathname === "/api/lots/search") {
      searches++;
      return route.fulfill({ json: [lots[0]] });
    }
    const responses: Record<string, unknown> = {
      "/api/auth/session": {
        user: { id: "mock-user", name: "Operator", mobileNumber: "0000000000", accessType: "edit", coldStorageId: "mock" },
        coldStorage: { id: "mock", name: "Register test", totalCapacity: 1000, waferRate: 60, seedRate: 60 },
      },
      "/api/chambers": [{ id: "chamber", name: "Chamber 1", capacity: 1000 }],
      "/api/chamber-floors": {},
      "/api/cold-storage": { waferColdCharge: 50, waferHammali: 10, chargeUnit: "bag" },
      "/api/buyer-ledger": {
        buyers: [{
          id: "buyer", buyerId: "BY1", coldStorageId: "mock", buyerName: "Register Buyer", initials,
          address: "", contactNumber: "", createdAt: `${year}-03-01T12:00:00+05:30`,
          isArchived: 0, isFlagged: 0, pyReceivables: 0, advanceDue: 0, dueTransferOut: 0,
          dueTransferIn: 0, salesDue: 0, buyerExtras: 0, netDue: 0,
        }],
        summary: { totalBuyers: 1, pyReceivables: 0, advanceDue: 0, dueTransferOut: 0, dueTransferIn: 0, salesDue: 0, buyerExtras: 0, netDue: 0 },
      },
      "/api/analytics/years": [year],
      "/api/lots/search": [lots[0]],
      "/api/lots/summary": { totalBags: 200, remainingBags: 100, totalSold: 40, totalSoldNotExited: 20, chargesPaid: 0, chargesDue: 0, expectedColdCharges: 12000 },
    };
    await route.fulfill({ json: responses[url.pathname] ?? [] });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const field = (id: string) => page.getByTestId(id);
  const open = async () => {
    await page.goto(`${base}/stock-register`, { waitUntil: "networkidle" });
    await field("row-lot-one").waitFor({ timeout: 7000 }).catch(async error => {
      console.error("Browser errors:", errors);
      console.error((await page.locator("body").innerText()).slice(0, 4500));
      throw error;
    });
  };
  await open();
  for (const [id, value] of [["merchant", "rLt"], ["self", "Self"], ["blank", ""], ["long", long], ["empty-unsold", ""]]) {
    assert.equal(await field(`cell-mr-${id}`).textContent(), value);
  }
  assert.equal(await field("cell-mr-long").getAttribute("title"), long);
  const header = page.getByText("MR", { exact: true });
  const headerCells = await header.locator("..").locator(":scope > span").allTextContents();
  assert.equal(headerCells[headerCells.indexOf("MR") - 1], "Cold Bill No");
  // Header, first sale, continuation sales and color bands share one grid.
  const row = field("row-lot-one");
  for (const target of [header.locator(".."), field("row-lot-one-sale-1")]) {
    const grid = await target.evaluate(el => getComputedStyle(el).gridTemplateColumns);
    assert.equal(grid, await row.evaluate(el => getComputedStyle(el).gridTemplateColumns));
  }
  const bounds = await field("card-farmer-group-0000000000-Register_Farmer").boundingBox();
  assert.ok(bounds && bounds.x < 25 && bounds.width > 1380, JSON.stringify(bounds));
  await page.screenshot({ path: "/tmp/stock-mr-desktop.png", fullPage: true });
  for (const width of [1440, 1280, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    // Existing navigation and search controls overflow at some narrow widths;
    // the changed grouped-table surface must not add any page overflow.
    const groupList = page.locator(".max-h-\\[70vh\\]");
    assert.equal(await groupList.evaluate(el => el.scrollWidth <= el.clientWidth), true, `table group overflow at ${width}`);
    const geometry = await row.evaluate(el => {
      const scroller = el.parentElement!.parentElement!.parentElement!.parentElement!;
      return { rowWidth: el.getBoundingClientRect().width, scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth };
    });
    assert.ok(geometry.rowWidth >= 1220);
    if (width < 1280) assert.ok(geometry.scrollWidth > geometry.clientWidth);
  }
  await page.screenshot({ path: "/tmp/stock-mr-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Same-page application navigation: edits/clears must invalidate the cached
  // summaries, and external edits must refresh on return even without a write.
  const navigateTo = async (path: string) => {
    await page.locator(`a[href="${path}"]`).first().click();
    await page.waitForURL(`**${path}`);
  };
   for (const next of ["EDIT", ""]) {
    await navigateTo("/buyer-ledger");
    await field("button-edit-buyer").click();
    await field("input-edit-buyer-initials").fill(next);
    await field("button-save-edit").click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await navigateTo("/stock-register");
    await page.waitForFunction(value => document.querySelector('[data-testid="cell-mr-merchant"]')?.textContent === value, next);
  }
  assert.equal(edits, 2);
  await navigateTo("/buyer-ledger");
  initials = "Changed by another operator";
  await navigateTo("/stock-register");
  await page.waitForFunction(() => document.querySelector('[data-testid="cell-mr-merchant"]')?.textContent === "Changed by another operator");
  initials = "Focus refresh";
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await page.waitForFunction(() => document.querySelector('[data-testid="cell-mr-merchant"]')?.textContent === "Focus refresh");
  await field("tab-search-phone").click();
  await field("input-search-phone").fill("0000000000");
  await field("input-search-phone").press("Enter");
  await field("row-lot-unsold").waitFor({ state: "hidden" });
  assert.ok(searches > 0);
  assert.equal(await field("cell-mr-self").textContent(), "Self");
  await page.evaluate(() => sessionStorage.removeItem("stockRegisterState"));
  // Fresh summary reads reflect an edit or clear, rather than a sale snapshot.
  initials = "Updated";
  await open();
  assert.equal(await field("cell-mr-merchant").textContent(), "Updated");
  initials = null;
  await open();
  assert.equal(await field("cell-mr-merchant").textContent(), "");
  summaryMode = "error";
  await open();
  assert.equal(await field("cell-mr-empty-one").textContent(), "");
  assert.match(await field("cell-exited-sold-empty-one").textContent() ?? "", /Error/);
  summaryMode = "loading";
  await page.goto(`${base}/stock-register`, { waitUntil: "domcontentloaded" });
  await field("cell-exited-sold-empty-one").waitFor();
  assert.match(await field("cell-exited-sold-empty-one").textContent() ?? "", /Loading/);
  assert.equal(await field("cell-mr-empty-one").textContent(), "");
  await field("cell-mr-self").waitFor();
  summaryMode = "ready";
  paging = true;
  initials = "rLt";
  await open();
  await field("row-lot-later").waitFor();
  assert.equal(pageTwoRequested, true);
  assert.equal(await page.locator('[data-testid="cell-mr-merchant"]').count(), 2);
  await page.evaluate(() => localStorage.setItem("language", "hi"));
  await open();
  assert.equal(await page.getByText("MR", { exact: true }).count(), 2);
  assert.equal(await page.locator('[data-testid="cell-mr-self"]').first().textContent(), "Self");
  assert.equal(await page.locator('[data-testid="cell-mr-long"]').first().textContent(), long);
  assert.ok(summaryRequests >= 6);
  assert.deepEqual(errors, []);
  console.log("Stock Register MR browser checks passed: per-sale values, blank unsold/loading/error, same-session ledger edit/clear and external mount/focus refresh, grid alignment, wider gutters, long initials, search, paging, Hindi, contained table scrolling on desktop/tablet/mobile.");
} finally {
  await browser.close();
}
