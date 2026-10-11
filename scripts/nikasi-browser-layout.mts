import assert from "node:assert/strict";
import type { Page } from "playwright";

type Mount = (component: string, props: object) => Promise<void>;
type LotOption = { lot: { lotNo: string; marka: string | null } };

// Layout-only checks: use existing synthetic lots but never submit a sale.
export async function checkNikasiLayout(page: Page, mount: Mount, props: { lots: LotOption[] } & Record<string, unknown>) {
  assert.ok(props.lots.length >= 2, "Layout check needs two distinct synthetic lots");
  const resize = async (width: number, height = 1000) => {
    await page.setViewportSize({ width, height });
    // Dialog width transitions for 200ms; measure the settled viewport.
    await page.waitForTimeout(250);
  };
  const pickReceipt = async (row: number, receipt: string) => {
    await page.getByTestId(`select-mn-lot-${row}`).click();
    await page.getByTestId(`input-mn-lot-search-${row}`).fill(receipt);
    await page.getByTestId(`option-mn-lot-${row}-${receipt}`).click();
  };
  const measure = () => page.locator('[data-testid="row-mn-0"]').evaluate(row => {
    const table = row.closest("table")!;
    const viewport = table.parentElement!;
    const headers = Array.from(table.querySelectorAll("thead th")).map(header => {
      const range = document.createRange();
      range.selectNodeContents(header);
      const text = range.getBoundingClientRect();
      return {
        label: header.textContent?.trim(),
        height: text.height,
        lineHeight: parseFloat(getComputedStyle(header).lineHeight),
        whitespace: getComputedStyle(header).whiteSpace,
        width: header.clientWidth,
        contentWidth: header.scrollWidth,
      };
    });
    return {
      headers, viewportWidth: viewport.clientWidth, tableWidth: viewport.scrollWidth,
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
      receiptWidth: row.children[0].getBoundingClientRect().width,
      markaWidth: row.children[1].getBoundingClientRect().width,
      actionWidth: row.lastElementChild!.getBoundingClientRect().width,
    };
  });
  const checkHeaders = (metrics: Awaited<ReturnType<typeof measure>>) => {
    assert.equal(metrics.headers.length, 14, "Retain every column, including the row action");
    for (const header of metrics.headers.filter(h => h.label)) {
      assert.equal(header.whitespace, "nowrap", `${header.label}: must not wrap`);
      assert.ok(header.height <= header.lineHeight + 1, `${header.label}: rendered on multiple lines`);
      assert.ok(header.contentWidth <= header.width + 1, `${header.label}: must not clip its text`);
    }
    assert.equal(metrics.pageOverflow, false, "Table must not overflow the page");
    assert.ok(metrics.receiptWidth <= 100, "Receipt picker must use a compact column");
    assert.ok(metrics.markaWidth <= 110, "Marka picker must use a compact column");
    assert.ok(metrics.actionWidth <= 40, "Do not waste labelled-column space on the trailing action cell");
  };
  for (const language of ["en", "hi"]) {
    await page.evaluate(language => localStorage.setItem("language", language), language);
    await resize(1440);
    await mount("MasterNikasiDialog", props);
    await pickReceipt(0, props.lots[0].lot.lotNo);
    // Open and select a real Marka option, rather than relying only on auto-fill.
    await page.getByTestId("select-mn-marka-0").click();
    await page.getByRole("option", { name: props.lots[0].lot.marka!, exact: true }).click();
    await page.getByTestId("input-mn-bags-0").fill("2");
    await page.getByTestId("input-mn-kata-0").fill("20");
    await page.getByTestId("input-mn-tulai-0").fill("50");
    assert.equal(await page.getByTestId("text-mn-grand-total").innerText(), "190");
    await page.getByTestId("select-mn-lot-0").click();
    await page.getByTestId("option-mn-lot-clear-0").click();
    assert.equal((await page.getByTestId("select-mn-lot-0").innerText()).trim(), "—");
    await pickReceipt(0, props.lots[0].lot.lotNo);
    await page.getByTestId("button-mn-add-row").click();
    await pickReceipt(1, props.lots[1].lot.lotNo);
    await page.getByTestId("input-mn-bags-1").fill("3");
    assert.equal(await page.getByTestId("text-mn-grand-total").innerText(), "370");
    for (const width of [1280, 1440]) {
      await resize(width);
      const metrics = await measure();
      checkHeaders(metrics);
      assert.ok(metrics.tableWidth <= metrics.viewportWidth + 1,
        `${language}/${width}: table ${metrics.tableWidth}px exceeds available ${metrics.viewportWidth}px: ${JSON.stringify(metrics.headers)}`);
      const labels = metrics.headers.map(h => h.label);
      assert.equal(labels[7], language === "en" ? "Kata" : "काटा");
      assert.equal(labels[8], language === "en" ? "Tulai" : "तुलाई");
      await page.screenshot({ path: `/tmp/nikasi-${language}-${width}.png` });
      console.log(`Nikasi ${language}/${width}: all headers single-line, table fits ${metrics.viewportWidth}px`);
    }
    await resize(390, 844);
    const mobile = await measure();
    checkHeaders(mobile);
    assert.ok(mobile.tableWidth > mobile.viewportWidth, "Narrow-screen table should scroll internally");
    await page.locator('[data-testid="row-mn-0"]').evaluate(row => {
      const viewport = row.closest("table")!.parentElement!;
      viewport.scrollLeft = viewport.scrollWidth;
    });
    const remove = page.getByTestId("button-mn-remove-1");
    await remove.scrollIntoViewIfNeeded();
    const actionIsVisible = await remove.evaluate(button => {
      const viewport = button.closest("table")!.parentElement!.getBoundingClientRect();
      const control = button.getBoundingClientRect();
      return control.left >= viewport.left && control.right <= viewport.right;
    });
    assert.ok(actionIsVisible, "Rightmost remove-row control must be reachable by internal scrolling");
    await page.screenshot({ path: `/tmp/nikasi-${language}-mobile.png` });
    await remove.click();
    assert.equal(await page.locator('[data-testid^="row-mn-"]').count(), 1);
    assert.equal(await page.getByTestId("text-mn-grand-total").innerText(), "190");
    await resize(1280);
    const single = await measure();
    checkHeaders(single);
    assert.ok(single.tableWidth <= single.viewportWidth + 1,
      `Single-row table must still fit: ${JSON.stringify(single)}`);
    console.log(`Nikasi ${language}: search, Marka selection, clear, add/remove and mobile scrolling passed`);
  }
  await page.evaluate(() => localStorage.setItem("language", "en"));
  await resize(1440);
}
