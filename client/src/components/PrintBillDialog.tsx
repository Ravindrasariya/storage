import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Printer, FileText, Receipt } from "lucide-react";
import type { SalesHistory, ColdStorage } from "@shared/schema";
import { calculateTotalColdCharges, calculateProportionalEntryDeductions } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";

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

// Calculate proportional entry deductions for a sale (uses shared helper)
const calculateProportionalDeduction = (sale: SalesHistory, deductionAmount: number): number => {
  if (deductionAmount <= 0) return 0;
  // For individual deduction fields, calculate proportionally
  return calculateProportionalEntryDeductions({
    quantitySold: sale.quantitySold || 0,
    originalLotSize: sale.originalLotSize || 1,
    advanceDeduction: deductionAmount,
    freightDeduction: 0,
    otherDeduction: 0,
  });
};

interface PrintBillDialogProps {
  sale: SalesHistory;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PrintBillDialog({ sale, open, onOpenChange }: PrintBillDialogProps) {
  const { t } = useI18n();
  const [billType, setBillType] = useState<"deduction" | "sales" | null>(null);
  const [billNumber, setBillNumber] = useState<number | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const { data: coldStorage } = useQuery<ColdStorage>({
    queryKey: ["/api/cold-storage"],
  });

  // Get discount allocated to this specific sale (tracked directly on salesHistory)
  const discountAllocated = sale.discountAllocated || 0;
  // Actual cash paid = paidAmount - discountAllocated
  const actualCashPaid = Math.max(0, (sale.paidAmount || 0) - discountAllocated);

  // Mutation to assign bill number
  const assignBillNumberMutation = useMutation({
    mutationFn: async (type: "coldStorage" | "sales") => {
      const response = await apiRequest("POST", `/api/sales-history/${sale.id}/assign-bill-number`, { billType: type });
      return response.json();
    },
    onSuccess: (data) => {
      setBillNumber(data.billNumber);
      // Invalidate sales history to update the cached bill numbers
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
    },
  });

  const handleBillTypeSelect = async (type: "deduction" | "sales") => {
    setBillType(type);
    // Check if bill number already exists in sale data
    const existingBillNumber = type === "deduction" 
      ? sale.coldStorageBillNumber 
      : sale.salesBillNumber;
    
    if (existingBillNumber) {
      setBillNumber(existingBillNumber);
    } else {
      // Assign a new bill number
      const apiType = type === "deduction" ? "coldStorage" : "sales";
      assignBillNumberMutation.mutate(apiType);
    }
  };

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setBillType(null);
      setBillNumber(null);
    }
  }, [open]);

  const handlePrint = () => {
    if (!printRef.current) return;
    
    const printContent = printRef.current.innerHTML;
    const printStyles = `
      @page {
        size: A4;
        margin: 10mm;
      }
      * { box-sizing: border-box; }
      body {
        font-family: Arial, sans-serif;
        font-size: 14px;
        line-height: 1.4;
        margin: 0;
        padding: 10mm;
      }
      .bill-header {
        text-align: center;
        border-bottom: 2px solid #333;
        padding-bottom: 8px;
        margin-bottom: 12px;
      }
      .bill-header h1 {
        margin: 0 0 4px 0;
        font-size: 22px;
        font-weight: bold;
      }
      .bill-header h2 {
        margin: 0;
        font-size: 16px;
        color: #666;
      }
      .two-column {
        display: flex;
        gap: 24px;
        margin-bottom: 12px;
      }
      .two-column > div {
        flex: 1;
      }
      .section {
        margin-bottom: 12px;
      }
      .section-title {
        font-weight: bold;
        font-size: 14px;
        border-bottom: 1px solid #ccc;
        padding-bottom: 3px;
        margin-bottom: 6px;
      }
      .info-row {
        display: flex;
        justify-content: space-between;
        padding: 3px 0;
        font-size: 13px;
      }
      .info-label {
        font-weight: 500;
        color: #555;
      }
      .info-value {
        text-align: right;
      }
      .charges-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 8px;
        font-size: 13px;
      }
      .charges-table th, .charges-table td {
        border: 1px solid #ccc;
        padding: 6px 8px;
        text-align: left;
      }
      .charges-table th {
        background: #f5f5f5;
        font-weight: bold;
      }
      .charges-table .amount {
        text-align: right;
        white-space: nowrap;
      }
      .total-row {
        font-weight: bold;
        background: #e8f4e8;
      }
      .total-row.income {
        background: #e8f0ff;
      }
      .total-row.net-income {
        background: #d4f4d4;
        font-size: 15px;
      }
      .payment-status {
        margin-top: 14px;
        padding: 10px;
        background: #d4edda;
        color: #155724;
        border-radius: 4px;
        text-align: center;
        font-weight: bold;
        font-size: 14px;
      }
      .footer-note {
        margin-top: 16px;
        padding-top: 8px;
        border-top: 1px dashed #ccc;
        text-align: center;
        font-size: 11px;
        color: #666;
        font-style: italic;
      }
      .branding {
        margin-top: 10px;
        text-align: center;
        font-size: 12px;
      }
      .krashu {
        color: #16a34a;
        font-weight: 600;
      }
      .ved {
        color: #f97316;
        font-weight: 600;
      }
    `;
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${billType === "deduction" ? "शीत भण्डार कटौती बिल" : "विक्रय बिल"}</title>
        <style>${printStyles}</style>
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

  const totalCharges = calculateTotalColdCharges(sale);
  const totalIncome = (sale.netWeight || 0) * (sale.pricePerKg || 0);
  
  // Calculate proportional entry deductions for this sale
  const proportionalEntryDeductions = calculateProportionalEntryDeductions({
    quantitySold: sale.quantitySold || 0,
    originalLotSize: sale.originalLotSize || 1,
    advanceDeduction: sale.advanceDeduction || 0,
    freightDeduction: sale.freightDeduction || 0,
    otherDeduction: sale.otherDeduction || 0,
  });
  
  // Total Deductions = cold charges + proportional entry deductions
  const totalDeductions = totalCharges + proportionalEntryDeductions;
  
  // Net Payable = Total Income - Total Deductions
  const netPayable = totalIncome - totalDeductions;
  
  const hasSeparateCharges = sale.coldCharge != null && sale.hammali != null;
  
  // Determine bagsToUse based on charge basis
  const chargeBasis = sale.chargeBasis || "actual";
  const bagsToUse = chargeBasis === "totalRemaining" 
    ? (sale.remainingSizeAtSale || sale.quantitySold) 
    : sale.quantitySold;
  
  // Determine charge unit - check chargeUnitAtSale first, then fallback to cold storage setting
  const chargeUnit = sale.chargeUnitAtSale || coldStorage?.chargeUnit || "bag";
  const isQuintalBased = chargeUnit === "quintal";
  
  // Calculate base charges (total minus extras) from stored values
  const extras = (sale.kataCharges || 0) + (sale.extraHammali || 0) + (sale.gradingCharges || 0);
  const baseChargesTotal = (sale.coldStorageCharge || 0) - extras;
  
  // Split base charges between cold charge and hammali
  // For quintal mode: cold charge is per quintal, hammali is per bag
  // For bag mode: both are per bag
  let coldChargeAmount = 0;
  let hammaliAmount = 0;
  
  // When base cold charges were already billed in a previous sale, both cold charge and hammali should be 0
  // baseChargeAmountAtSale === 0 indicates base charges were already billed
  if (sale.baseChargeAmountAtSale === 0) {
    coldChargeAmount = 0;
    hammaliAmount = 0;
  } else if (hasSeparateCharges && sale.coldCharge != null && sale.hammali != null) {
    if (isQuintalBased) {
      // In quintal mode: hammali = rate × bags, cold charge = total - hammali
      hammaliAmount = (sale.hammali || 0) * bagsToUse;
      coldChargeAmount = Math.max(0, baseChargesTotal - hammaliAmount);
    } else {
      // In bag mode: both calculated proportionally
      const totalRate = (sale.coldCharge || 0) + (sale.hammali || 0);
      if (totalRate > 0) {
        coldChargeAmount = (baseChargesTotal * sale.coldCharge) / totalRate;
        hammaliAmount = (baseChargesTotal * sale.hammali) / totalRate;
      } else {
        coldChargeAmount = baseChargesTotal;
        hammaliAmount = 0;
      }
    }
  } else {
    coldChargeAmount = baseChargesTotal;
    hammaliAmount = 0;
  }
  
  // Calculate quintal value for cold charges display from stored net weight (not reverse-calculated)
  // Formula: (initialNetWeightKg × bagsToUse) / (originalLotSize × 100)
  const quintalValue = isQuintalBased && sale.initialNetWeightKg && sale.originalLotSize && sale.originalLotSize > 0
    ? ((sale.initialNetWeightKg * bagsToUse) / (sale.originalLotSize * 100)).toFixed(2)
    : null;

  const renderDeductionBill = () => (
    <div ref={printRef}>
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
          <div className="info-row">
            <span className="info-label">जिला:</span>
            <span className="info-value">{sale.district}, {sale.state}</span>
          </div>
        </div>

        <div className="section">
          <div className="section-title">विक्रय विवरण</div>
          <div className="info-row">
            <span className="info-label">विक्रय तिथि:</span>
            <span className="info-value">{format(new Date(sale.soldAt), "dd/MM/yyyy")}</span>
          </div>
          <div className="info-row">
            <span className="info-label">लॉट नं. / बोरी:</span>
            <span className="info-value">{sale.lotNo} ({sale.originalLotSize} बोरी)</span>
          </div>
          <div className="info-row">
            <span className="info-label">बेची गई:</span>
            <span className="info-value">{sale.quantitySold} {sale.bagType === "wafer" ? "वेफर" : "बीज"}{sale.bagTypeLabel ? ` (${sale.bagTypeLabel})` : ""}</span>
          </div>
          <div className="info-row">
            <span className="info-label">खरीदार:</span>
            <span className="info-value">{sale.buyerName || "-"}</span>
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
            <tr className="total-row">
              <td><strong>कुल शीत भण्डार शुल्क</strong></td>
              <td className="amount"><strong>रु. {formatAmount(totalCharges)}</strong></td>
            </tr>
          </tbody>
        </table>
        
        {/* Entry Deductions Section - Proportional to bags sold */}
        {proportionalEntryDeductions > 0 && (
          <>
            <div className="section-title" style={{ marginTop: "16px", marginBottom: "8px" }}>प्रवेश कटौती ({sale.quantitySold}/{sale.originalLotSize} बोरी)</div>
            <table className="charges-table">
              <tbody>
                {(sale.advanceDeduction || 0) > 0 && (
                  <tr>
                    <td>अग्रिम</td>
                    <td className="amount">{formatAmount(calculateProportionalDeduction(sale, sale.advanceDeduction || 0))}</td>
                  </tr>
                )}
                {(sale.freightDeduction || 0) > 0 && (
                  <tr>
                    <td>भाड़ा (गाड़ी भाड़ा)</td>
                    <td className="amount">{formatAmount(calculateProportionalDeduction(sale, sale.freightDeduction || 0))}</td>
                  </tr>
                )}
                {(sale.otherDeduction || 0) > 0 && (
                  <tr>
                    <td>अन्य शुल्क</td>
                    <td className="amount">{formatAmount(calculateProportionalDeduction(sale, sale.otherDeduction || 0))}</td>
                  </tr>
                )}
                <tr className="total-row">
                  <td><strong>कुल प्रवेश कटौती</strong></td>
                  <td className="amount"><strong>रु. {formatAmount(proportionalEntryDeductions)}</strong></td>
                </tr>
              </tbody>
            </table>
          </>
        )}
        
        {/* Total Deductions Section - Cold charges + Entry deductions */}
        {proportionalEntryDeductions > 0 && (
          <table className="charges-table" style={{ marginTop: "16px" }}>
            <tbody>
              <tr className="total-row" style={{ backgroundColor: "#f0f0f0" }}>
                <td><strong>कुल कटौती</strong> (शीत भण्डार शुल्क + प्रवेश कटौती)</td>
                <td className="amount"><strong>रु. {formatAmount(totalDeductions)}</strong></td>
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
    <div ref={printRef}>
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
          <div className="info-row">
            <span className="info-label">जिला:</span>
            <span className="info-value">{sale.district}, {sale.state}</span>
          </div>
        </div>

        <div className="section">
          <div className="section-title">विक्रय विवरण</div>
          <div className="info-row">
            <span className="info-label">विक्रय तिथि:</span>
            <span className="info-value">{format(new Date(sale.soldAt), "dd/MM/yyyy")}</span>
          </div>
          <div className="info-row">
            <span className="info-label">लॉट नं. / बोरी:</span>
            <span className="info-value">{sale.lotNo} ({sale.originalLotSize} बोरी)</span>
          </div>
          <div className="info-row">
            <span className="info-label">बेची गई:</span>
            <span className="info-value">{sale.quantitySold} {sale.bagType === "wafer" ? "वेफर" : "बीज"}{sale.bagTypeLabel ? ` (${sale.bagTypeLabel})` : ""}</span>
          </div>
          <div className="info-row">
            <span className="info-label">खरीदार:</span>
            <span className="info-value">{sale.buyerName || "-"}</span>
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
            <tr className="total-row">
              <td><strong>कुल शीत भण्डार शुल्क</strong></td>
              <td className="amount"><strong>रु. {formatAmount(totalCharges)}</strong></td>
            </tr>
          </tbody>
        </table>
        
        {/* Entry Deductions Section - Proportional to bags sold */}
        {proportionalEntryDeductions > 0 && (
          <>
            <div className="section-title" style={{ marginTop: "16px", marginBottom: "8px" }}>प्रवेश कटौती ({sale.quantitySold}/{sale.originalLotSize} बोरी)</div>
            <table className="charges-table">
              <tbody>
                {(sale.advanceDeduction || 0) > 0 && (
                  <tr>
                    <td>अग्रिम</td>
                    <td className="amount">{formatAmount(calculateProportionalDeduction(sale, sale.advanceDeduction || 0))}</td>
                  </tr>
                )}
                {(sale.freightDeduction || 0) > 0 && (
                  <tr>
                    <td>भाड़ा (गाड़ी भाड़ा)</td>
                    <td className="amount">{formatAmount(calculateProportionalDeduction(sale, sale.freightDeduction || 0))}</td>
                  </tr>
                )}
                {(sale.otherDeduction || 0) > 0 && (
                  <tr>
                    <td>अन्य शुल्क</td>
                    <td className="amount">{formatAmount(calculateProportionalDeduction(sale, sale.otherDeduction || 0))}</td>
                  </tr>
                )}
                <tr className="total-row">
                  <td><strong>कुल प्रवेश कटौती</strong></td>
                  <td className="amount"><strong>रु. {formatAmount(proportionalEntryDeductions)}</strong></td>
                </tr>
              </tbody>
            </table>
          </>
        )}
        
        {/* Total Deductions Section - Cold charges + Entry deductions */}
        {proportionalEntryDeductions > 0 && (
          <table className="charges-table" style={{ marginTop: "16px" }}>
            <tbody>
              <tr className="total-row" style={{ backgroundColor: "#f0f0f0" }}>
                <td><strong>कुल कटौती</strong> (शीत भण्डार शुल्क + प्रवेश कटौती)</td>
                <td className="amount"><strong>रु. {formatAmount(totalDeductions)}</strong></td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="section">
        <table className="charges-table">
          <tbody>
            <tr className="total-row net-income">
              <td><strong>शुद्ध देय (कुल आय - कुल कटौती)</strong></td>
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
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col items-center gap-2"
                onClick={() => handleBillTypeSelect("deduction")}
                data-testid="button-deduction-bill"
              >
                <Receipt className="h-6 w-6" />
                <span className="font-medium">{t("coldStorageDeductionBill")}</span>
                <span className="text-xs text-muted-foreground">{t("chargesBreakdown")}</span>
              </Button>
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col items-center gap-2"
                onClick={() => handleBillTypeSelect("sales")}
                data-testid="button-sales-bill"
              >
                <FileText className="h-6 w-6" />
                <span className="font-medium">{t("salesBill")}</span>
                <span className="text-xs text-muted-foreground">{t("incomeAndDeductions")}</span>
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="border rounded-lg p-4 bg-muted/50 max-h-[400px] overflow-y-auto text-sm">
              {billType === "deduction" ? renderDeductionBill() : renderSalesBill()}
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setBillType(null); setBillNumber(null); }} data-testid="button-back">
                {t("back")}
              </Button>
              <Button 
                onClick={handlePrint} 
                disabled={assignBillNumberMutation.isPending || !billNumber}
                data-testid="button-print"
              >
                <Printer className="h-4 w-4 mr-2" />
                {assignBillNumberMutation.isPending ? "Loading..." : t("print")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
