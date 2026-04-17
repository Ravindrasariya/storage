import { useState, useRef, useEffect } from "react";
import { flushSync } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Printer, FileText, Receipt, Share2, Loader2 } from "lucide-react";
import type { SalesHistory, ColdStorage } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
  sale: SalesHistory;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PrintBillDialog({ sale, open, onOpenChange }: PrintBillDialogProps) {
  const { t } = useI18n();
  const [billType, setBillType] = useState<"deduction" | "sales" | null>(null);
  const [billNumber, setBillNumber] = useState<number | null>(null);
  const [action, setAction] = useState<"print" | "share" | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const { data: coldStorage } = useQuery<ColdStorage>({
    queryKey: ["/api/cold-storage"],
  });

  // Get discount allocated to this specific sale (tracked directly on salesHistory)
  const discountAllocated = sale.discountAllocated || 0;
  // Actual cash paid = paidAmount - discountAllocated
  const actualCashPaid = Math.max(0, (sale.paidAmount || 0) - discountAllocated);

  const resolveBillNumber = async (type: "deduction" | "sales"): Promise<number> => {
    const existing = type === "deduction" ? sale.coldStorageBillNumber : sale.salesBillNumber;
    if (existing) return existing;
    const apiType = type === "deduction" ? "coldStorage" : "sales";
    const response = await apiRequest("POST", `/api/sales-history/${sale.id}/assign-bill-number`, { billType: apiType });
    const data = await response.json();
    queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
    return data.billNumber;
  };

  const handleBillTypeSelect = async (type: "deduction" | "sales", selectedAction: "print" | "share") => {
    setAction(selectedAction);
    setBillType(type);

    let resolvedBillNumber: number;
    try {
      resolvedBillNumber = await resolveBillNumber(type);
    } catch (err) {
      console.error("Failed to resolve bill number:", err);
      onOpenChange(false);
      return;
    }

    flushSync(() => {
      setBillType(type);
      setBillNumber(resolvedBillNumber);
    });

    if (selectedAction === "share") {
      if (!printRef.current) { onOpenChange(false); return; }
      const filename = type === "deduction"
        ? `cold-storage-deduction-bill-${resolvedBillNumber}.pdf`
        : `sales-bill-${resolvedBillNumber}.pdf`;
      setIsSharing(true);
      try {
        await shareReceiptAsPdf(printRef.current, filename, BILL_PRINT_STYLES);
      } catch (err) {
        console.error("Share failed:", err);
      } finally {
        setIsSharing(false);
        onOpenChange(false);
      }
    }
  };

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setBillType(null);
      setBillNumber(null);
      setAction(null);
      setIsSharing(false);
    }
  }, [open]);

  // Auto-print once bill type is selected and bill number is ready
  useEffect(() => {
    if (billType && billNumber !== null && action === "print") {
      const timer = setTimeout(() => {
        handlePrint();
        onOpenChange(false);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [billType, billNumber, action]);

  const handlePrint = () => {
    if (!printRef.current) return;
    
    const printContent = printRef.current.innerHTML;
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${billType === "deduction" ? "शीत भण्डार कटौती बिल" : "विक्रय बिल"}</title>
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

  const renderDeductionBill = () => (
    <div>
      <div className="bill-header">
        <h1>{coldStorage?.name || "शीत भण्डार"}</h1>
        <h2>शीत भण्डार कटौती बिल</h2>
        <div style={{ marginTop: "8px", fontSize: "14px" }}>
          बिल नंबर / Bill No: <strong>{billNumber || "-"}</strong>
        </div>
      </div>

      <div className="two-column">
        <div className="section">
          <div className="section-title">किसान विवरण</div>
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
            <span className="info-value">{sale.quantitySold} {sale.bagType === "wafer" ? "वेफर" : "बीज"}{sale.bagTypeLabel ? ` (${sale.bagTypeLabel})` : ""}</span>
          </div>
          <div className="info-row">
            <span className="info-label">खरीदार:</span>
            <span className="info-value">{sale.isSelfSale === 1 ? "स्वयं" : (sale.buyerName || "-")}</span>
          </div>
        </div>
      </div>

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
            {hasSeparateCharges ? (
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
            <tr className="total-row">
              <td><strong>कुल शीत भण्डार शुल्क</strong></td>
              <td className="amount"><strong>रु. {formatAmount(totalCharges)}</strong></td>
            </tr>
          </tbody>
        </table>
        
        {/* Discount Row - Show if discount was allocated */}
        {discountAllocated > 0 && (
          <table className="charges-table" style={{ marginTop: "8px" }}>
            <tbody>
              <tr style={{ color: "#16a34a" }}>
                <td><strong>छूट (Discount)</strong></td>
                <td className="amount" style={{ color: "#16a34a" }}><strong>- रु. {formatAmount(discountAllocated)}</strong></td>
              </tr>
              <tr className="total-row" style={{ backgroundColor: "#e6f4ea" }}>
                <td><strong>शुद्ध शीत भण्डार शुल्क</strong> (कुल शुल्क - छूट)</td>
                <td className="amount"><strong>रु. {formatAmount(netColdBill)}</strong></td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="payment-status">
        भुगतान स्थिति: {sale.paymentStatus === "paid" 
          ? (discountAllocated > 0 
              ? (actualCashPaid > 0 
                  ? `भुगतान हो गया (भुगतान: रु. ${formatAmount(actualCashPaid)}, छूट: रु. ${formatAmount(discountAllocated)})`
                  : `भुगतान हो गया (छूट: रु. ${formatAmount(discountAllocated)})`)
              : "भुगतान हो गया")
          : sale.paymentStatus === "partial" 
            ? (discountAllocated > 0
                ? (actualCashPaid > 0
                    ? `आंशिक भुगतान (भुगतान: रु. ${formatAmount(actualCashPaid)}, छूट: रु. ${formatAmount(discountAllocated)}, बकाया: रु. ${formatAmount(sale.dueAmount || 0)})`
                    : `आंशिक भुगतान (छूट: रु. ${formatAmount(discountAllocated)}, बकाया: रु. ${formatAmount(sale.dueAmount || 0)})`)
                : `आंशिक भुगतान (भुगतान: रु. ${formatAmount(actualCashPaid)}, बकाया: रु. ${formatAmount(sale.dueAmount || 0)})`)
            : (discountAllocated > 0
                ? `बकाया (छूट: रु. ${formatAmount(discountAllocated)}, बकाया: रु. ${formatAmount(sale.dueAmount || 0)})`
                : `बकाया (रु. ${formatAmount(sale.dueAmount || 0)})`)}
      </div>

      <div className="footer-note">
        यह बिल डिजिटल रूप से जनरेट किया गया है और इसमें किसी मुहर की आवश्यकता नहीं है।
      </div>
    </div>
  );

  const renderSalesBill = () => (
    <div>
      <div className="bill-header">
        <h1>{coldStorage?.name || "शीत भण्डार"}</h1>
        <h2>विक्रय बिल</h2>
        <div style={{ marginTop: "8px", fontSize: "14px" }}>
          बिल नंबर / Bill No: <strong>{billNumber || "-"}</strong>
        </div>
      </div>

      <div className="two-column">
        <div className="section">
          <div className="section-title">किसान विवरण</div>
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
            <span className="info-value">{sale.quantitySold} {sale.bagType === "wafer" ? "वेफर" : "बीज"}{sale.bagTypeLabel ? ` (${sale.bagTypeLabel})` : ""}</span>
          </div>
          <div className="info-row">
            <span className="info-label">खरीदार:</span>
            <span className="info-value">{sale.isSelfSale === 1 ? "स्वयं" : (sale.buyerName || "-")}</span>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-title">आय एवं कटौती</div>
        <table className="charges-table">
          <tbody>
            <tr className="total-row income">
              <td><strong>कुल आय</strong> ({sale.netWeight || 0} कि.ग्रा. × रु. {sale.pricePerKg || 0}/कि.ग्रा.)</td>
              <td className="amount"><strong>रु. {formatAmount(totalIncome)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="section">
        <div className="section-title">कटौती</div>
        <table className="charges-table">
          <thead>
            <tr>
              <th>विवरण</th>
              <th className="amount">राशि (रु.)</th>
            </tr>
          </thead>
          <tbody>
            {hasSeparateCharges ? (
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
            <tr className="total-row">
              <td><strong>कुल शीत भण्डार शुल्क</strong></td>
              <td className="amount"><strong>रु. {formatAmount(totalCharges)}</strong></td>
            </tr>
          </tbody>
        </table>
        
        {/* Discount Row for Sales Bill - Show if discount was allocated */}
        {discountAllocated > 0 && (
          <table className="charges-table" style={{ marginTop: "8px" }}>
            <tbody>
              <tr style={{ color: "#16a34a" }}>
                <td><strong>छूट (Discount)</strong></td>
                <td className="amount" style={{ color: "#16a34a" }}><strong>- रु. {formatAmount(discountAllocated)}</strong></td>
              </tr>
              <tr className="total-row" style={{ backgroundColor: "#e6f4ea" }}>
                <td><strong>शुद्ध शीत भण्डार शुल्क</strong> (कुल शुल्क - छूट)</td>
                <td className="amount"><strong>रु. {formatAmount(netColdBill)}</strong></td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="section">
        <table className="charges-table">
          <tbody>
            <tr className="total-row net-income">
              <td><strong>शुद्ध देय (कुल आय - {discountAllocated > 0 ? "शुद्ध शीत भण्डार शुल्क" : "कुल शुल्क"})</strong></td>
              <td className="amount"><strong>रु. {formatAmount(netPayable)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="payment-status">
        भुगतान स्थिति: {sale.paymentStatus === "paid" 
          ? (discountAllocated > 0 
              ? (actualCashPaid > 0 
                  ? `भुगतान हो गया (भुगतान: रु. ${formatAmount(actualCashPaid)}, छूट: रु. ${formatAmount(discountAllocated)})`
                  : `भुगतान हो गया (छूट: रु. ${formatAmount(discountAllocated)})`)
              : "भुगतान हो गया")
          : sale.paymentStatus === "partial" 
            ? (discountAllocated > 0
                ? (actualCashPaid > 0
                    ? `आंशिक भुगतान (भुगतान: रु. ${formatAmount(actualCashPaid)}, छूट: रु. ${formatAmount(discountAllocated)}, बकाया: रु. ${formatAmount(sale.dueAmount || 0)})`
                    : `आंशिक भुगतान (छूट: रु. ${formatAmount(discountAllocated)}, बकाया: रु. ${formatAmount(sale.dueAmount || 0)})`)
                : `आंशिक भुगतान (भुगतान: रु. ${formatAmount(actualCashPaid)}, बकाया: रु. ${formatAmount(sale.dueAmount || 0)})`)
            : (discountAllocated > 0
                ? `बकाया (छूट: रु. ${formatAmount(discountAllocated)}, बकाया: रु. ${formatAmount(sale.dueAmount || 0)})`
                : `बकाया (रु. ${formatAmount(sale.dueAmount || 0)})`)}
      </div>

      <div className="footer-note">
        यह बिल डिजिटल रूप से जनरेट किया गया है और इसमें किसी मुहर की आवश्यकता नहीं है।
      </div>
    </div>
  );

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
    </Dialog>
  );
}
