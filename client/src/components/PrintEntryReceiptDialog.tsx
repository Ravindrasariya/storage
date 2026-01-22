import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Printer } from "lucide-react";
import { format } from "date-fns";
import type { Lot, ColdStorage, Chamber } from "@shared/schema";
import { authFetch } from "@/lib/queryClient";

interface PrintEntryReceiptDialogProps {
  lot: Lot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PrintEntryReceiptDialog({ lot, open, onOpenChange }: PrintEntryReceiptDialogProps) {
  const { t } = useI18n();
  const printRef = useRef<HTMLDivElement>(null);

  const { data: coldStorage } = useQuery<ColdStorage>({
    queryKey: ["/api/cold-storage"],
  });

  const { data: chambers } = useQuery<Chamber[]>({
    queryKey: ["/api/chambers"],
  });

  const { data: lotsInBatch, isLoading } = useQuery<Lot[]>({
    queryKey: ["/api/lots/by-entry-sequence", lot.entrySequence],
    queryFn: async () => {
      const response = await authFetch(`/api/lots/by-entry-sequence/${lot.entrySequence}`);
      if (!response.ok) throw new Error("Failed to fetch lots");
      return response.json();
    },
    enabled: open && !!lot.entrySequence,
  });

  const getChamberName = (chamberId: string) => {
    return chambers?.find(c => c.id === chamberId)?.name || chamberId;
  };

  const getRate = (bagType: string) => {
    if (!coldStorage) return 0;
    if (bagType === "wafer") {
      return (coldStorage.waferColdCharge || 0) + (coldStorage.waferHammali || 0);
    }
    return (coldStorage.seedColdCharge || 0) + (coldStorage.seedHammali || 0);
  };

  const handlePrint = () => {
    if (!printRef.current || !lotsInBatch?.length) return;

    const printContent = printRef.current.innerHTML;
    const printStyles = `
      @page { size: A4; margin: 8mm; }
      body { 
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
        font-size: 13px; 
        line-height: 1.3;
        color: #333;
        margin: 0;
        padding: 0;
      }
      .copies-container {
        display: flex;
        flex-direction: column;
        height: 100vh;
      }
      .copy {
        flex: 1;
        padding: 10px 15px;
        border-bottom: 2px dashed #000;
        page-break-inside: avoid;
        overflow: hidden;
      }
      .copy:last-child {
        border-bottom: none;
      }
      .copy-label {
        text-align: right;
        font-size: 11px;
        font-weight: bold;
        color: #666;
        margin-bottom: 5px;
      }
      .receipt-header {
        text-align: center;
        border-bottom: 2px solid #333;
        padding-bottom: 8px;
        margin-bottom: 10px;
      }
      .receipt-header h1 {
        font-size: 18px;
        margin: 0 0 3px 0;
      }
      .receipt-header h2 {
        font-size: 14px;
        margin: 0;
        color: #555;
      }
      .section {
        margin-bottom: 10px;
      }
      .section-title {
        font-size: 12px;
        font-weight: bold;
        background: #f0f0f0;
        padding: 4px 8px;
        margin-bottom: 6px;
        border-left: 3px solid #333;
      }
      .info-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 3px 15px;
      }
      .info-row {
        display: flex;
        gap: 5px;
      }
      .info-label {
        font-weight: 600;
        min-width: 80px;
      }
      .lots-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11px;
      }
      .lots-table th, .lots-table td {
        border: 1px solid #ccc;
        padding: 4px 6px;
        text-align: left;
      }
      .lots-table th {
        background: #f5f5f5;
        font-weight: 600;
      }
      .entry-date {
        text-align: right;
        font-size: 10px;
        color: #666;
        margin-top: 8px;
      }
      .footer-note {
        text-align: center;
        font-size: 9px;
        color: #666;
        margin-top: 10px;
        padding-top: 6px;
        border-top: 1px solid #ccc;
      }
    `;
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Lot Entry Receipt</title>
        <style>${printStyles}</style>
      </head>
      <body>
        <div class="copies-container">
          <div class="copy">
            <div class="copy-label">OFFICE COPY / कार्यालय प्रति</div>
            ${printContent}
          </div>
          <div class="copy">
            <div class="copy-label">CUSTOMER COPY / ग्राहक प्रति</div>
            ${printContent}
          </div>
        </div>
      </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      printWindow.print();
    } else {
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

  const firstLot = lotsInBatch?.[0] || lot;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            {t("lotEntryReceipt") || "Lot Entry Receipt"}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : lotsInBatch && lotsInBatch.length > 0 ? (
          <>
            <div ref={printRef}>
              <div className="receipt-header" style={{ textAlign: "center", borderBottom: "2px solid #333", paddingBottom: "8px", marginBottom: "10px" }}>
                <h1 style={{ fontSize: "18px", margin: "0 0 3px 0" }}>{coldStorage?.name || "Cold Storage"}</h1>
                <h2 style={{ fontSize: "14px", margin: "0", color: "#555" }}>{t("lotEntryReceipt") || "Lot Entry Receipt"}</h2>
                <div style={{ marginTop: "8px", fontSize: "14px" }}>
                  लॉट / बिल नंबर / Lot / Bill No: <strong>{lot.entrySequence}</strong>
                </div>
              </div>

              <div className="section" style={{ marginBottom: "10px" }}>
                <div className="section-title" style={{ fontSize: "12px", fontWeight: "bold", background: "#f0f0f0", padding: "4px 8px", marginBottom: "6px", borderLeft: "3px solid #333" }}>
                  {t("farmerDetails")}
                </div>
                <div className="info-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 15px" }}>
                  <div className="info-row" style={{ display: "flex", gap: "5px" }}>
                    <span className="info-label" style={{ fontWeight: "600", minWidth: "80px" }}>{t("farmerName")}:</span>
                    <span>{firstLot.farmerName}</span>
                  </div>
                  <div className="info-row" style={{ display: "flex", gap: "5px" }}>
                    <span className="info-label" style={{ fontWeight: "600", minWidth: "80px" }}>{t("contactNumber")}:</span>
                    <span>{firstLot.contactNumber}</span>
                  </div>
                  <div className="info-row" style={{ display: "flex", gap: "5px" }}>
                    <span className="info-label" style={{ fontWeight: "600", minWidth: "80px" }}>{t("village")}:</span>
                    <span>{firstLot.village}</span>
                  </div>
                  <div className="info-row" style={{ display: "flex", gap: "5px" }}>
                    <span className="info-label" style={{ fontWeight: "600", minWidth: "80px" }}>{t("tehsil")}:</span>
                    <span>{firstLot.tehsil}</span>
                  </div>
                  <div className="info-row" style={{ display: "flex", gap: "5px" }}>
                    <span className="info-label" style={{ fontWeight: "600", minWidth: "80px" }}>{t("district")}:</span>
                    <span>{firstLot.district}</span>
                  </div>
                  <div className="info-row" style={{ display: "flex", gap: "5px" }}>
                    <span className="info-label" style={{ fontWeight: "600", minWidth: "80px" }}>{t("state")}:</span>
                    <span>{firstLot.state}</span>
                  </div>
                </div>
              </div>

              <div className="section" style={{ marginBottom: "10px" }}>
                <div className="section-title" style={{ fontSize: "12px", fontWeight: "bold", background: "#f0f0f0", padding: "4px 8px", marginBottom: "6px", borderLeft: "3px solid #333" }}>
                  {t("lotDetails") || "Lot Details"}
                </div>
                <table className="lots-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                  <thead>
                    <tr>
                      <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left", background: "#f5f5f5", fontWeight: "600" }}>#</th>
                      <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left", background: "#f5f5f5", fontWeight: "600" }}>{t("lotNo")}</th>
                      <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left", background: "#f5f5f5", fontWeight: "600" }}>{t("type")}</th>
                      <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left", background: "#f5f5f5", fontWeight: "600" }}>{t("bags")}</th>
                      <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left", background: "#f5f5f5", fontWeight: "600" }}>{t("bagType")}</th>
                      <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left", background: "#f5f5f5", fontWeight: "600" }}>{t("bagTypeLabel")}</th>
                      <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left", background: "#f5f5f5", fontWeight: "600" }}>{t("chamber")}</th>
                      <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left", background: "#f5f5f5", fontWeight: "600" }}>{t("floor")}</th>
                      <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left", background: "#f5f5f5", fontWeight: "600" }}>{t("position")}</th>
                      <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left", background: "#f5f5f5", fontWeight: "600" }}>{t("quality")}</th>
                      <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left", background: "#f5f5f5", fontWeight: "600" }}>{t("potatoSize")}</th>
                      <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left", background: "#f5f5f5", fontWeight: "600" }}>{t("rate")} (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lotsInBatch.map((lotItem, index) => (
                      <tr key={lotItem.id}>
                        <td style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>{index + 1}</td>
                        <td style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>{lot.entrySequence}</td>
                        <td style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>{lotItem.type}</td>
                        <td style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>{lotItem.size}</td>
                        <td style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>
                          {lotItem.bagType === "wafer" ? t("wafer") : lotItem.bagType === "seed" ? t("seed") : "Ration"}
                        </td>
                        <td style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>{lotItem.bagTypeLabel || "-"}</td>
                        <td style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>{getChamberName(lotItem.chamberId)}</td>
                        <td style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>{lotItem.floor}</td>
                        <td style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>{lotItem.position}</td>
                        <td style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>
                          {lotItem.quality === "good" ? t("good") : lotItem.quality === "medium" ? t("medium") : t("poor")}
                        </td>
                        <td style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>
                          {lotItem.potatoSize === "large" ? t("large") : t("small")}
                        </td>
                        <td style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>{getRate(lotItem.bagType)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="entry-date" style={{ textAlign: "right", fontSize: "10px", color: "#666", marginTop: "8px" }}>
                {t("entryDate") || "Entry Date"}: {format(new Date(firstLot.createdAt), "dd/MM/yyyy HH:mm")}
              </div>

              <div className="footer-note" style={{ textAlign: "center", fontSize: "9px", color: "#666", marginTop: "10px", paddingTop: "6px", borderTop: "1px solid #ccc" }}>
                {t("receiptFooterNote") || "This is a computer generated receipt."}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-receipt">
                {t("close")}
              </Button>
              <Button onClick={handlePrint} data-testid="button-print-receipt">
                <Printer className="h-4 w-4 mr-2" />
                {t("print")}
              </Button>
            </div>
          </>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No lots found for this entry batch.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
