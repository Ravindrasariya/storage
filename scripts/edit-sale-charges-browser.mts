import assert from "node:assert/strict";
import type { Page } from "playwright";

// Called inside the existing guarded, authenticated Tulai browser suite.
export async function checkEditSaleCharges(
  page: Page,
  mount: (component: string, props: object) => Promise<void>,
  api: (path: string, body?: object, method?: string) => Promise<any>,
  sale: any,
) {
  const field = (name: string) => page.getByTestId(`input-edit-${name}`);
  const total = field("extra-hammali-total");
  async function open(value = sale) {
    await mount("EditSaleDialog", { sale: value });
    await page.getByRole("button", { name: /^(Cold Storage Charges|कोल्ड स्टोरेज शुल्क)/ }).click();
    await total.waitFor({ state: "visible" });
  }
  const pairs = [
    ["cold-charge", "hammali"],
    ["kata-charges", "tulai-charges"],
    ["extra-hammali", "extra-hammali-total"],
    ["grading-per-bag", "grading-charges"],
  ];
  for (const language of ["en", "hi"]) {
    await page.evaluate(language => localStorage.setItem("language", language), language);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await open();
      assert.equal(await total.getAttribute("readonly"), "");
      assert.equal(await total.getAttribute("id"), "edit-extra-hammali-total");
      assert.equal(await total.inputValue(), String(sale.extraHammali));
      const label = page.locator('label[for="edit-extra-hammali-total"]');
      assert.equal(await label.innerText(), language === "en" ? "Total Extra Hammali" : "कुल अतिरिक्त हमाली");
      let previousBottom = 0;
      for (const pair of pairs) {
        const boxes = await Promise.all(pair.map(async name =>
          field(name).evaluate(input => {
            const cell = input.parentElement!.parentElement!;
            const box = cell.getBoundingClientRect();
            const grid = cell.parentElement!;
            return { x: box.x, y: box.y, width: box.width, bottom: box.bottom,
              overflow: grid.scrollWidth > grid.clientWidth };
          })));
        assert.ok(Math.abs(boxes[0].y - boxes[1].y) < 2, `${pair}: same row (${language}, ${width})`);
        assert.ok(Math.abs(boxes[0].width - boxes[1].width) < 2, `${pair}: equal columns`);
        assert.ok(boxes[1].x > boxes[0].x);
        assert.ok(boxes[0].y >= previousBottom);
        assert.equal(boxes.some(box => box.overflow), false, "Charge grid must not overflow");
        previousBottom = Math.max(...boxes.map(box => box.bottom));
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await total.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/tmp/edit-sale-charges-${language}-${width}.png` });
    }
  }
  await page.evaluate(() => localStorage.setItem("language", "en"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Charge basis does not change the extra-Hammali multiplier.
  await open({ ...sale, chargeBasis: "totalRemaining", remainingSizeAtSale: 100 });
  await field("extra-hammali").fill("2.75");
  assert.equal(await total.inputValue(), String(2.75 * sale.quantitySold));
  await total.focus();
  await page.keyboard.press("Backspace");
  assert.equal(await total.inputValue(), String(2.75 * sale.quantitySold), "Total must not accept typing");
  for (const value of ["", "0", "0.125"]) {
    await field("extra-hammali").fill(value);
    assert.equal(await total.inputValue(), String((Number(value) || 0) * sale.quantitySold));
  }
  await open({ ...sale, baseChargeAmountAtSale: 0 });
  assert.equal(await field("cold-charge").isDisabled(), true);
  assert.equal(await field("hammali").isDisabled(), true);
  assert.equal(await field("extra-hammali").isEnabled(), true);
  assert.equal(await field("grading-charges").isEditable(), true);

  await open();
  await field("extra-hammali").fill("2.75");
  await field("grading-per-bag").fill("2");
  assert.equal(await field("grading-charges").inputValue(), String(2 * sale.quantitySold));
  await field("grading-charges").fill("21.25");
  const responsePromise = page.waitForResponse(response =>
    response.url().endsWith(`/api/sales-history/${sale.id}`) && response.request().method() === "PATCH");
  await page.getByTestId("button-save-edit").click();
  const response = await responsePromise;
  assert.equal(response.status(), 200, await response.text());
  const payload = response.request().postDataJSON();
  assert.equal(payload.extraHammali, 2.75 * sale.quantitySold);
  assert.equal(payload.gradingCharges, 21.25);
  assert.equal(payload.gradingPerBag, 2);
  assert.equal("extraHammaliTotal" in payload, false, "No new persisted total field");
  assert.equal("totalExtraHammali" in payload, false);
  const saved = await api(`/api/sales-history/${sale.id}`, undefined, "GET");
  assert.equal(saved.extraHammali, 2.75 * sale.quantitySold);
  assert.equal(saved.gradingCharges, 21.25);
  assert.equal(saved.coldStorageCharge,
    sale.coldStorageCharge - sale.extraHammali - sale.gradingCharges + saved.extraHammali + 21.25);
  assert.equal(saved.dueAmount, saved.coldStorageCharge);
  assert.equal(saved.paidAmount, sale.paidAmount);
  await open(saved);
  assert.equal(await field("extra-hammali").inputValue(), "2.75");
  assert.equal(await total.inputValue(), String(saved.extraHammali));
  assert.equal(await field("grading-charges").inputValue(), "21.25", "Manual grading override survives reopening");
  // Leave this shared fixture's amounts unchanged for the remainder of the suite.
  await api(`/api/sales-history/${sale.id}`, {
    extraHammali: sale.extraHammali, gradingCharges: sale.gradingCharges,
    gradingPerBag: sale.gradingPerBag ?? null, coldStorageCharge: sale.coldStorageCharge,
  }, "PATCH");
  await open(sale);
  console.log("Edit Sale charges: English/Hindi desktop/mobile four-row pairing, read-only totals, sold-bag multiplier, blank/zero/decimal rates, base-charge locks, editable grading overrides and real save/readback passed.");
}
