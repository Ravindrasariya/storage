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
                size: A5;
                margin: 10mm;
              }
              body {
                font-family: Arial, sans-serif;
                font-size: 12px;
                line-height: 1.4;
                margin: 0;
                padding: 10mm;
                max-width: 148mm;
              }
              .bill-header {
                text-align: center;
                border-bottom: 2px solid #333;
                padding-bottom: 10px;
                margin-bottom: 15px;
              }
              .bill-header h1 {
                margin: 0 0 5px 0;
                font-size: 18px;
                font-weight: bold;
              }
              .bill-header h2 {
                margin: 0;
                font-size: 14px;
                color: #666;
              }
              .section {
                margin-bottom: 15px;
              }
              .section-title {
                font-weight: bold;
                font-size: 13px;
                border-bottom: 1px solid #ccc;
                padding-bottom: 3px;
                margin-bottom: 8px;
              }
              .info-row {
                display: flex;
                justify-content: space-between;
                padding: 3px 0;
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
                margin-top: 10px;
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
                font-size: 14px;
              }
              .payment-status {
                margin-top: 15px;
                padding: 10px;
                background: #f0f0f0;
                border-radius: 4px;
                text-align: center;
                font-weight: bold;
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
                margin-top: 20px;
                padding-top: 10px;
                border-top: 1px dashed #ccc;
                text-align: center;
                font-size: 10px;
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
          <span className="info-label">Lot #:</span>
          <span className="info-value">{sale.lotNo}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Original # Bags:</span>
          <span className="info-value">{sale.originalLotSize}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Quantity Sold:</span>
          <span className="info-value">{sale.quantitySold} bags</span>
        </div>
        <div className="info-row">
          <span className="info-label">Bag Type:</span>
          <span className="info-value">{sale.bagType === "wafer" ? "Wafer" : "Seed"}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Buyer Name:</span>
          <span className="info-value">{sale.buyerName || "-"}</span>
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
          <span className="info-label">Lot #:</span>
          <span className="info-value">{sale.lotNo}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Original # Bags:</span>
          <span className="info-value">{sale.originalLotSize}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Quantity Sold:</span>
          <span className="info-value">{sale.quantitySold} bags</span>
        </div>
        <div className="info-row">
          <span className="info-label">Bag Type:</span>
          <span className="info-value">{sale.bagType === "wafer" ? "Wafer" : "Seed"}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Buyer Name:</span>
          <span className="info-value">{sale.buyerName || "-"}</span>
        </div>
      </div>

      <div className="section">
        <div className="section-title">Income Calculation</div>
        <table className="charges-table">
          <thead>
            <tr>
              <th>Description</th>
              <th className="amount">Amount (Rs.)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="total-row income">
              <td><strong>Total Income</strong> (Net Weight: {sale.netWeight || 0} kg × Rs. {sale.pricePerKg || 0}/kg)</td>
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
