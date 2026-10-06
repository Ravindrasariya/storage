import React from "react";
import type { CashReceiptWithBillNumbers } from "@shared/schema";

type ReceiptBillFields = Pick<CashReceiptWithBillNumbers, "payerType" | "dueType" | "coldStorageBillNumbers">;

// Keep the PDF's allocation-derived numbers unchanged. Other receipt types
// can also reference sales, but those are not cold-charge payments.
export function getReceiptColdBills(receipt: ReceiptBillFields): string | null {
  if (receipt.dueType !== "cold_charges" ||
      (receipt.payerType !== "cold_merchant" && receipt.payerType !== "farmer")) {
    return null;
  }
  return receipt.coldStorageBillNumbers?.trim() ? receipt.coldStorageBillNumbers : null;
}

export function ReceiptColdBills({
  receipt,
  label,
  variant,
  testId,
}: {
  receipt: ReceiptBillFields;
  label: string;
  variant: "card" | "detail";
  testId: string;
}) {
  const numbers = getReceiptColdBills(receipt);
  if (!numbers) return null;

  return variant === "card" ? (
    <div className="mt-1 min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]" data-testid={testId}>
      <span>{label}: </span>
      <span className="font-medium">{numbers}</span>
    </div>
  ) : (
    <div className="flex items-start justify-between gap-3 min-w-0" data-testid={testId}>
      <span className="text-muted-foreground shrink-0">{label}:</span>
      <span className="font-medium min-w-0 text-right [overflow-wrap:anywhere]">{numbers}</span>
    </div>
  );
}
