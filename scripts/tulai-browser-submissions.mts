// Real UI submissions; reads below independently verify database persistence.
import assert from "node:assert/strict";
import type { Page } from "playwright";
import { farmerId, id, lot, pool } from "./tulai-fixtures.mts";

type Api = (path: string, body?: object, method?: string) => Promise<any>;
type Mount = (component: string, props: object) => Promise<void>;

export async function checkTulaiSubmissions(page: Page, mount: Mount, api: Api) {
  const field = (testId: string) => page.getByTestId(testId);
  const invalidMessage = "Tulai amount must be a finite, non-negative number.";
  const initialTulaiDue = (await api("/api/analytics/payments", undefined, "GET")).tulaiDue;
  const receiptTotals = async () => (await pool.query(`SELECT
    COALESCE(SUM(amount),0)::real AS amount, COALESCE(SUM(round_off),0)::real AS round_off
    FROM cash_receipts WHERE cold_storage_id=$1 AND is_reversed=0`, [id])).rows[0];
  const initialReceipts = await receiptTotals();
  const persisted = async (lotId: string) =>
    (await pool.query("SELECT * FROM sales_history WHERE lot_id=$1", [lotId])).rows;
  async function unchanged(lotIds: string[]) {
    for (const lotId of lotIds) {
      assert.equal((await persisted(lotId)).length, 0, "Rejected form must not create a sale");
      const stored = (await pool.query("SELECT remaining_size FROM lots WHERE id=$1", [lotId])).rows[0];
      assert.equal(stored.remaining_size, 100, "Rejected form must not change inventory");
    }
    const exits = await pool.query("SELECT id FROM exit_history WHERE lot_id=ANY($1::text[])", [lotIds]);
    assert.equal(exits.rowCount, 0, "Rejected form must not create exits");
    assert.deepEqual(await receiptTotals(), initialReceipts, "Rejected forms must not create payments");
  }
  const writes: string[] = [];
  const captureWrite = (request: import("playwright").Request) => {
    if (request.method() === "POST" &&
      /\/(?:partial-sale|farmers\/master-nikasi)$/.test(new URL(request.url()).pathname)) {
      writes.push(request.url());
    }
  };
  page.on("request", captureWrite);
  try {
    // Use only fresh lots, including a pre-billed row, to make each row's
    // base and surcharge totals independent and predictable.
    const batchLots = [
      { name: "UI-batch-decimal", bags: 2, kata: 10, typed: "20.25", tulai: 20.25, base: 120 },
      { name: "UI-batch-blank", bags: 3, kata: 15, typed: "", tulai: 0, base: 180 },
      { name: "UI-batch-zero", bags: 4, kata: 5, typed: "0", tulai: 0, base: 0 },
    ];
    const lotIds = [];
    for (const row of batchLots) lotIds.push(await lot(row.name, row.base === 0 ? 1 : 0));
    const listing = await api("/api/lots", undefined, "GET");
    const lots = listing.lots.filter((l: any) => lotIds.includes(l.id)).map((l: any) => ({
      lot: l, lotPaidCharge: l.totalPaidCharge ?? 0, lotDueCharge: l.totalDueCharge ?? 0,
      expectedColdCharge: l.remainingSize * 60,
    }));
    assert.equal(lots.length, batchLots.length);
    // Auto-print is not the assertion here (the caller separately tests PDFs).
    await page.evaluate(() => { window.open = () => null; });
    await mount("MasterNikasiDialog", { farmerName: "Tulai Farmer", village: "Tulai Village",
      contactNumber: "0000000000", farmerLedgerId: farmerId, lots });
    await field("input-mn-exit-date").fill("2016-06-16");
    for (const [index, row] of batchLots.entries()) {
      if (index > 0) await field("button-mn-add-row").click();
      await field(`select-mn-lot-${index}`).click();
      await field(`option-mn-lot-${index}-${row.name}`).click();
      // Receipt selection auto-selects its only Marka.
      await field(`input-mn-bags-${index}`).fill(String(row.bags));
      await field(`input-mn-kata-${index}`).fill(String(row.kata));
      await field(`input-mn-tulai-${index}`).fill("99");
      await field(`input-mn-tulai-${index}`).fill(row.typed);
      assert.equal(await field(`input-mn-tulai-${index}`).inputValue(), row.typed);
      assert.equal(Number(await field(`text-mn-total-${index}`).innerText()), row.base + row.kata + row.tulai);
    }
    const total = batchLots.reduce((sum, row) => sum + row.base + row.kata + row.tulai, 0);
    assert.equal(Number(await field("text-mn-grand-total").innerText()), total);
    // A bad later row must not partially save the earlier valid rows.
    const before = writes.length;
    await field("input-mn-tulai-2").fill("-2");
    await field("button-mn-submit").click();
    await page.getByText(`Tulai: ${invalidMessage}`, { exact: true }).waitFor({ state: "visible" });
    assert.equal(writes.length, before, "Invalid Tulai must be rejected before the batch API");
    await unchanged(lotIds);
    await field("input-mn-tulai-2").fill("0");

    await field("button-mn-open-payment").click();
    await field("input-mn-payment-amount").fill(String(total + 1));
    await field("text-mn-payment-error-exceeds").waitFor({ state: "visible" });
    assert.equal(await field("button-mn-payment-apply").isDisabled(), true,
      "Payment above total including Tulai must not be attachable");
    await unchanged(lotIds);
    await field("input-mn-payment-amount").fill("60");
    await field("input-mn-payment-roundoff").fill("10");
    await field("input-mn-payment-date").fill("2016-06-16");
    await field("button-mn-payment-apply").click();
    const responsePromise = page.waitForResponse(response =>
      new URL(response.url()).pathname === "/api/farmers/master-nikasi" &&
      response.request().method() === "POST");
    await field("button-mn-submit").click();
    const response = await responsePromise;
    assert.equal(response.status(), 201, await response.text());
    const sent = response.request().postDataJSON();
    assert.deepEqual(sent.rows.map((row: any) => row.tulaiCharges), batchLots.map(row => row.tulai));
    const result = await response.json();
    await field("button-mn-reprint").waitFor({ state: "visible" });
    assert.equal(result.sales.length, batchLots.length);
    assert.equal(result.sales.reduce((sum: number, sale: any) => sum + sale.totalColdStorageCharge, 0), total);
    let paid = 0, due = 0;
    for (const [index, row] of batchLots.entries()) {
      const rows = await persisted(lotIds[index]);
      assert.equal(rows.length, 1);
      const stored = rows[0];
      assert.equal(stored.tulai_charges, row.tulai);
      assert.equal(stored.kata_charges, row.kata);
      assert.equal(stored.cold_storage_charge, row.base + row.kata + row.tulai);
      assert.equal(stored.quantity_sold, row.bags);
      assert.equal(stored.paid_amount, index === 0 ? 60 : 0, "Batch payment must follow row allocation order");
      const rowDue = row.base + row.kata + row.tulai - (index === 0 ? 60 : 0);
      assert.equal(stored.due_amount, index === 0 ? Math.round(rowDue * 10) / 10 : rowDue,
        "Paid row due uses the existing one-decimal payment-allocation rule");
      paid += stored.paid_amount;
      due += stored.due_amount;
      const saved = await api(`/api/sales-history/${stored.id}`, undefined, "GET");
      assert.equal(saved.tulaiCharges, row.tulai);
      assert.equal(saved.coldStorageCharge, row.base + row.kata + row.tulai);
      assert.equal((await pool.query("SELECT remaining_size FROM lots WHERE id=$1", [lotIds[index]])).rows[0].remaining_size, 100 - row.bags);
      const exits = await pool.query("SELECT * FROM exit_history WHERE lot_id=$1", [lotIds[index]]);
      assert.equal(exits.rows.length, 1);
      assert.equal(exits.rows[0].bags_exited, row.bags);
    }
    assert.equal(paid, 60, "Customer payment must not discard Tulai or treat round-off as payment");
    assert.equal(due, Math.round((total - 60) * 10) / 10);
    const receipts = await receiptTotals();
    assert.equal(receipts.amount - initialReceipts.amount, 60,
      "Only the attached batch payment should create additional receipts");
    assert.equal(receipts.round_off - initialReceipts.round_off, 10);
    assert.equal((await api("/api/analytics/payments", undefined, "GET")).tulaiDue, initialTulaiDue + 20.25,
      "Customer collection must not pay down Tulai owed to Himmal");
    console.log(`UI Master Nikasi: decimal/blank/zero Tulai retained, total ${total}, payment 60, due ${due}; invalid Tulai/payment blocked`);
  } finally {
    page.off("request", captureWrite);
  }
}
