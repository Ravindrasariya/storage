import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Printer, FileText, Receipt, AlertTriangle } from "lucide-react";
import type { SalesHistory, ColdStorage } from "@shared/schema";

interface PrintBillDialogProps {
  sale: SalesHistory;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PrintBillDialog({ sale, open, onOpenChange }: PrintBillDialogProps) {
  const { t } = useI18n();
  const [billType, setBillType] = useState<"deduction" | "sales" | null>(null);
  const [showPaymentWarning, setShowPaymentWarning] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const { data: coldStorage } = useQuery<ColdStorage>({
    queryKey: ["/api/cold-storage"],
  });

  const isPaid = sale.paymentStatus === "paid";

  const handleBillTypeSelect = (type: "deduction" | "sales") => {
    if (!isPaid) {
      setShowPaymentWarning(true);
    } else {
      setBillType(type);
    }
  };

  const handlePrint = () => {
    if (printRef.current) {
      const printContent = printRef.current.innerHTML;
      const printWindow = window.open("", "_blank", "width=600,height=800");
      if (printWindow) {
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>${billType === "deduction" ? "शीत भण्डार कटौती बिल" : "विक्रय बिल"}</title>
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
                background: #d4edda;
                color: #155724;
                border-radius: 4px;
                text-align: center;
                font-weight: bold;
                font-size: 11px;
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
        <h1>{coldStorage?.name || "शीत भण्डार"}</h1>
        <h2>शीत भण्डार कटौती बिल</h2>
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
            <span className="info-value">{sale.quantitySold} {sale.bagType === "wafer" ? "वेफर" : "बीज"}</span>
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
                  <td>शीत भण्डार शुल्क ({sale.coldCharge} रु./बोरी × {sale.quantitySold} बोरी)</td>
                  <td className="amount">{coldChargeAmount.toLocaleString()}</td>
                </tr>
                <tr>
                  <td>हम्माली ({sale.hammali} रु./बोरी × {sale.quantitySold} बोरी)</td>
                  <td className="amount">{hammaliAmount.toLocaleString()}</td>
                </tr>
              </>
            ) : (
              <tr>
                <td>शीत भण्डार शुल्क + हम्माली ({sale.pricePerBag} रु./बोरी × {sale.quantitySold} बोरी)</td>
                <td className="amount">{(sale.coldStorageCharge || 0).toLocaleString()}</td>
              </tr>
            )}
            <tr>
              <td>काटा (तौल शुल्क)</td>
              <td className="amount">{(sale.kataCharges || 0) > 0 ? (sale.kataCharges || 0).toLocaleString() : "-"}</td>
            </tr>
            <tr>
              <td>अतिरिक्त हम्माली</td>
              <td className="amount">{(sale.extraHammali || 0) > 0 ? (sale.extraHammali || 0).toLocaleString() : "-"}</td>
            </tr>
            <tr>
              <td>ग्रेडिंग शुल्क</td>
              <td className="amount">{(sale.gradingCharges || 0) > 0 ? (sale.gradingCharges || 0).toLocaleString() : "-"}</td>
            </tr>
            <tr className="total-row">
              <td><strong>कुल शीत भण्डार शुल्क</strong></td>
              <td className="amount"><strong>रु. {totalCharges.toLocaleString()}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="payment-status">
        भुगतान स्थिति: भुगतान हो गया
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
            <span className="info-value">{sale.quantitySold} {sale.bagType === "wafer" ? "वेफर" : "बीज"}</span>
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
              <td className="amount"><strong>रु. {totalIncome.toLocaleString()}</strong></td>
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
                  <td>शीत भण्डार शुल्क ({sale.coldCharge} रु./बोरी × {sale.quantitySold} बोरी)</td>
                  <td className="amount">{coldChargeAmount.toLocaleString()}</td>
                </tr>
                <tr>
                  <td>हम्माली ({sale.hammali} रु./बोरी × {sale.quantitySold} बोरी)</td>
                  <td className="amount">{hammaliAmount.toLocaleString()}</td>
                </tr>
              </>
            ) : (
              <tr>
                <td>शीत भण्डार शुल्क + हम्माली ({sale.pricePerBag} रु./बोरी × {sale.quantitySold} बोरी)</td>
                <td className="amount">{(sale.coldStorageCharge || 0).toLocaleString()}</td>
              </tr>
            )}
            <tr>
              <td>काटा (तौल शुल्क)</td>
              <td className="amount">{(sale.kataCharges || 0) > 0 ? (sale.kataCharges || 0).toLocaleString() : "-"}</td>
            </tr>
            <tr>
              <td>अतिरिक्त हम्माली</td>
              <td className="amount">{(sale.extraHammali || 0) > 0 ? (sale.extraHammali || 0).toLocaleString() : "-"}</td>
            </tr>
            <tr>
              <td>ग्रेडिंग शुल्क</td>
              <td className="amount">{(sale.gradingCharges || 0) > 0 ? (sale.gradingCharges || 0).toLocaleString() : "-"}</td>
            </tr>
            <tr className="total-row">
              <td><strong>कुल शीत भण्डार शुल्क</strong></td>
              <td className="amount"><strong>रु. {totalCharges.toLocaleString()}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="section">
        <table className="charges-table">
          <tbody>
            <tr className="total-row net-income">
              <td><strong>शुद्ध आय (कुल आय - कुल शुल्क)</strong></td>
              <td className="amount"><strong>रु. {netIncome.toLocaleString()}</strong></td>
            </tr>
          </tbody>
        </table>
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
        setShowPaymentWarning(false);
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

        {showPaymentWarning ? (
          <div className="space-y-4 py-4">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="rounded-full bg-amber-100 p-3">
                <AlertTriangle className="h-8 w-8 text-amber-600" />
              </div>
              <h3 className="font-semibold text-lg">भुगतान बकाया है</h3>
              <p className="text-sm text-muted-foreground">
                बिल जनरेट करने के लिए पहले शीत भण्डार का बकाया भुगतान करना होगा।
              </p>
              <p className="text-sm font-medium text-amber-700">
                बकाया राशि: रु. {(totalCharges - (sale.paidAmount || 0)).toLocaleString()}
              </p>
            </div>
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => {
                setShowPaymentWarning(false);
                onOpenChange(false);
              }} data-testid="button-close-warning">
                बंद करें
              </Button>
            </div>
          </div>
        ) : !billType ? (
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
