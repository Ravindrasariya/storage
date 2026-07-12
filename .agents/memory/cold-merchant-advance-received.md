---
name: Cold merchant advance-received (prepayment)
description: How merchant prepayments against future cold-storage bhada are modeled and auto-applied, and why no new payer/due type was introduced.
---

# Cold Merchant Advance Payment (money RECEIVED from a merchant)

A merchant prepayment against future cold storage charges is recorded as a
**plain `cold_merchant` / `cold_charges` cash receipt** with an
`is_advance_payment` marker column (label-only). It is NOT a new payer type or
due type.

**Why:** the existing FIFO engine (`recomputeBuyerPayments` / `applyReceiptFIFO`)
only drains receipts inside the `cold_merchant` / `cold_charges` pool. Introducing
a new payer/due type would make the FIFO filters exclude it, silently stopping the
advance from ever draining onto sales. Keeping it in-pool means the prepayment
lands as `unapplied_amount` and drains with zero engine changes.

**Distinct from `cold_merchant_advance` payer type** — that is money the cold
store GIVES the merchant (merchant repays). Advance-received is the mirror
(merchant pays the store first). Copy must keep these separate.

**How auto-apply works:** sale creation is now a recompute trigger. Both
`createSale` and `createMasterNikasi` run a post-commit guard —
`getBuyerUnappliedColdChargesCredit(coldStorageId, buyerLedgerId) > 0` — and only
then call `recomputeBuyerPayments`. Guard keeps ordinary sales (no advance on
file) free of extra work. Master Nikasi runs the recompute exactly ONCE after the
batch tx commits (not per row); inline-payment sales are `fifoExclusion=1` so the
replay never double-counts them.

**How to apply:** any future "prepaid credit that should auto-consume against
future dues" feature should reuse an existing FIFO pool + a marker column, not a
new payer/due type. Guard any new recompute trigger on the credit actually
existing.
