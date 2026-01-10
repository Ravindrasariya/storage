import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Printer, FileText, Receipt } from "lucide-react";
import type { SalesHistory, ColdStorage } from "@shared/schema";

interface PrintBillDialogProps {
  sale: SalesHistory;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PrintBillDialog({ sale, open, onOpenChange }: PrintBillDialogProps) {
  const { t } = useI18n();
  const [billType, setBillType] = useState<"deduction" | "sales" | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const { data: coldStorage } = useQuery<ColdStorage>({
    queryKey: ["/api/cold-storage"],
  });

  const handlePrint = () => {
    if (printRef.current) {
      const printContent = printRef.current.innerHTML;
      const printWindow = window.open("", "_blank", "width=600,height=800");
      if (printWindow) {
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>${billType === "deduction" ? "Cold Storage Deduction Bill" : "Sales Bill"}</title>
            <style>
              @page {
                size: A4;
                margin: 10mm;
              }
              * { box-sizing: border-box; }
              body {
                font-family: Arial, sans-serif;
                font-size: 11px;
                line-height: 1.3;
                margin: 0;
                padding: 8mm;
              }
              .bill-header {
                text-align: center;
                border-bottom: 2px solid #333;
                padding-bottom: 6px;
                margin-bottom: 10px;
              }
              .bill-header h1 {
                margin: 0 0 3px 0;
                font-size: 16px;
                font-weight: bold;
              }
              .bill-header h2 {
                margin: 0;
                font-size: 12px;
                color: #666;
              }
              .two-column {
                display: flex;
                gap: 20px;
                margin-bottom: 10px;
              }
              .two-column > div {
                flex: 1;
              }
              .section {
                margin-bottom: 10px;
              }
              .section-title {
                font-weight: bold;
                font-size: 11px;
                border-bottom: 1px solid #ccc;
                padding-bottom: 2px;
                margin-bottom: 4px;
              }
              .info-row {
                display: flex;
                justify-content: space-between;
                padding: 2px 0;
                font-size: 10px;
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
                margin-top: 6px;
                font-size: 10px;
              }
              .charges-table th, .charges-table td {
                border: 1px solid #ccc;
                padding: 4px 6px;
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
                font-size: 12px;
              }
              .payment-status {
                margin-top: 10px;
                padding: 6px;
                background: #f0f0f0;
                border-radius: 4px;
                text-align: center;
                font-weight: bold;
                font-size: 11px;
              }
              .payment-status.paid {
                background: #d4edda;
                color: #155724;
              }
              .payment-status.due {
                background: #f8d7da;
                color: #721c24;
              }
              .payment-status.partial {
                background: #fff3cd;
                color: #856404;
              }
              .footer-note {
                margin-top: 12px;
                padding-top: 6px;
                border-top: 1px dashed #ccc;
                text-align: center;
                font-size: 9px;
                color: #666;
                font-style: italic;
              }
            </style>
          </head>
          <body>
            ${printContent}
          </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
          printWindow.print();
          printWindow.close();
        }, 250);
      }
    }
  };

  const totalCharges = (sale.coldStorageCharge || 0) + (sale.kataCharges || 0) + (sale.extraHammali || 0) + (sale.gradingCharges || 0);
  const totalIncome = (sale.netWeight || 0) * (sale.pricePerKg || 0);
  const netIncome = totalIncome - totalCharges;
  
  const hasSeparateCharges = sale.coldCharge != null && sale.hammali != null;
  const coldChargeAmount = hasSeparateCharges ? (sale.coldCharge! * sale.quantitySold) : (sale.coldStorageCharge || 0);
  const hammaliAmount = hasSeparateCharges ? (sale.hammali! * sale.quantitySold) : 0;

  const renderDeductionBill = () => (
    <div ref={printRef}>
      <div className="bill-header">
        <h1>{coldStorage?.name || "Cold Storage"}</h1>
        <h2>Cold Storage Deduction Bill</h2>
      </div>

      <div className="two-column">
        <div className="section">
          <div className="section-title">Farmer Details</div>
          <div className="info-row">
            <span className="info-label">Name:</span>
            <span className="info-value">{sale.farmerName}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Contact:</span>
            <span className="info-value">{sale.contactNumber}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Village:</span>
            <span className="info-value">{sale.village}</span>
          </div>
          <div className="info-row">
            <span className="info-label">District:</span>
            <span className="info-value">{sale.district}, {sale.state}</span>
          </div>
        </div>

        <div className="section">
          <div className="section-title">Sale Details</div>
          <div className="info-row">
            <span className="info-label">Sale Date:</span>
            <span className="info-value">{format(new Date(sale.soldAt), "dd MMM yyyy")}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Lot # / Bags:</span>
            <span className="info-value">{sale.lotNo} ({sale.originalLotSize} bags)</span>
          </div>
          <div className="info-row">
            <span className="info-label">Qty Sold:</span>
            <span className="info-value">{sale.quantitySold} {sale.bagType === "wafer" ? "Wafer" : "Seed"}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Buyer:</span>
            <span className="info-value">{sale.buyerName || "-"}</span>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-title">Charges Breakdown</div>
        <table className="charges-table">
          <thead>
            <tr>
              <th>Description</th>
              <th className="amount">Amount (Rs.)</th>
            </tr>
          </thead>
          <tbody>
            {hasSeparateCharges ? (
              <>
                <tr>
                  <td>Cold Storage Charges ({sale.coldCharge} Rs/bag × {sale.quantitySold} bags)</td>
                  <td className="amount">{coldChargeAmount.toLocaleString()}</td>
                </tr>
                <tr>
                  <td>Hammali ({sale.hammali} Rs/bag × {sale.quantitySold} bags)</td>
                  <td className="amount">{hammaliAmount.toLocaleString()}</td>
                </tr>
              </>
            ) : (
              <tr>
                <td>Cold Storage Charges + Hammali ({sale.pricePerBag} Rs/bag × {sale.quantitySold} bags)</td>
                <td className="amount">{(sale.coldStorageCharge || 0).toLocaleString()}</td>
              </tr>
            )}
            <tr>
              <td>Katta (Weighing Charges)</td>
              <td className="amount">{(sale.kataCharges || 0) > 0 ? (sale.kataCharges || 0).toLocaleString() : "-"}</td>
            </tr>
            <tr>
              <td>Extra Hammali</td>
              <td className="amount">{(sale.extraHammali || 0) > 0 ? (sale.extraHammali || 0).toLocaleString() : "-"}</td>
            </tr>
            <tr>
              <td>Grading Charges</td>
              <td className="amount">{(sale.gradingCharges || 0) > 0 ? (sale.gradingCharges || 0).toLocaleString() : "-"}</td>
            </tr>
            <tr className="total-row">
              <td><strong>Total Cold Storage Charges</strong></td>
              <td className="amount"><strong>Rs. {totalCharges.toLocaleString()}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className={`payment-status ${sale.paymentStatus}`}>
        Payment Status: {sale.paymentStatus === "paid" ? "PAID" : sale.paymentStatus === "partial" ? `PARTIAL (Paid: Rs. ${(sale.paidAmount || 0).toLocaleString()})` : "DUE"}
      </div>

      <div className="footer-note">
        This bill is digitally generated and does not require any stamp.
      </div>
    </div>
  );

  const renderSalesBill = () => (
    <div ref={printRef}>
      <div className="bill-header">
        <h1>{coldStorage?.name || "Cold Storage"}</h1>
        <h2>Sales Bill</h2>
      </div>

      <div className="two-column">
        <div className="section">
          <div className="section-title">Farmer Details</div>
          <div className="info-row">
            <span className="info-label">Name:</span>
            <span className="info-value">{sale.farmerName}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Contact:</span>
            <span className="info-value">{sale.contactNumber}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Village:</span>
            <span className="info-value">{sale.village}</span>
          </div>
          <div className="info-row">
            <span className="info-label">District:</span>
            <span className="info-value">{sale.district}, {sale.state}</span>
          </div>
        </div>

        <div className="section">
          <div className="section-title">Sale Details</div>
          <div className="info-row">
            <span className="info-label">Sale Date:</span>
            <span className="info-value">{format(new Date(sale.soldAt), "dd MMM yyyy")}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Lot # / Bags:</span>
            <span className="info-value">{sale.lotNo} ({sale.originalLotSize} bags)</span>
          </div>
          <div className="info-row">
            <span className="info-label">Qty Sold:</span>
            <span className="info-value">{sale.quantitySold} {sale.bagType === "wafer" ? "Wafer" : "Seed"}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Buyer:</span>
            <span className="info-value">{sale.buyerName || "-"}</span>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-title">Income & Deductions</div>
        <table className="charges-table">
          <tbody>
            <tr className="total-row income">
              <td><strong>Total Income</strong> ({sale.netWeight || 0} kg × Rs. {sale.pricePerKg || 0}/kg)</td>
              <td className="amount"><strong>Rs. {totalIncome.toLocaleString()}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="section">
        <div className="section-title">Deductions</div>
        <table className="charges-table">
          <thead>
            <tr>
              <th>Description</th>
              <th className="amount">Amount (Rs.)</th>
            </tr>
          </thead>
          <tbody>
            {hasSeparateCharges ? (
              <>
                <tr>
                  <td>Cold Storage Charges ({sale.coldCharge} Rs/bag × {sale.quantitySold} bags)</td>
                  <td className="amount">{coldChargeAmount.toLocaleString()}</td>
                </tr>
                <tr>
                  <td>Hammali ({sale.hammali} Rs/bag × {sale.quantitySold} bags)</td>
                  <td className="amount">{hammaliAmount.toLocaleString()}</td>
                </tr>
              </>
            ) : (
              <tr>
                <td>Cold Storage Charges + Hammali ({sale.pricePerBag} Rs/bag × {sale.quantitySold} bags)</td>
                <td className="amount">{(sale.coldStorageCharge || 0).toLocaleString()}</td>
              </tr>
            )}
            <tr>
              <td>Katta (Weighing Charges)</td>
              <td className="amount">{(sale.kataCharges || 0) > 0 ? (sale.kataCharges || 0).toLocaleString() : "-"}</td>
            </tr>
            <tr>
              <td>Extra Hammali</td>
              <td className="amount">{(sale.extraHammali || 0) > 0 ? (sale.extraHammali || 0).toLocaleString() : "-"}</td>
            </tr>
            <tr>
              <td>Grading Charges</td>
              <td className="amount">{(sale.gradingCharges || 0) > 0 ? (sale.gradingCharges || 0).toLocaleString() : "-"}</td>
            </tr>
            <tr className="total-row">
              <td><strong>Total Cold Storage Charges</strong></td>
              <td className="amount"><strong>Rs. {totalCharges.toLocaleString()}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="section">
        <table className="charges-table">
          <tbody>
            <tr className="total-row net-income">
              <td><strong>Net Income (Total Income - Total Charges)</strong></td>
              <td className="amount"><strong>Rs. {netIncome.toLocaleString()}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="footer-note">
        This bill is digitally generated and does not require any stamp.
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) setBillType(null);
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
                onClick={() => setBillType("deduction")}
                data-testid="button-deduction-bill"
              >
                <Receipt className="h-6 w-6" />
                <span className="font-medium">{t("coldStorageDeductionBill")}</span>
                <span className="text-xs text-muted-foreground">{t("chargesBreakdown")}</span>
              </Button>
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col items-center gap-2"
                onClick={() => setBillType("sales")}
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
              <Button variant="outline" onClick={() => setBillType(null)} data-testid="button-back">
                {t("back")}
              </Button>
              <Button onClick={handlePrint} data-testid="button-print">
                <Printer className="h-4 w-4 mr-2" />
                {t("print")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
