// Real signed-in UI with isolated development fixtures, never an auth bypass.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium, type Browser } from "playwright";
import { auth, cleanup, id, lot, pool, setup, token, legacySaleFixture } from "./tulai-fixtures.mts";

const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
let browser: Browser | undefined;
try {
  await setup();
  async function api(path: string, body?: unknown, method = "POST") {
    const response = await fetch(base + path, { method, headers: auth, ...(body == null ? {} : { body: JSON.stringify(body) }) });
    assert.ok(response.ok, `${path}: ${await response.clone().text()}`);
    return response.json();
  }
  const lotId = await lot("archive-ui");
  await legacySaleFixture(lotId, { tulaiCharges: 25, remarks: "<script>window.archiveInjected=true</script>" });
  const sale = (await pool.query(`SELECT * FROM sales_history WHERE lot_id=$1`, [lotId])).rows[0];
  await api(`/api/sales-history/${sale.id}/exits`, { bagsExited: 4, exitDate: "2016-06-16" });
  await api(`/api/sales-history/${sale.id}/reverse`, {});
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || "/repl/tools/bin/chromium", args: ["--no-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Kolkata" });
  await context.addInitScript("window.__name=(fn)=>fn;");
  await context.addInitScript(value => {
    localStorage.setItem("cold_store_auth_token", value);
    if (!localStorage.getItem("language")) localStorage.setItem("language", "en");
  }, token);
  const page = await context.newPage();
  const errors: string[] = [];
  const mutations: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (request.url().includes("/api/") && !["GET", "HEAD"].includes(request.method())) mutations.push(request.url());
  });
  await page.goto(`${base}/sales-history`, { waitUntil: "networkidle" });
  async function checkRecycleBin(language: "en" | "hi", width: number) {
    await page.setViewportSize({ width, height: 900 });
    const button = page.getByTestId("tab-bills-recycle-bin");
    assert.ok(await button.isVisible());
    assert.equal((await button.innerText()).trim(), "", "Recycle Bin must be icon-only");
    assert.equal(await button.getAttribute("title"), language === "hi" ? "रीसायकल बिन" : "Recycle Bin");
    assert.equal(await button.getAttribute("aria-label"), language === "hi" ? "रीसायकल बिन खोलें" : "Open Recycle Bin");
    const tabs = page.getByRole("tablist");
    assert.equal(await tabs.getByRole("tab").count(), 3);
    // Read all rectangles in one frame: viewport changes and font loading can
    // otherwise move this navigation between separate protocol round-trips.
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const { buttonBox, tabsBox, iconBox } = await button.evaluate(element => {
      const rect = (node: Element) => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return { buttonBox: rect(element), tabsBox: rect(document.querySelector('[role="tablist"]')!), iconBox: rect(element.querySelector("svg")!) };
    });
    assert.ok(buttonBox.x - tabsBox.x - tabsBox.width >= 15 ||
      buttonBox.y - tabsBox.y - tabsBox.height >= 15, "Recycle Bin needs a clear gap outside the tabs");
    assert.ok(Math.abs(iconBox.x + iconBox.width / 2 - buttonBox.x - buttonBox.width / 2) < 1, "Icon not horizontally centered");
    assert.ok(Math.abs(iconBox.y + iconBox.height / 2 - buttonBox.y - buttonBox.height / 2) < 1, "Icon not vertically centered");
    assert.ok(buttonBox.x >= 0 && buttonBox.x + buttonBox.width <= width, "Recycle Bin overflows on narrow screens");
    assert.ok(tabsBox.x >= 0 && tabsBox.x + tabsBox.width <= width, "Tabs overflow on narrow screens");
    // Below 390px the existing page outside this navigation can overflow; check
    // this task's navigation separately rather than changing unrelated UI.
    if (width >= 390) {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Page overflows on narrow screens");
    }
  }
  await mkdir("generated-artifacts", { recursive: true });
  for (const width of [1440, 390, 320]) {
    await checkRecycleBin("en", width);
    await page.screenshot({ path: `generated-artifacts/recycle-bin-en-${width}.jpg` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByTestId("tab-tracker").click();
  await page.getByTestId("tab-sales").click();
  const recycleButton = page.getByTestId("tab-bills-recycle-bin");
  await recycleButton.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Archive Sales History", exact: true }).waitFor();
  await page.getByRole("button", { name: "Return to Bills History" }).click();
  await page.getByTestId("tab-bills-recycle-bin").click();
  await page.getByRole("heading", { name: "Archive Sales History", exact: true }).waitFor();
  await page.locator("tbody tr").filter({ hasText: "archive-ui" }).waitFor();
  assert.equal(await page.locator('[data-testid^="card-summary"], [data-testid^="card-exit-"]').count(), 0);
  assert.equal(await page.getByRole("button", { name: /reverse|restore|delete|payment/i }).count(), 0);
  assert.equal(await page.locator("tbody tr").count(), 1);
  const saleHeaders = await page.locator("thead th").allTextContents();
  assert.ok(saleHeaders.some(header => header.includes("Remaining")));
  assert.ok(saleHeaders.some(header => header.includes("Cold Bill")));
  await page.locator("#archive-sales-buyer").fill("Self");
  assert.equal(await page.locator("tbody tr").count(), 1, "Self filter lost self-sale snapshot");
  await page.locator("#archive-sales-buyer").fill("not-a-buyer");
  await page.getByText("No reversed records found", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.locator("tbody tr").waitFor();
  await page.getByTestId("archive-sales-trigger-year").click();
  assert.ok(await page.getByTestId("archive-sales-option-year-2016").isVisible(), "Archive-only year missing");
  await page.getByTestId("archive-sales-option-year-2016").click();
  await page.getByTestId("archive-sales-trigger-month").click();
  await page.getByTestId("archive-sales-chip-month-6").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("archive-sales-trigger-day").click();
  await page.getByTestId("archive-sales-chip-day-15").click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page.getByRole("button", { name: "Archive details", exact: true }).first().click();
  await page.getByRole("dialog").waitFor();
  assert.ok((await page.getByRole("dialog").innerText()).includes(sale.id));
  assert.ok((await page.getByRole("dialog").innerText()).includes("<script>"));
  assert.equal(await page.evaluate(() => (window as any).archiveInjected), undefined);
  await page.getByRole("button", { name: "Close", exact: true }).first().click();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV", exact: true }).click();
  const exported = await download;
  const csv = await readFile((await exported.path())!, "utf8");
  assert.match(csv, /REVERSED/);
  assert.match(csv, /archive-ui/);
  assert.doesNotMatch(csv, /Total Bags Sold/);
  const kataDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Kata + Tulai", exact: true }).click();
  const kataFile = await kataDownload;
  const kata = await readFile((await kataFile.path())!, "utf8");
  assert.match(kata, /Kata Charges/);
  assert.match(kata, /Tulai Charges/);
  assert.match(kata, /"25"/);
  assert.notEqual(kata, csv, "Kata export incorrectly duplicated overall CSV");
  await page.evaluate(() => {
    (window as any).archivePrintedHtml = "";
    window.open = (() => ({
      document: { open() {}, write(html: string) { (window as any).archivePrintedHtml = html; }, close() {} },
    })) as any;
  });
  await page.getByRole("button", { name: "Print PDF", exact: true }).click();
  const printedHtml = await page.evaluate(() => (window as any).archivePrintedHtml as string);
  assert.match(printedHtml, /REVERSED — ARCHIVE COPY/);
  assert.match(printedHtml, /archive-ui/);
  assert.doesNotMatch(printedHtml, /Total Bags Sold|class="cards"/);

  await page.getByRole("tab", { name: "Archive Nikasi Register", exact: true }).click();
  await page.locator("tbody tr").filter({ hasText: "archive-ui" }).waitFor();
  const exitHeaders = await page.locator("thead th").allTextContents();
  assert.ok(exitHeaders.some(header => /Bill|बिल/.test(header)));
  assert.equal(await page.locator("tbody tr").count(), 1);
  await mkdir("generated-artifacts", { recursive: true });
  await page.screenshot({ path: "generated-artifacts/archive-desktop.jpg", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.getByRole("tab", { name: "Archive Sales History", exact: true }).isVisible());
  assert.ok(await page.getByRole("tab", { name: "Archive Nikasi Register", exact: true }).isVisible());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Mobile page overflows outside table");
  await page.screenshot({ path: "generated-artifacts/archive-mobile.jpg", fullPage: true });
  await page.getByRole("button", { name: "Return to Bills History" }).click();
  assert.ok(await page.getByTestId("tab-bills-recycle-bin").isVisible());
  assert.ok(await page.getByTestId("tab-tracker").isVisible());
  await page.evaluate(() => localStorage.setItem("language", "hi"));
  await page.reload({ waitUntil: "networkidle" });
  for (const width of [1440, 390, 320]) {
    await checkRecycleBin("hi", width);
    await page.screenshot({ path: `generated-artifacts/recycle-bin-hi-${width}.jpg` });
  }
  await page.getByTestId("tab-bills-recycle-bin").focus();
  await page.keyboard.press("Space");
  await page.getByRole("heading", { name: "अभिलेख बिक्री इतिहास" }).waitFor();
  await page.getByRole("button", { name: "बिल इतिहास पर वापस" }).click();
  await page.getByTestId("tab-bills-recycle-bin").click();
  await page.getByRole("heading", { name: "अभिलेख बिक्री इतिहास" }).waitFor();
  assert.ok(await page.getByRole("tab", { name: "अभिलेख निकासी रजिस्टर" }).isVisible());
  assert.equal(mutations.length, 0, `Archive UI made mutations: ${mutations.join(", ")}`);
  assert.deepEqual(errors, []);
  console.log("PASS: signed-in archive navigation, stored snapshots, read-only detail/XSS, archive CSV, responsive English/Hindi and no mutation requests");
} finally {
  await browser?.close();
  await cleanup();
}
