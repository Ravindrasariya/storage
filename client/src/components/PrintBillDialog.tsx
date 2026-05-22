import { useState, useRef, useEffect } from "react";
import { flushSync } from "react-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Printer, FileText, Receipt, Share2, Loader2, IndianRupee } from "lucide-react";
import type { SalesHistory, SalesHistoryWithLastPayment, ColdStorage, BankAccount, SalePayment } from "@shared/schema";
import { apiRequest, authFetch, queryClient, invalidateSaleSideEffects } from "@/lib/queryClient";
import { shareReceiptAsPdf } from "@/lib/shareReceipt";

// Format amount: round to 1 decimal if fractional, show integer if whole (e.g., 72.54 → "72.5", 72 → "72")
const formatAmount = (value: number): string => {
  if (value === 0) return "0";
  if (Number.isInteger(value)) {
    return value.toLocaleString("en-IN");
  }
  const rounded = Math.round(value * 10) / 10;
  if (Number.isInteger(rounded)) {
    return rounded.toLocaleString("en-IN");
  }
  return rounded.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
};

// Shared CSS for bill rendering — used by both handlePrint() and shareReceiptAsPdf()
const BILL_PRINT_STYLES = `
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 14px; line-height: 1.4; margin: 0; padding: 10mm; }
  .bill-header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 8px; margin-bottom: 12px; }
  .bill-header h1 { margin: 0 0 4px 0; font-size: 22px; font-weight: bold; }
  .bill-header h2 { margin: 0; font-size: 16px; color: #666; }
  .two-column { display: flex; gap: 24px; margin-bottom: 12px; }
  .two-column > div { flex: 1; }
  .section { margin-bottom: 12px; }
  .section-title { font-weight: bold; font-size: 14px; border-bottom: 1px solid #ccc; padding-bottom: 3px; margin-bottom: 6px; }
  .info-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 13px; }
  .info-label { font-weight: 500; color: #555; }
  .info-value { text-align: right; }
  .charges-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
  .charges-table th, .charges-table td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
  .charges-table th { background: #f5f5f5; font-weight: bold; }
  .charges-table .amount { text-align: right; white-space: nowrap; }
  .total-row { font-weight: bold; background: #e8f4e8; }
  .total-row.income { background: #e8f0ff; }
  .total-row.net-income { background: #d4f4d4; font-size: 15px; }
  .payment-status { margin-top: 14px; padding: 10px; background: #d4edda; color: #155724; border-radius: 4px; text-align: center; font-weight: bold; font-size: 14px; }
  .footer-note { margin-top: 16px; padding-top: 8px; border-top: 1px dashed #ccc; text-align: center; font-size: 11px; color: #666; font-style: italic; }
  .branding { margin-top: 10px; text-align: center; font-size: 12px; }
  .krashu { color: #16a34a; font-weight: 600; }
  .ved { color: #f97316; font-weight: 600; }
`;

interface PrintBillDialogProps {
  sale: SalesHistoryWithLastPayment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PrintBillDialog({ sale, open, onOpenChange }: PrintBillDialogProps) {
  const { t } = useI18n();
  const [billType, setBillType] = useState<"deduction" | "sales" | null>(null);
  const [billNumber, setBillNumber] = useState<number | null>(null);
  const [action, setAction] = useState<"print" | "share" | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  // Holds the deferred print() timer registered after flushSync so a
  // quick dialog-close (or an unmount) can cancel it before it fires.
  // Without this, closing the dialog within ~100 ms of clicking Print
  // would still pop the print window — see Task #260 architect review.
  const printTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: coldStorage } = useQuery<ColdStorage>({
    queryKey: ["/api/cold-storage"],
  });

  const coldStorageAddress = [
    coldStorage?.address,
    coldStorage?.tehsil,
    coldStorage?.district,
    coldStorage?.state,
    coldStorage?.pincode,
  ].filter(Boolean).join(", ");

  const { data: farmerLedgerData } = useQuery<{ farmers: Array<{ id: string; entityType: string }> }>({
    queryKey: ["/api/farmer-ledger"],
  });
  const isCompany = !!sale.farmerLedgerId && farmerLedgerData?.farmers?.find(f => f.id === sale.farmerLedgerId)?.entityType === "company";
  const partyDetailsLabel = isCompany ? "कंपनी विवरण" : "किसान विवरण";

  // Fetch sibling sales sharing this Cold Storage bill # (and saleYear).
  // When 2+ rows come back this print view aggregates totals into a
  // single collective receipt; with 0–1 the dialog renders byte-for-byte
  // identical to today (single-sale path).
  //
  // The query key uses `resolvedCsBillNumber` so it picks up a freshly
  // assigned bill # immediately (sale prop is still stale right after
  // POST /assign-bill-number returns). Disabled until a CS bill # is
  // known.
  const csYear = sale.saleYear ?? new Date(sale.soldAt as unknown as string).getFullYear();
  const [resolvedCsBillNumber, setResolvedCsBillNumber] = useState<number | null>(sale.coldStorageBillNumber ?? null);
  useEffect(() => {
    setResolvedCsBillNumber(sale.coldStorageBillNumber ?? null);
  }, [sale.coldStorageBillNumber]);
  const csBillNumber = resolvedCsBillNumber;
  const siblingsQueryKey = ["/api/sales-history/cs-bill-batch", csBillNumber, csYear] as const;
  const siblingsQueryFn = async () => {
    const res = await authFetch(`/api/sales-history/cs-bill-batch?billNumber=${csBillNumber}&year=${csYear}`);
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json() as Promise<SalesHistoryWithLastPayment[]>;
  };
  const { data: siblingsData } = useQuery<SalesHistoryWithLastPayment[]>({
    queryKey: siblingsQueryKey,
    enabled: open && csBillNumber != null,
    queryFn: siblingsQueryFn,
  });
  // The current sale row is always part of the batch — even when the
  // server fetch hasn't landed yet — so we use [sale] as the safe
  // single-row fallback. Once siblingsData arrives with 2+ rows, the
  // aggregation path kicks in. Single-row batches keep `siblings ===
  // [sale]` so every aggregate equals the per-row value, preserving the
  // existing print view byte-for-byte.
  const siblings: SalesHistoryWithLastPayment[] = (siblingsData && siblingsData.length > 0)
    ? siblingsData
    : [sale];
  const isBatch = siblings.length >= 2;

  // Get discount allocated to this specific sale (tracked directly on salesHistory)
  const discountAllocated = sale.discountAllocated || 0;
  // Actual cash paid = paidAmount - discountAllocated
  const actualCashPaid = Math.max(0, (sale.paidAmount || 0) - discountAllocated);

  const resolveBillNumber = async (type: "deduction" | "sales"): Promise<number | null> => {
    // Deduction (CS bill) path: NEVER auto-assign on print/share. After
    // Task #256 NULL is a deliberate "no charge to bill" value; opening
    // the print dialog must not silently consume a sequence slot. The
    // saved value (positive integer or null) is rendered as-is — the
    // header line already falls back to "—" when null. The first-time
    // assignment button (Task #249) remains the only legit caller of
    // /assign-bill-number for the CS side.
    if (type === "deduction") {
      return sale.coldStorageBillNumber ?? null;
    }
    // Sales bill path: keep the intentional "assign at print time"
    // behaviour — the operator explicitly prints to generate the cash
    // bill, which is the documented sales workflow.
    if (sale.salesBillNumber) return sale.salesBillNumber;
    const response = await apiRequest("POST", `/api/sales-history/${sale.id}/assign-bill-number`, { billType: "sales" });
    const data = await response.json();
    invalidateSaleSideEffects(queryClient);
    queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
    return data.billNumber;
  };

  const handleBillTypeSelect = async (type: "deduction" | "sales", selectedAction: "print" | "share") => {
    setAction(selectedAction);
    setBillType(type);

    let resolvedBillNumber: number | null;
    try {
      resolvedBillNumber = await resolveBillNumber(type);
    } catch (err) {
      console.error("Failed to resolve bill number:", err);
      onOpenChange(false);
      return;
    }

    // BOTH bill types depend on the sibling set: the deduction receipt
    // is fully aggregated, and the sales bill swaps in collective
    // cold-side totals + a per-lot table when 2+ siblings exist.
    // Without awaiting this, a true multi-row batch could render as a
    // single-row receipt while the background sibling fetch is still
    // in flight. `fetchQuery` reuses any in-flight request and resolves
    // once cache is populated, so this is a no-op when siblings have
    // already loaded. Failures fall back silently to the single-row
    // path.
    //
    // The siblings query is keyed on the COLD STORAGE bill # (never on
    // salesBillNumber). For the deduction path `resolvedBillNumber` is
    // already the CS bill # (and may be a freshly-assigned one), so we
    // use it directly. For the sales path `resolvedBillNumber` is the
    // salesBillNumber, so we fall back to the sale's existing
    // coldStorageBillNumber. If neither is available there are no
    // siblings to fetch and the single-row render path is correct.
    const csBillForFetch =
      type === "deduction" ? resolvedBillNumber : sale.coldStorageBillNumber;
    if (csBillForFetch != null) {
      setResolvedCsBillNumber(csBillForFetch);
      try {
        await queryClient.fetchQuery<SalesHistoryWithLastPayment[]>({
          queryKey: ["/api/sales-history/cs-bill-batch", csBillForFetch, csYear],
          queryFn: async () => {
            const res = await authFetch(`/api/sales-history/cs-bill-batch?billNumber=${csBillForFetch}&year=${csYear}`);
            if (!res.ok) throw new Error(`${res.status}`);
            return res.json();
          },
        });
      } catch (err) {
        console.warn("Sibling fetch failed, falling back to single-row receipt:", err);
      }
    }

    flushSync(() => {
      setBillType(type);
      setBillNumber(resolvedBillNumber);
    });

    // Filename slug: a numeric bill # when present, else "blank" for the
    // NULL-CS-bill case (only reachable on the deduction path after
    // Task #260 — sales path always resolves to a number).
    const billSlug = resolvedBillNumber != null ? String(resolvedBillNumber) : "blank";

    if (selectedAction === "share") {
      if (!printRef.current) { onOpenChange(false); return; }
      const filename = type === "deduction"
        ? `cold-storage-deduction-bill-${billSlug}.pdf`
        : `sales-bill-${billSlug}.pdf`;
      setIsSharing(true);
      try {
        await shareReceiptAsPdf(printRef.current, filename, BILL_PRINT_STYLES);
      } catch (err) {
        console.error("Share failed:", err);
      } finally {
        setIsSharing(false);
        onOpenChange(false);
      }
    } else if (selectedAction === "print") {
      // flushSync above guarantees the receipt DOM is painted before
      // we read printRef. The 100 ms timeout matches the prior
      // effect-based path so any lingering layout settles before
      // window.print() reads the document. Calling handlePrint
      // directly here (instead of via an effect gated on billNumber)
      // lets us print receipts whose CS bill # is intentionally NULL —
      // see Task #260.
      //
      // We pass `type` explicitly to handlePrint instead of letting it
      // read `billType` from its enclosing closure: at this point the
      // current closure's `billType` is still its render-M value (null
      // on first click) — only the React state has been updated to
      // render N by flushSync. Passing the param avoids a stale-title
      // bug in the print window.
      //
      // The timer id is stored in printTimerRef so the on-close effect
      // below can cancel it if the user dismisses the dialog before
      // the print fires.
      printTimerRef.current = setTimeout(() => {
        printTimerRef.current = null;
        handlePrint(type);
        onOpenChange(false);
      }, 100);
    }
  };

  // Reset state when dialog closes. Also cancel any pending print
  // timer so quickly-dismissing the dialog never pops a stale print
  // window (see Task #260 architect review).
  useEffect(() => {
    if (!open) {
      if (printTimerRef.current !== null) {
        clearTimeout(printTimerRef.current);
        printTimerRef.current = null;
      }
      setBillType(null);
      setBillNumber(null);
      setAction(null);
      setIsSharing(false);
    }
  }, [open]);

  // Belt-and-braces: clear the print timer on unmount as well, in case
  // the parent unmounts the dialog without first toggling `open`.
  useEffect(() => {
    return () => {
      if (printTimerRef.current !== null) {
        clearTimeout(printTimerRef.current);
        printTimerRef.current = null;
      }
    };
  }, []);

  // `printType` is passed explicitly by the deferred caller in
  // handleBillTypeSelect so the print-window <title> stays correct
  // even though the enclosing closure's `billType` state is stale at
  // the moment the timer fires (see Task #260 architect review). It
  // defaults to the live state for any other future caller.
  const handlePrint = (printType: "deduction" | "sales" | null = billType) => {
    if (!printRef.current) return;

    const printContent = printRef.current.innerHTML;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${printType === "deduction" ? "शीत भण्डार कटौती बिल" : "विक्रय बिल"}</title>
        <style>${BILL_PRINT_STYLES}</style>
      </head>
      <body>
        ${printContent}
      </body>
      </html>
    `;

    // Try window.open first (works on desktop)
    const printWindow = window.open("", "_blank", "width=600,height=800");
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 250);
    } else {
      // Fallback for mobile: use hidden iframe
      const iframe = document.createElement('iframe');
      iframe.style.position = 'absolute';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = 'none';
      iframe.style.left = '-9999px';
      document.body.appendChild(iframe);
      
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        iframeDoc.open();
        iframeDoc.write(htmlContent);
        iframeDoc.close();
        
        setTimeout(() => {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          setTimeout(() => {
            document.body.removeChild(iframe);
          }, 1000);
        }, 250);
      }
    }
  };

  const totalIncome = (sale.netWeight || 0) * (sale.pricePerKg || 0);
  
  const hasSeparateCharges = sale.coldCharge != null && sale.hammali != null;
  
  // Determine bagsToUse based on charge basis
  const chargeBasis = sale.chargeBasis || "actual";
  const bagsToUse = chargeBasis === "totalRemaining" 
    ? (sale.remainingSizeAtSale || sale.quantitySold) 
    : sale.quantitySold;
  
  // Determine charge unit - check chargeUnitAtSale first, then fallback to cold storage setting
  const chargeUnit = sale.chargeUnitAtSale || coldStorage?.chargeUnit || "bag";
  const isQuintalBased = chargeUnit === "quintal";
  
  // Calculate quintal value for cold charges display from stored net weight (not reverse-calculated)
  // Formula: (initialNetWeightKg × bagsToUse) / (originalLotSize × 100)
  const quintalValueNum = isQuintalBased && sale.initialNetWeightKg && sale.originalLotSize && sale.originalLotSize > 0
    ? (sale.initialNetWeightKg * bagsToUse) / (sale.originalLotSize * 100)
    : 0;
  const quintalValue = quintalValueNum > 0 ? quintalValueNum.toFixed(2) : null;

  // Calculate cold charge and hammali amounts directly from rates (not reverse-calculated from totals)
  let coldChargeAmount = 0;
  let hammaliAmount = 0;

  // When base cold charges were already billed in a previous sale, both cold charge and hammali should be 0
  // baseChargeAmountAtSale === 0 indicates base charges were already billed
  if (sale.baseChargeAmountAtSale === 0) {
    coldChargeAmount = 0;
    hammaliAmount = 0;
  } else if (hasSeparateCharges && sale.coldCharge != null && sale.hammali != null) {
    if (isQuintalBased) {
      // In quintal mode: 
      // cold charge = rate × quintals (directly calculated from stored net weight)
      // hammali = rate × bags
      coldChargeAmount = (sale.coldCharge || 0) * quintalValueNum;
      hammaliAmount = (sale.hammali || 0) * bagsToUse;
    } else {
      // In bag mode: both calculated as rate × bags
      coldChargeAmount = (sale.coldCharge || 0) * bagsToUse;
      hammaliAmount = (sale.hammali || 0) * bagsToUse;
    }
  } else {
    // Fallback: use stored coldStorageCharge minus extras and adj amount (coldStorageCharge includes both)
    const extras = (sale.kataCharges || 0) + (sale.extraHammali || 0) + (sale.gradingCharges || 0);
    coldChargeAmount = (sale.coldStorageCharge || 0) - extras - (sale.adjReceivableSelfDueAmount || 0);
    hammaliAmount = 0;
  }

  // Calculate total cold charges from recalculated values
  const extras = (sale.kataCharges || 0) + (sale.extraHammali || 0) + (sale.gradingCharges || 0);
  const adjAmount = sale.adjReceivableSelfDueAmount || 0;
  const adjPy = sale.adjPyReceivables || 0;
  const adjFreightAmt = sale.adjFreight || 0;
  const adjAdvanceAmt = sale.adjAdvance || 0;
  const adjSelfDueAmt = sale.adjSelfDue || 0;
  const adjBreakdownTotal = adjPy + adjFreightAmt + adjAdvanceAmt + adjSelfDueAmt;
  const hasAdjBreakdown = adjAmount > 0 && adjBreakdownTotal > 0;
  const totalCharges = coldChargeAmount + hammaliAmount + extras + adjAmount;
  
  // Net Cold Bill after discount = Total Charges - Discount
  const netColdBill = Math.max(0, totalCharges - discountAllocated);
  
  // Net Payable = Total Income - Net Cold Bill
  const netPayable = totalIncome - netColdBill;

  // ---- Batch aggregation (deduction bill only) ----
  // When 2+ sibling sales share this CS bill # we replace the per-row
  // deduction receipt with a single collective receipt. Each sibling's
  // cold/hammali split is recomputed locally with the same formula used
  // for the per-row view so the totals match what a buyer would get if
  // they printed each row separately, then summed.
  const computeChargesForSibling = (s: SalesHistoryWithLastPayment) => {
    const sIsQuintalBased = (s.chargeUnitAtSale || coldStorage?.chargeUnit || "bag") === "quintal";
    const sBagsToUse = (s.chargeBasis || "actual") === "totalRemaining"
      ? (s.remainingSizeAtSale || s.quantitySold)
      : s.quantitySold;
    const sQuintal = sIsQuintalBased && s.initialNetWeightKg && s.originalLotSize && s.originalLotSize > 0
      ? (s.initialNetWeightKg * sBagsToUse) / (s.originalLotSize * 100)
      : 0;
    const sHasSeparate = s.coldCharge != null && s.hammali != null;
    let sCold = 0;
    let sHammali = 0;
    if (s.baseChargeAmountAtSale === 0) {
      // Base charges already billed in a previous sale → both zero.
    } else if (sHasSeparate && s.coldCharge != null && s.hammali != null) {
      if (sIsQuintalBased) {
        sCold = (s.coldCharge || 0) * sQuintal;
        sHammali = (s.hammali || 0) * sBagsToUse;
      } else {
        sCold = (s.coldCharge || 0) * sBagsToUse;
        sHammali = (s.hammali || 0) * sBagsToUse;
      }
    } else {
      const sExtras = (s.kataCharges || 0) + (s.extraHammali || 0) + (s.gradingCharges || 0);
      sCold = (s.coldStorageCharge || 0) - sExtras - (s.adjReceivableSelfDueAmount || 0);
    }
    return { coldChargeAmount: sCold, hammaliAmount: sHammali };
  };

  const agg = (() => {
    let bags = 0, cold = 0, hammali = 0, kata = 0, extraHam = 0, grading = 0;
    let adjA = 0, adjP = 0, adjF = 0, adjAd = 0, adjS = 0;
    let discount = 0, paid = 0, due = 0, income = 0;
    type TaggedPayment = SalePayment & { lotNo: string; marka: string | null };
    const merged: TaggedPayment[] = [];
    let latestMs = 0;
    for (const s of siblings) {
      const c = computeChargesForSibling(s);
      bags += s.quantitySold || 0;
      cold += c.coldChargeAmount;
      hammali += c.hammaliAmount;
      kata += s.kataCharges || 0;
      extraHam += s.extraHammali || 0;
      grading += s.gradingCharges || 0;
      adjA += s.adjReceivableSelfDueAmount || 0;
      adjP += s.adjPyReceivables || 0;
      adjF += s.adjFreight || 0;
      adjAd += s.adjAdvance || 0;
      adjS += s.adjSelfDue || 0;
      discount += s.discountAllocated || 0;
      paid += s.paidAmount || 0;
      due += s.dueAmount || 0;
      income += (s.netWeight || 0) * (s.pricePerKg || 0);
      // Latest payment date across the batch:
      //   • fully-paid sale → its paidAt;
      //   • partial sale → its most recent applied receipt;
      //   • unpaid sale → no contribution.
      const lp = s.paymentStatus === "paid"
        ? s.paidAt
        : s.paymentStatus === "partial"
          ? (s.lastPaymentAt ?? null)
          : null;
      if (lp) {
        const ms = new Date(lp as unknown as string).getTime();
        if (Number.isFinite(ms) && ms > latestMs) latestMs = ms;
      }
      for (const p of (s.payments || [])) {
        merged.push({ ...p, lotNo: s.lotNo, marka: s.marka });
      }
    }
    merged.sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());
    const extras = kata + extraHam + grading;
    const totalCharges = cold + hammali + extras + adjA;
    const netColdBill = Math.max(0, totalCharges - discount);
    const adjBreakdown = adjP + adjF + adjAd + adjS;
    const hasAdjBreakdown = adjA > 0 && adjBreakdown > 0;
    const actualCashPaid = Math.max(0, paid - discount);
    // Batch status from rolled-up totals (mirrors single-row semantics):
    // due≈0 → paid; some money/discount applied → partial; else due.
    let status: "paid" | "partial" | "due";
    if (due <= 0.5) status = "paid";
    else if (paid > 0 || discount > 0) status = "partial";
    else status = "due";
    const netPayable = income - netColdBill;
    return {
      bags, cold, hammali, kata, extraHam, grading,
      adj: adjA, adjP, adjF, adjAd, adjS, hasAdjBreakdown,
      discount, paid, due, income, netPayable,
      extras, totalCharges, netColdBill, actualCashPaid,
      status,
      latestPaymentAt: latestMs > 0 ? new Date(latestMs) : null,
      mergedPayments: merged,
    };
  })();

  // Batch rate metadata for rate × qty breakdown on Master Nikasi bills.
  // Within a single MN, all sibling rows share the same buyer, the same
  // charge rates (cold + hammali) and the same charge unit (bag/quintal),
  // so the legacy-style "(rate × qty)" line items are recreated using
  // the rate from the first rate-bearing sibling and quantities summed
  // across siblings whose base charges were NOT already billed earlier
  // (baseChargeAmountAtSale !== 0). The resulting cold/hammali totals
  // equal agg.cold / agg.hammali by construction (rate is uniform).
  const batchRateRef =
    siblings.find(s => s.baseChargeAmountAtSale !== 0 && s.coldCharge != null && s.hammali != null)
    ?? siblings[0];
  const batchHasSeparateCharges =
    batchRateRef.coldCharge != null && batchRateRef.hammali != null;
  const batchChargeUnit =
    batchRateRef.chargeUnitAtSale || coldStorage?.chargeUnit || "bag";
  const batchIsQuintalBased = batchChargeUnit === "quintal";
  const batchChargeBasis = batchRateRef.chargeBasis || "actual";
  let batchBagsTotal = 0;        // billed siblings only — drives `rate × qty` math
  let batchBagsAllSiblings = 0;  // every sibling — matches per-lot table column sum
  let batchQuintalTotal = 0;
  for (const s of siblings) {
    const sBagsToUse = (s.chargeBasis || "actual") === "totalRemaining"
      ? (s.remainingSizeAtSale || s.quantitySold)
      : s.quantitySold;
    batchBagsAllSiblings += sBagsToUse;
    if (s.baseChargeAmountAtSale === 0) continue;
    batchBagsTotal += sBagsToUse;
    if (batchIsQuintalBased && s.initialNetWeightKg && s.originalLotSize && s.originalLotSize > 0) {
      batchQuintalTotal += (s.initialNetWeightKg * sBagsToUse) / (s.originalLotSize * 100);
    }
  }
  // Top-section bag count: prefer the billed-only total so it matches the
  // `(rate × batchBagsTotal)` line items below. When the entire batch was
  // already billed earlier (every sibling baseChargeAmountAtSale === 0,
  // batchBagsTotal === 0), fall back to the sum across all siblings using
  // the same `sBagsToUse` formula so it still reconciles with the per-lot
  // table column sum.
  const batchBagsForTop = batchBagsTotal > 0 ? batchBagsTotal : batchBagsAllSiblings;
  const batchQuintalDisplay = batchQuintalTotal > 0 ? batchQuintalTotal.toFixed(2) : "0";

  // Buyer for the batch (single shared buyer across all MN siblings).
  const batchIsSelfSale = (siblings[0].isSelfSale ?? sale.isSelfSale) === 1;
  const batchBuyerName = batchIsSelfSale
    ? "स्वयं"
    : (siblings[0].buyerName || sale.buyerName || "-");

  const renderDeductionBill = () => {
    // Single-row path renders byte-for-byte identical to the previous
    // implementation: every value resolves to the per-row sale field.
    // Multi-row (isBatch) path swaps in `agg.*` totals and replaces the
    // single-sale विक्रय विवरण block with a per-lot table; the payment
    // timeline tags each entry with Receipt # / Marka so the operator
    // can trace which row a receipt closed.
    const dispDiscount = isBatch ? agg.discount : discountAllocated;
    const dispActualCashPaid = isBatch ? agg.actualCashPaid : actualCashPaid;
    const dispTotalCharges = isBatch ? agg.totalCharges : totalCharges;
    const dispNetColdBill = isBatch ? agg.netColdBill : netColdBill;
    const dispDue = isBatch ? agg.due : (sale.dueAmount || 0);
    const dispStatus: "paid" | "partial" | "due" = isBatch
      ? agg.status
      : (sale.paymentStatus as "paid" | "partial" | "due");
    const dispLatestPaymentAt = isBatch
      ? agg.latestPaymentAt
      : (sale.paymentStatus === "paid"
          ? (sale.paidAt ? new Date(sale.paidAt as unknown as string) : null)
          : sale.paymentStatus === "partial"
            ? (sale.lastPaymentAt ? new Date(sale.lastPaymentAt as unknown as string) : null)
            : null);

    return (
    <div>
      <div className="bill-header">
        <h1>{coldStorage?.name || "शीत भण्डार"}</h1>
        {coldStorageAddress && (
          <div style={{ fontSize: "11px", textAlign: "center", marginTop: "2px" }} data-testid="text-cold-storage-address-deduction">{coldStorageAddress}</div>
        )}
        <h2>शीत भण्डार कटौती बिल</h2>
        <div style={{ marginTop: "8px", fontSize: "14px" }}>
          बिल नंबर / Bill No: <strong>{billNumber || "-"}</strong>
        </div>
      </div>

      <div className="two-column">
        <div className="section">
          <div className="section-title">{partyDetailsLabel}</div>
          <div className="info-row">
            <span className="info-label">नाम:</span>
            <span className="info-value">{sale.farmerName}</span>
          </div>
          <div className="info-row">
            <span className="info-label">मोबाइल:</span>
            <span className="info-value">{sale.contactNumber}</span>
          </div>
          <div className="info-row">
            <span className="info-label">गाँव:</span>
            <span className="info-value">{sale.village}</span>
          </div>
        </div>

        {isBatch ? (
          <div className="section" data-testid="section-batch-summary">
            <div className="section-title">विक्रय सारांश</div>
            <div className="info-row">
              <span className="info-label">कुल लॉट:</span>
              <span className="info-value">{siblings.length}</span>
            </div>
            <div className="info-row">
              <span className="info-label">कुल बोरी:</span>
              <span className="info-value" data-testid="text-batch-bags-deduction">{batchBagsForTop}</span>
            </div>
            <div className="info-row">
              <span className="info-label">खरीदार:</span>
              <span className="info-value" data-testid="text-batch-buyer-deduction">{batchBuyerName}</span>
            </div>
          </div>
        ) : (
          <div className="section">
            <div className="section-title">विक्रय विवरण</div>
            <div className="info-row">
              <span className="info-label">विक्रय तिथि:</span>
              <span className="info-value">{format(new Date(sale.soldAt), "dd/MM/yyyy")}</span>
            </div>
            <div className="info-row">
              <span className="info-label">रसीद नं. / Receipt #:</span>
              <span className="info-value">{sale.lotNo}</span>
            </div>
            <div className="info-row">
              <span className="info-label">लॉट नं. / Lot #:</span>
              <span className="info-value">{sale.marka || "—"}</span>
            </div>
            <div className="info-row">
              <span className="info-label">बेची गई:</span>
              <span className="info-value" data-testid="text-single-bags-deduction">{bagsToUse} {sale.bagType === "wafer" ? "वेफर" : "बीज"}{sale.bagTypeLabel ? ` (${sale.bagTypeLabel})` : ""}</span>
            </div>
            <div className="info-row">
              <span className="info-label">खरीदार:</span>
              <span className="info-value">{sale.isSelfSale === 1 ? "स्वयं" : (sale.buyerName || "-")}</span>
            </div>
          </div>
        )}
      </div>

      {/* Per-lot table intentionally omitted on the deduction bill —
          total bags already appear in the विक्रय सारांश block above
          and the per-receipt timeline below covers Receipt # / Lot #
          attribution. */}

      <div className="section">
        <div className="section-title">शुल्क विवरण</div>
        <table className="charges-table">
          <thead>
            <tr>
              <th>विवरण</th>
              <th className="amount">राशि (रु.)</th>
            </tr>
          </thead>
          <tbody>
            {isBatch ? (
              <>
                {/* Master Nikasi siblings share a single buyer + a single
                    set of rates + a single charge unit, so the bill shows
                    the same legacy-style rate × qty line items the
                    single-sale path renders, with bags/quintals summed
                    across rate-bearing siblings (rows already billed
                    earlier — baseChargeAmountAtSale === 0 — are excluded
                    from the qty sum so rate × qty equals agg.*). */}
                {batchHasSeparateCharges ? (
                  <>
                    <tr>
                      <td>
                        शीत भण्डार शुल्क {batchIsQuintalBased
                          ? `(${batchRateRef.coldCharge} रु./क्विंटल × ${batchQuintalDisplay} क्विंटल)`
                          : `(${batchRateRef.coldCharge} रु./बोरी × ${batchBagsTotal} बोरी)`}
                        {batchChargeBasis === "totalRemaining" && <span style={{fontSize: "10px", color: "#666"}}> [कुल शेष आधार]</span>}
                      </td>
                      <td className="amount">{formatAmount(agg.cold)}</td>
                    </tr>
                    {agg.hammali > 0 && (
                      <tr>
                        <td>
                          हम्माली ({batchRateRef.hammali} रु./बोरी × {batchBagsTotal} बोरी)
                        </td>
                        <td className="amount">{formatAmount(agg.hammali)}</td>
                      </tr>
                    )}
                  </>
                ) : (
                  <>
                    <tr>
                      <td>शीत भण्डार शुल्क (कुल)</td>
                      <td className="amount">{formatAmount(agg.cold)}</td>
                    </tr>
                    {agg.hammali > 0 && (
                      <tr>
                        <td>हम्माली (कुल)</td>
                        <td className="amount">{formatAmount(agg.hammali)}</td>
                      </tr>
                    )}
                  </>
                )}
                <tr>
                  <td>काटा (तौल शुल्क)</td>
                  <td className="amount">{agg.kata > 0 ? formatAmount(agg.kata) : "-"}</td>
                </tr>
                <tr>
                  <td>अतिरिक्त हम्माली</td>
                  <td className="amount">{agg.extraHam > 0 ? formatAmount(agg.extraHam) : "-"}</td>
                </tr>
                <tr>
                  <td>ग्रेडिंग शुल्क</td>
                  <td className="amount">{agg.grading > 0 ? formatAmount(agg.grading) : "-"}</td>
                </tr>
                {agg.hasAdjBreakdown ? (
                  <>
                    {agg.adjP > 0 && (
                      <tr>
                        <td>पूर्व वर्ष बकाया (PY Receivables)</td>
                        <td className="amount">{formatAmount(agg.adjP)}</td>
                      </tr>
                    )}
                    {agg.adjF > 0 && (
                      <tr>
                        <td>किसान भाड़ा (Farmer Freight)</td>
                        <td className="amount">{formatAmount(agg.adjF)}</td>
                      </tr>
                    )}
                    {agg.adjAd > 0 && (
                      <tr>
                        <td>किसान अग्रिम (Farmer Advance)</td>
                        <td className="amount">{formatAmount(agg.adjAd)}</td>
                      </tr>
                    )}
                    {agg.adjS > 0 && (
                      <tr>
                        <td>स्वयं बिक्री बकाया (Self Due)</td>
                        <td className="amount">{formatAmount(agg.adjS)}</td>
                      </tr>
                    )}
                  </>
                ) : agg.adj > 0 ? (
                  <tr>
                    <td>बकाया समायोजन (Adj Receivable & Self Due)</td>
                    <td className="amount">{formatAmount(agg.adj)}</td>
                  </tr>
                ) : null}
              </>
            ) : hasSeparateCharges ? (
              <>
                <tr>
                  <td>
                    शीत भण्डार शुल्क {isQuintalBased 
                      ? `(${sale.coldCharge} रु./क्विंटल × ${quintalValue} क्विंटल)` 
                      : `(${sale.coldCharge} रु./बोरी × ${bagsToUse} बोरी)`}
                    {chargeBasis === "totalRemaining" && <span style={{fontSize: "10px", color: "#666"}}> [कुल शेष आधार]</span>}
                  </td>
                  <td className="amount">{formatAmount(coldChargeAmount)}</td>
                </tr>
                <tr>
                  <td>
                    हम्माली ({sale.hammali} रु./बोरी × {bagsToUse} बोरी)
                  </td>
                  <td className="amount">{formatAmount(hammaliAmount)}</td>
                </tr>
              </>
            ) : (
              <tr>
                <td>शीत भण्डार शुल्क + हम्माली ({sale.pricePerBag} रु./बोरी × {bagsToUse} बोरी)</td>
                <td className="amount">{formatAmount(sale.coldStorageCharge || 0)}</td>
              </tr>
            )}
            {!isBatch && (
              <>
                <tr>
                  <td>काटा (तौल शुल्क)</td>
                  <td className="amount">{(sale.kataCharges || 0) > 0 ? formatAmount(sale.kataCharges || 0) : "-"}</td>
                </tr>
                <tr>
                  <td>अतिरिक्त हम्माली</td>
                  <td className="amount">{(sale.extraHammali || 0) > 0 ? formatAmount(sale.extraHammali || 0) : "-"}</td>
                </tr>
                <tr>
                  <td>ग्रेडिंग शुल्क</td>
                  <td className="amount">{(sale.gradingCharges || 0) > 0 ? formatAmount(sale.gradingCharges || 0) : "-"}</td>
                </tr>
                {hasAdjBreakdown ? (
                  <>
                    {adjPy > 0 && (
                      <tr>
                        <td>पूर्व वर्ष बकाया (PY Receivables)</td>
                        <td className="amount">{formatAmount(adjPy)}</td>
                      </tr>
                    )}
                    {adjFreightAmt > 0 && (
                      <tr>
                        <td>किसान भाड़ा (Farmer Freight)</td>
                        <td className="amount">{formatAmount(adjFreightAmt)}</td>
                      </tr>
                    )}
                    {adjAdvanceAmt > 0 && (
                      <tr>
                        <td>किसान अग्रिम (Farmer Advance)</td>
                        <td className="amount">{formatAmount(adjAdvanceAmt)}</td>
                      </tr>
                    )}
                    {adjSelfDueAmt > 0 && (
                      <tr>
                        <td>स्वयं बिक्री बकाया (Self Due)</td>
                        <td className="amount">{formatAmount(adjSelfDueAmt)}</td>
                      </tr>
                    )}
                  </>
                ) : adjAmount > 0 ? (
                  <tr>
                    <td>बकाया समायोजन (Adj Receivable & Self Due)</td>
                    <td className="amount">{formatAmount(adjAmount)}</td>
                  </tr>
                ) : null}
              </>
            )}
            <tr className="total-row">
              <td><strong>कुल शीत भण्डार शुल्क</strong></td>
              <td className="amount"><strong>रु. {formatAmount(dispTotalCharges)}</strong></td>
            </tr>
          </tbody>
        </table>
        
        {/* Discount Row - Show if discount was allocated */}
        {dispDiscount > 0 && (
          <table className="charges-table" style={{ marginTop: "8px" }}>
            <tbody>
              <tr style={{ color: "#16a34a" }}>
                <td><strong>छूट (Discount)</strong></td>
                <td className="amount" style={{ color: "#16a34a" }}><strong>- रु. {formatAmount(dispDiscount)}</strong></td>
              </tr>
              <tr className="total-row" style={{ backgroundColor: "#e6f4ea" }}>
                <td><strong>शुद्ध शीत भण्डार शुल्क</strong> (कुल शुल्क - छूट)</td>
                <td className="amount"><strong>रु. {formatAmount(dispNetColdBill)}</strong></td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="payment-status">
        भुगतान स्थिति: {dispStatus === "paid" 
          ? (dispDiscount > 0 
              ? (dispActualCashPaid > 0 
                  ? `भुगतान हो गया (भुगतान: रु. ${formatAmount(dispActualCashPaid)}, छूट: रु. ${formatAmount(dispDiscount)})`
                  : `भुगतान हो गया (छूट: रु. ${formatAmount(dispDiscount)})`)
              : "भुगतान हो गया")
          : dispStatus === "partial" 
            ? (dispDiscount > 0
                ? (dispActualCashPaid > 0
                    ? `आंशिक भुगतान (भुगतान: रु. ${formatAmount(dispActualCashPaid)}, छूट: रु. ${formatAmount(dispDiscount)}, बकाया: रु. ${formatAmount(dispDue)})`
                    : `आंशिक भुगतान (छूट: रु. ${formatAmount(dispDiscount)}, बकाया: रु. ${formatAmount(dispDue)})`)
                : `आंशिक भुगतान (भुगतान: रु. ${formatAmount(dispActualCashPaid)}, बकाया: रु. ${formatAmount(dispDue)})`)
            : (dispDiscount > 0
                ? `बकाया (छूट: रु. ${formatAmount(dispDiscount)}, बकाया: रु. ${formatAmount(dispDue)})`
                : `बकाया (रु. ${formatAmount(dispDue)})`)}
      </div>

      {dispLatestPaymentAt && (
        <div className="payment-status">
          भुगतान तिथि: {format(dispLatestPaymentAt, "dd/MM/yyyy")}
        </div>
      )}

      {/* Collective payment rollup intentionally omitted — the same
          four headline numbers (देय / भुगतान / छूट / बकाया) already
          appear inline in the green भुगतान स्थिति line above, and the
          per-receipt भुगतान का विवरण timeline below itemises every
          payment. The single छूट + शुद्ध शीत भण्डार शुल्क block (also
          driven by `dispDiscount`/`dispNetColdBill`) renders for both
          single-row and batched bills, matching the per-sale layout. */}

      {/* Payment timeline. Single-row path keeps the existing
          unlabeled rows shown only on partial bills (byte-for-byte).
          Batched path uses the merged chronological list of every
          sibling's receipts (regardless of status) and tags each entry
          with Receipt # / Marka so the farmer can see which lot a
          receipt closed. */}
      {isBatch ? (
        agg.mergedPayments.length > 0 && (
          <div className="section" style={{ marginTop: "8px" }} data-testid="section-partial-payment-history">
            <div className="section-title">भुगतान का विवरण</div>
            {agg.mergedPayments.map((p, idx) => (
              <div
                className="info-row"
                key={`${p.receiptId}-${p.lotNo}-${idx}`}
                data-testid={`row-payment-${p.receiptId}-${p.lotNo}`}
              >
                <span className="info-label">
                  {idx + 1}. {format(new Date(p.receivedAt), "dd/MM/yyyy")} — Receipt #{p.lotNo}{p.marka ? ` / ${p.marka}` : ""}:
                </span>
                <span className="info-value">रु. {formatAmount(p.amount)}</span>
              </div>
            ))}
          </div>
        )
      ) : (
        sale.paymentStatus === "partial" && sale.payments && sale.payments.length > 0 && (
          <div className="section" style={{ marginTop: "8px" }} data-testid="section-partial-payment-history">
            <div className="section-title">भुगतान का विवरण</div>
            {sale.payments.map((p, idx) => (
              <div className="info-row" key={p.receiptId} data-testid={`row-payment-${p.receiptId}`}>
                <span className="info-label">{idx + 1}. {format(new Date(p.receivedAt), "dd/MM/yyyy")}:</span>
                <span className="info-value">रु. {formatAmount(p.amount)}</span>
              </div>
            ))}
          </div>
        )
      )}

      <div className="footer-note">
        यह बिल डिजिटल रूप से जनरेट किया गया है और इसमें किसी मुहर की आवश्यकता नहीं है।
      </div>
    </div>
    );
  };

  const renderSalesBill = () => {
    // Single-row path renders byte-for-byte identical to the previous
    // implementation: every value resolves to the per-row sale field.
    // Multi-row (isBatch) path swaps in `agg.*` totals (cold-side
    // deductions are batch-shared) while individual per-row income
    // stays visible via the लॉट विवरण table that lists each sibling.
    const dispDiscount = isBatch ? agg.discount : discountAllocated;
    const dispTotalCharges = isBatch ? agg.totalCharges : totalCharges;
    const dispNetColdBill = isBatch ? agg.netColdBill : netColdBill;
    const dispTotalIncome = isBatch ? agg.income : totalIncome;
    const dispNetPayable = isBatch ? agg.netPayable : netPayable;
    const dispCold = isBatch ? agg.cold : coldChargeAmount;
    const dispHammali = isBatch ? agg.hammali : hammaliAmount;
    const dispKata = isBatch ? agg.kata : (sale.kataCharges || 0);
    const dispExtraHam = isBatch ? agg.extraHam : (sale.extraHammali || 0);
    const dispGrading = isBatch ? agg.grading : (sale.gradingCharges || 0);
    const dispHasAdjBreakdown = isBatch ? agg.hasAdjBreakdown : hasAdjBreakdown;
    const dispAdjAmount = isBatch ? agg.adj : adjAmount;
    const dispAdjPy = isBatch ? agg.adjP : adjPy;
    const dispAdjFreight = isBatch ? agg.adjF : adjFreightAmt;
    const dispAdjAdvance = isBatch ? agg.adjAd : adjAdvanceAmt;
    const dispAdjSelfDue = isBatch ? agg.adjS : adjSelfDueAmt;

    return (
    <div>
      <div className="bill-header">
        <h1>{coldStorage?.name || "शीत भण्डार"}</h1>
        {coldStorageAddress && (
          <div style={{ fontSize: "11px", textAlign: "center", marginTop: "2px" }} data-testid="text-cold-storage-address-sales">{coldStorageAddress}</div>
        )}
        <h2>विक्रय बिल</h2>
        <div style={{ marginTop: "8px", fontSize: "14px" }}>
          बिल नंबर / Bill No: <strong>{billNumber || "-"}</strong>
        </div>
      </div>

      <div className="two-column">
        <div className="section">
          <div className="section-title">{partyDetailsLabel}</div>
          <div className="info-row">
            <span className="info-label">नाम:</span>
            <span className="info-value">{sale.farmerName}</span>
          </div>
          <div className="info-row">
            <span className="info-label">मोबाइल:</span>
            <span className="info-value">{sale.contactNumber}</span>
          </div>
          <div className="info-row">
            <span className="info-label">गाँव:</span>
            <span className="info-value">{sale.village}</span>
          </div>
        </div>

        {isBatch ? (
          <div className="section" data-testid="section-batch-summary-sales">
            <div className="section-title">विक्रय सारांश</div>
            <div className="info-row">
              <span className="info-label">कुल लॉट:</span>
              <span className="info-value">{siblings.length}</span>
            </div>
            <div className="info-row">
              <span className="info-label">कुल बोरी:</span>
              <span className="info-value" data-testid="text-batch-bags-sales">{agg.bags}</span>
            </div>
            <div className="info-row">
              <span className="info-label">खरीदार:</span>
              <span className="info-value" data-testid="text-batch-buyer-sales">{batchBuyerName}</span>
            </div>
          </div>
        ) : (
          <div className="section">
            <div className="section-title">विक्रय विवरण</div>
            <div className="info-row">
              <span className="info-label">विक्रय तिथि:</span>
              <span className="info-value">{format(new Date(sale.soldAt), "dd/MM/yyyy")}</span>
            </div>
            <div className="info-row">
              <span className="info-label">रसीद नं. / Receipt #:</span>
              <span className="info-value">{sale.lotNo}</span>
            </div>
            <div className="info-row">
              <span className="info-label">लॉट नं. / Lot #:</span>
              <span className="info-value">{sale.marka || "—"}</span>
            </div>
            <div className="info-row">
              <span className="info-label">बेची गई:</span>
              <span className="info-value" data-testid="text-single-bags-sales">{sale.quantitySold} {sale.bagType === "wafer" ? "वेफर" : "बीज"}{sale.bagTypeLabel ? ` (${sale.bagTypeLabel})` : ""}</span>
            </div>
            <div className="info-row">
              <span className="info-label">खरीदार:</span>
              <span className="info-value">{sale.isSelfSale === 1 ? "स्वयं" : (sale.buyerName || "-")}</span>
            </div>
          </div>
        )}
      </div>

      {/* Per-lot table (batch only) — preserves per-row income (weight,
          rate, income) for every sibling so the farmer can reconcile
          each lot against the collective totals shown below. */}
      {isBatch && (
        <div className="section" data-testid="section-batch-lots-sales">
          <div className="section-title">लॉट विवरण</div>
          <table className="charges-table">
            <thead>
              <tr>
                <th>विक्रय तिथि</th>
                <th>रसीद नं. / Receipt #</th>
                <th>लॉट नं. / Lot #</th>
                <th className="amount">बोरी</th>
                <th className="amount">वजन × दर</th>
                <th className="amount">आय (रु.)</th>
              </tr>
            </thead>
            <tbody>
              {siblings.map((s) => {
                const sIncome = (s.netWeight || 0) * (s.pricePerKg || 0);
                // Per-row actual sold bags — the sales bill is the
                // farmer's settlement document, so this column shows the
                // real sold quantity (matches the top "कुल बोरी" total
                // which is also `agg.bags` = sum of `quantitySold`). The
                // cold-store-billed quantity (which can differ under
                // chargeBasis="totalRemaining") still appears on the
                // deduction bill and inside the rate × qty labels below.
                return (
                  <tr key={s.id} data-testid={`row-batch-lot-sales-${s.id}`}>
                    <td>{format(new Date(s.soldAt as unknown as string), "dd/MM/yyyy")}</td>
                    <td>{s.lotNo}</td>
                    <td>{s.marka || "—"}</td>
                    <td className="amount">{s.quantitySold}</td>
                    <td className="amount">{s.netWeight || 0} × {s.pricePerKg || 0}</td>
                    <td className="amount">{formatAmount(sIncome)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="section">
        <div className="section-title">आय एवं कटौती</div>
        <table className="charges-table">
          <tbody>
            <tr className="total-row income">
              <td>
                <strong>कुल आय</strong>
                {!isBatch && ` (${sale.netWeight || 0} कि.ग्रा. × रु. ${sale.pricePerKg || 0}/कि.ग्रा.)`}
              </td>
              <td className="amount"><strong>रु. {formatAmount(dispTotalIncome)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="section">
        <div className="section-title">कटौती{isBatch ? " (सामूहिक)" : ""}</div>
        <table className="charges-table">
          <thead>
            <tr>
              <th>विवरण</th>
              <th className="amount">राशि (रु.)</th>
            </tr>
          </thead>
          <tbody>
            {isBatch ? (
              <>
                {/* Master Nikasi siblings share a single buyer + a single
                    set of rates + a single charge unit, so the bill shows
                    the same legacy-style rate × qty line items the
                    single-sale path renders, with bags/quintals summed
                    across rate-bearing siblings (see deduction bill above
                    for the same logic). */}
                {batchHasSeparateCharges ? (
                  <>
                    <tr>
                      <td>
                        शीत भण्डार शुल्क {batchIsQuintalBased
                          ? `(${batchRateRef.coldCharge} रु./क्विंटल × ${batchQuintalDisplay} क्विंटल)`
                          : `(${batchRateRef.coldCharge} रु./बोरी × ${batchBagsTotal} बोरी)`}
                        {batchChargeBasis === "totalRemaining" && <span style={{fontSize: "10px", color: "#666"}}> [कुल शेष आधार]</span>}
                      </td>
                      <td className="amount">{formatAmount(dispCold)}</td>
                    </tr>
                    {dispHammali > 0 && (
                      <tr>
                        <td>
                          हम्माली ({batchRateRef.hammali} रु./बोरी × {batchBagsTotal} बोरी)
                        </td>
                        <td className="amount">{formatAmount(dispHammali)}</td>
                      </tr>
                    )}
                  </>
                ) : (
                  <>
                    <tr>
                      <td>शीत भण्डार शुल्क (कुल)</td>
                      <td className="amount">{formatAmount(dispCold)}</td>
                    </tr>
                    {dispHammali > 0 && (
                      <tr>
                        <td>हम्माली (कुल)</td>
                        <td className="amount">{formatAmount(dispHammali)}</td>
                      </tr>
                    )}
                  </>
                )}
              </>
            ) : hasSeparateCharges ? (
              <>
                <tr>
                  <td>
                    शीत भण्डार शुल्क {isQuintalBased
                      ? `(${sale.coldCharge} रु./क्विंटल × ${quintalValue} क्विंटल)`
                      : `(${sale.coldCharge} रु./बोरी × ${bagsToUse} बोरी)`}
                    {chargeBasis === "totalRemaining" && <span style={{fontSize: "10px", color: "#666"}}> [कुल शेष आधार]</span>}
                  </td>
                  <td className="amount">{formatAmount(coldChargeAmount)}</td>
                </tr>
                <tr>
                  <td>
                    हम्माली ({sale.hammali} रु./बोरी × {bagsToUse} बोरी)
                  </td>
                  <td className="amount">{formatAmount(hammaliAmount)}</td>
                </tr>
              </>
            ) : (
              <tr>
                <td>शीत भण्डार शुल्क + हम्माली ({sale.pricePerBag} रु./बोरी × {bagsToUse} बोरी)</td>
                <td className="amount">{formatAmount(sale.coldStorageCharge || 0)}</td>
              </tr>
            )}
            <tr>
              <td>काटा (तौल शुल्क)</td>
              <td className="amount">{dispKata > 0 ? formatAmount(dispKata) : "-"}</td>
            </tr>
            <tr>
              <td>अतिरिक्त हम्माली</td>
              <td className="amount">{dispExtraHam > 0 ? formatAmount(dispExtraHam) : "-"}</td>
            </tr>
            <tr>
              <td>ग्रेडिंग शुल्क</td>
              <td className="amount">{dispGrading > 0 ? formatAmount(dispGrading) : "-"}</td>
            </tr>
            {dispHasAdjBreakdown ? (
              <>
                {dispAdjPy > 0 && (
                  <tr>
                    <td>पूर्व वर्ष बकाया (PY Receivables)</td>
                    <td className="amount">{formatAmount(dispAdjPy)}</td>
                  </tr>
                )}
                {dispAdjFreight > 0 && (
                  <tr>
                    <td>किसान भाड़ा (Farmer Freight)</td>
                    <td className="amount">{formatAmount(dispAdjFreight)}</td>
                  </tr>
                )}
                {dispAdjAdvance > 0 && (
                  <tr>
                    <td>किसान अग्रिम (Farmer Advance)</td>
                    <td className="amount">{formatAmount(dispAdjAdvance)}</td>
                  </tr>
                )}
                {dispAdjSelfDue > 0 && (
                  <tr>
                    <td>स्वयं बिक्री बकाया (Self Due)</td>
                    <td className="amount">{formatAmount(dispAdjSelfDue)}</td>
                  </tr>
                )}
              </>
            ) : dispAdjAmount > 0 ? (
              <tr>
                <td>बकाया समायोजन (Adj Receivable & Self Due)</td>
                <td className="amount">{formatAmount(dispAdjAmount)}</td>
              </tr>
            ) : null}
            <tr className="total-row">
              <td><strong>कुल शीत भण्डार शुल्क</strong></td>
              <td className="amount"><strong>रु. {formatAmount(dispTotalCharges)}</strong></td>
            </tr>
          </tbody>
        </table>

        {/* Discount Row for Sales Bill - Show if discount was allocated */}
        {dispDiscount > 0 && (
          <table className="charges-table" style={{ marginTop: "8px" }}>
            <tbody>
              <tr style={{ color: "#16a34a" }}>
                <td><strong>छूट (Discount)</strong></td>
                <td className="amount" style={{ color: "#16a34a" }}><strong>- रु. {formatAmount(dispDiscount)}</strong></td>
              </tr>
              <tr className="total-row" style={{ backgroundColor: "#e6f4ea" }}>
                <td><strong>शुद्ध शीत भण्डार शुल्क</strong> (कुल शुल्क - छूट)</td>
                <td className="amount"><strong>रु. {formatAmount(dispNetColdBill)}</strong></td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="section">
        <table className="charges-table">
          <tbody>
            <tr className="total-row net-income">
              <td><strong>शुद्ध देय (कुल आय - {dispDiscount > 0 ? "शुद्ध शीत भण्डार शुल्क" : "कुल शुल्क"})</strong></td>
              <td className="amount"><strong>रु. {formatAmount(dispNetPayable)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="footer-note">
        यह बिल डिजिटल रूप से जनरेट किया गया है और इसमें किसी मुहर की आवश्यकता नहीं है।
      </div>
    </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        setBillType(null);
        setBillNumber(null);
      }
      onOpenChange(isOpen);
    }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            {t("printBill")}
          </DialogTitle>
        </DialogHeader>

        {!billType ? (
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground text-center">
              {t("selectBillType")}
            </p>
            <div className="grid gap-3">
              {/* Cold Storage Deduction Bill */}
              <div className="border rounded-lg overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                  <Receipt className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{t("coldStorageDeductionBill")}</div>
                    <div className="text-xs text-muted-foreground">{t("chargesBreakdown")}</div>
                  </div>
                  {(() => {
                    const billed = sale.coldStorageCharge || 0;
                    const due = sale.dueAmount || 0;
                    const flag = sale.fifoExclusion || 0;
                    // Disabled when nothing is owed, or when FIFO has already paid into the sale (flag=0 AND due<billed)
                    const noDue = due <= 0;
                    const fifoPartiallyPaid = flag === 0 && due < billed - 0.5;
                    const disabled = noDue || fifoPartiallyPaid;
                    const reason = noDue
                      ? "No outstanding due on this sale"
                      : fifoPartiallyPaid
                        ? "Cannot use manual payment — FIFO has already paid into this sale. Reverse those receipts first."
                        : "";
                    const btn = (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs border-green-600 text-green-700 hover:bg-green-50 hover:text-green-800 dark:hover:bg-green-950 disabled:opacity-50"
                        disabled={disabled}
                        onClick={() => setPaymentDialogOpen(true)}
                        data-testid="button-deduction-bill-payment"
                      >
                        <IndianRupee className="h-3.5 w-3.5" />
                        {t("payment") || "Payment"}
                      </Button>
                    );
                    if (!disabled) return btn;
                    return (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">{btn}</span>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="max-w-xs text-xs">
                            {reason}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })()}
                </div>
                <div className="flex border-t">
                  <Button
                    variant="ghost"
                    className="flex-1 rounded-none h-10 gap-2 text-sm"
                    onClick={() => handleBillTypeSelect("deduction", "print")}
                    data-testid="button-deduction-bill-print"
                  >
                    <Printer className="h-4 w-4" />
                    {t("print")}
                  </Button>
                  <div className="border-l" />
                  <Button
                    variant="ghost"
                    className="flex-1 rounded-none h-10 gap-2 text-sm text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950"
                    onClick={() => handleBillTypeSelect("deduction", "share")}
                    data-testid="button-deduction-bill-share"
                  >
                    <Share2 className="h-4 w-4" />
                    {t("share")}
                  </Button>
                </div>
              </div>

              {/* Sales Bill */}
              <div className="border rounded-lg overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                  <FileText className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{t("salesBill")}</div>
                    <div className="text-xs text-muted-foreground">{t("incomeAndDeductions")}</div>
                  </div>
                </div>
                <div className="flex border-t">
                  <Button
                    variant="ghost"
                    className="flex-1 rounded-none h-10 gap-2 text-sm"
                    onClick={() => handleBillTypeSelect("sales", "print")}
                    data-testid="button-sales-bill-print"
                  >
                    <Printer className="h-4 w-4" />
                    {t("print")}
                  </Button>
                  <div className="border-l" />
                  <Button
                    variant="ghost"
                    className="flex-1 rounded-none h-10 gap-2 text-sm text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950"
                    onClick={() => handleBillTypeSelect("sales", "share")}
                    data-testid="button-sales-bill-share"
                  >
                    <Share2 className="h-4 w-4" />
                    {t("share")}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            {action === "share" ? (
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
            ) : (
              <Printer className="h-5 w-5 mr-2 animate-pulse" />
            )}
            {action === "share"
              ? t("sharingReceipt") + "..."
              : t("preparingPrint") + "..."}
          </div>
        )}

        {/* Hidden print content — rendered off-screen so printRef.current.innerHTML is available */}
        <div style={{ position: "absolute", left: "-9999px", top: 0, pointerEvents: "none" }}>
          <div ref={printRef}>
            {billType === "deduction" ? renderDeductionBill() : billType === "sales" ? renderSalesBill() : null}
          </div>
        </div>
      </DialogContent>
      <ManualPaymentDialog
        sale={sale}
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        onSuccess={() => {
          setPaymentDialogOpen(false);
          onOpenChange(false);
        }}
      />
    </Dialog>
  );
}

// ---- Manual single-sale payment dialog ----
interface ManualPaymentDialogProps {
  sale: SalesHistory;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

function ManualPaymentDialog({ sale, open, onOpenChange, onSuccess }: ManualPaymentDialogProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [paymentMode, setPaymentMode] = useState<"cash" | "account">("cash");
  const [accountId, setAccountId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [roundOff, setRoundOff] = useState<string>("");
  const [receivedAt, setReceivedAt] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState<string>("");

  const currentYear = new Date().getFullYear();
  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({
    queryKey: ["/api/bank-accounts", currentYear],
    enabled: open,
  });

  // Reset form whenever dialog opens
  useEffect(() => {
    if (open) {
      setPaymentMode("cash");
      setAccountId("");
      setAmount("");
      setRoundOff("");
      setReceivedAt(format(new Date(), "yyyy-MM-dd"));
      setNotes("");
    }
  }, [open]);

  const billed = sale.coldStorageCharge || 0;
  const currentDue = sale.dueAmount || 0;
  const isSelfSale = (sale.isSelfSale || 0) === 1;
  const partyLabel = isSelfSale
    ? `${sale.farmerName} (${sale.village})`
    : ((sale.transferToBuyerName && (sale.isTransferReversed || 0) === 0)
        ? sale.transferToBuyerName!
        : (sale.buyerName || sale.farmerName));

  const amountNum = parseFloat(amount) || 0;
  const roundOffNum = parseFloat(roundOff) || 0;
  const gross = amountNum + roundOffNum;
  const exceedsDue = gross > currentDue + 0.5;
  const grossInvalid = gross <= 0;
  // Require a bank account whenever the gross is positive AND mode is account
  // (covers round-off-only submissions that still post an account-mode receipt).
  const accountMissing = paymentMode === "account" && gross > 0 && !accountId;

  const mutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/sales/${sale.id}/manual-payment`, {
        receiptType: paymentMode,
        accountId: paymentMode === "account" ? accountId : undefined,
        amount: amountNum,
        roundOff: roundOffNum,
        receivedAt: new Date(receivedAt).toISOString(),
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast({ title: t("success") || "Success", description: "Payment recorded successfully" });
      // Invalidate everything that depends on this sale + cash flow
      invalidateSaleSideEffects(queryClient);
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts/buyers-with-dues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/merchant-advances/buyers-with-dues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-flow"] });
      queryClient.invalidateQueries({ queryKey: ["/api/exits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/exit-register"] });
      queryClient.invalidateQueries({ queryKey: ["/api/exit-register/years"] });
      queryClient.invalidateQueries({ queryKey: ["/api/buyer-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/farmer-ledger"] });
      onSuccess();
    },
    onError: (err: unknown) => {
      let message = "Failed to record payment";
      if (err instanceof Error && err.message) {
        message = err.message;
      } else if (typeof err === "object" && err !== null) {
        const maybe = err as { response?: { data?: { error?: string } }; message?: string };
        message = maybe.response?.data?.error || maybe.message || message;
      }
      toast({ title: t("error") || "Error", description: message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (grossInvalid) {
      toast({ title: t("error") || "Error", description: "Amount must be greater than zero", variant: "destructive" });
      return;
    }
    if (exceedsDue) {
      toast({ title: t("error") || "Error", description: `Payment exceeds current due (₹${formatAmount(currentDue)})`, variant: "destructive" });
      return;
    }
    if (accountMissing) {
      toast({ title: t("error") || "Error", description: "Please select a bank account", variant: "destructive" });
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-manual-payment">
        <DialogHeader>
          <DialogTitle>Record Payment — Cold Storage Bill</DialogTitle>
        </DialogHeader>

        {/* Sale summary header */}
        <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-muted-foreground">Lot</span><span className="font-medium" data-testid="text-payment-lot">{sale.lotNo}{sale.marka ? ` (${sale.marka})` : ""}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">{isSelfSale ? "Farmer" : "Buyer"}</span><span className="font-medium" data-testid="text-payment-party">{partyLabel}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Billed amount</span><span className="font-medium" data-testid="text-payment-billed">₹{formatAmount(billed)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Current due</span><span className="font-semibold text-red-600 dark:text-red-400" data-testid="text-payment-due">₹{formatAmount(currentDue)}</span></div>
        </div>

        <div className="space-y-3">
          {/* Payment mode */}
          <div className="space-y-1.5">
            <Label className="text-xs">Payment mode</Label>
            <Select value={paymentMode} onValueChange={(v) => setPaymentMode(v as "cash" | "account")}>
              <SelectTrigger className="h-9" data-testid="select-payment-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="account">Account / Bank</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Bank account (only when account) */}
          {paymentMode === "account" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Bank account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="h-9" data-testid="select-bank-account"><SelectValue placeholder="Select an account" /></SelectTrigger>
                <SelectContent>
                  {bankAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.accountName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Amount + Round-off */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Amount (₹)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                data-testid="input-payment-amount"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Round-off (₹)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={roundOff}
                onChange={(e) => setRoundOff(e.target.value)}
                placeholder="0"
                data-testid="input-payment-roundoff"
              />
            </div>
          </div>

          {/* Gross + validation */}
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground">Gross (Amount + Round-off)</span>
            <span className={`font-semibold ${exceedsDue ? "text-red-600 dark:text-red-400" : ""}`} data-testid="text-payment-gross">
              ₹{formatAmount(gross)}
            </span>
          </div>
          {exceedsDue && (
            <div className="text-xs text-red-600 dark:text-red-400" data-testid="text-payment-error-exceeds">
              Cannot exceed current due (₹{formatAmount(currentDue)})
            </div>
          )}

          {/* Received on */}
          <div className="space-y-1.5">
            <Label className="text-xs">Received on</Label>
            <Input
              type="date"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
              data-testid="input-payment-date"
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs">Notes (optional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Remarks…"
              data-testid="input-payment-notes"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending} data-testid="button-payment-cancel">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={mutation.isPending || grossInvalid || exceedsDue || accountMissing}
            className="bg-green-600 hover:bg-green-700 text-white"
            data-testid="button-payment-submit"
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
