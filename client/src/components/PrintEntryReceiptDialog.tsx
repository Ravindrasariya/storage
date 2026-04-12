import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Printer, Share2, Loader2 } from "lucide-react";
import { format } from "date-fns";
import type { Lot, ColdStorage } from "@shared/schema";
import { authFetch } from "@/lib/queryClient";
import { useI18n } from "@/lib/i18n";
import { shareReceiptAsPdf } from "@/lib/shareReceipt";

interface PrintEntryReceiptDialogProps {
  lot: Lot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const isWafer = (bagType: string) => bagType === "wafer";
const isSeedRation = (bagType: string) => bagType === "seed" || bagType === "Ration";
const sameCategory = (a: string, b: string) =>
  (isWafer(a) && isWafer(b)) || (isSeedRation(a) && isSeedRation(b));

export function PrintEntryReceiptDialog({ lot, open, onOpenChange }: PrintEntryReceiptDialogProps) {
  const { t } = useI18n();
  const printRef = useRef<HTMLDivElement>(null);
  const [isSharing, setIsSharing] = useState(false);

  const { data: coldStorage } = useQuery<ColdStorage>({
    queryKey: ["/api/cold-storage"],
  });

  const { data: allLotsInBatch, isLoading } = useQuery<Lot[]>({
    queryKey: ["/api/lots/by-entry-sequence", lot.entrySequence],
    queryFn: async () => {
      const response = await authFetch(`/api/lots/by-entry-sequence/${lot.entrySequence}`);
      if (!response.ok) throw new Error("Failed to fetch lots");
      return response.json();
    },
    enabled: open && !!lot.entrySequence,
  });

  const lotsInBatch = allLotsInBatch?.filter(l => sameCategory(l.bagType, lot.bagType));

  const getBagTypeHindi = (bagType: string) => {
    if (isWafer(bagType)) return "वेफर";
    if (bagType === "seed") return "बीज";
    return "राशन";
  };

  const handlePrint = () => {
    if (!printRef.current || !lotsInBatch?.length) return;

    const printContent = printRef.current.innerHTML;
    const printStyles = `
      @page { size: A4; margin: 8mm; }
      body { 
        font-family: 'Noto Sans Devanagari', 'Mangal', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
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
      .receipt-header h1 { font-size: 18px; margin: 0 0 3px 0; }
      .receipt-header h2 { font-size: 14px; margin: 0; color: #555; }
      .section { margin-bottom: 10px; }
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
      .info-row { display: flex; gap: 5px; }
      .info-label { font-weight: 600; min-width: 80px; }
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
      .lots-table th { background: #f5f5f5; font-weight: 600; }
      .lots-table td.num { text-align: right; }
      .remarks-section {
        margin-top: 8px;
        font-size: 11px;
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
        <meta charset="utf-8" />
        <title>Lot Entry Receipt</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600;700&display=swap" rel="stylesheet">
        <style>${printStyles}</style>
      </head>
      <body>
        <div class="copies-container">
          <div class="copy">
            <div class="copy-label">कार्यालय प्रति / OFFICE COPY</div>
            ${printContent}
          </div>
          <div class="copy">
            <div class="copy-label">ग्राहक प्रति / CUSTOMER COPY</div>
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
          setTimeout(() => document.body.removeChild(iframe), 1000);
        }, 250);
      }
    }
  };

  const handleShare = async () => {
    if (!printRef.current || !lotsInBatch?.length) return;
    const filename = `lot-entry-receipt-${lot.entrySequence}.pdf`;
    setIsSharing(true);
    try {
      await shareReceiptAsPdf(printRef.current, filename);
    } catch (err) {
      console.error("Share failed:", err);
    } finally {
      setIsSharing(false);
    }
  };

  const firstLot = lotsInBatch?.[0] || lot;
  const remarksLots = lotsInBatch?.filter(l => l.remarks && l.remarks.trim()) || [];

  const cellStyle = { border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" as const };
  const numCellStyle = { ...cellStyle, textAlign: "right" as const };
  const thStyle = { ...cellStyle, background: "#f5f5f5", fontWeight: 600 as const };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            लॉट प्रवेश रसीद / Lot Entry Receipt
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
              {/* Header */}
              <div style={{ textAlign: "center", borderBottom: "2px solid #333", paddingBottom: "8px", marginBottom: "10px" }}>
                <h1 style={{ fontSize: "18px", margin: "0 0 3px 0" }}>{coldStorage?.name || "Cold Storage"}</h1>
                <h2 style={{ fontSize: "14px", margin: "0", color: "#555" }}>लॉट प्रवेश रसीद</h2>
                <div style={{ marginTop: "8px", fontSize: "14px" }}>
                  रसीद नं.: <strong>{lot.entrySequence}</strong>
                  {" "}({isWafer(lot.bagType) ? "वेफर" : "बीज/राशन"})
                </div>
              </div>

              {/* Farmer Details */}
              <div style={{ marginBottom: "10px" }}>
                <div style={{ fontSize: "12px", fontWeight: "bold", background: "#f0f0f0", padding: "4px 8px", marginBottom: "6px", borderLeft: "3px solid #333" }}>
                  किसान विवरण
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 15px" }}>
                  <div style={{ display: "flex", gap: "5px" }}>
                    <span style={{ fontWeight: 600, minWidth: "90px" }}>किसान का नाम:</span>
                    <span>{firstLot.farmerName}</span>
                  </div>
                  <div style={{ display: "flex", gap: "5px" }}>
                    <span style={{ fontWeight: 600, minWidth: "90px" }}>संपर्क नंबर:</span>
                    <span>{firstLot.contactNumber}</span>
                  </div>
                  <div style={{ display: "flex", gap: "5px" }}>
                    <span style={{ fontWeight: 600, minWidth: "90px" }}>गाँव:</span>
                    <span>{firstLot.village}</span>
                  </div>
                  <div style={{ display: "flex", gap: "5px" }}>
                    <span style={{ fontWeight: 600, minWidth: "90px" }}>तहसील:</span>
                    <span>{firstLot.tehsil}</span>
                  </div>
                  {firstLot.rstNo && (
                    <div style={{ display: "flex", gap: "5px" }}>
                      <span style={{ fontWeight: 600, minWidth: "90px" }}>RST No:</span>
                      <span>{firstLot.rstNo}</span>
                    </div>
                  )}
                  {firstLot.vehicle && (
                    <div style={{ display: "flex", gap: "5px" }}>
                      <span style={{ fontWeight: 600, minWidth: "90px" }}>वाहन:</span>
                      <span>{firstLot.vehicle}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Lot Details Table */}
              <div style={{ marginBottom: "10px" }}>
                <div style={{ fontSize: "12px", fontWeight: "bold", background: "#f0f0f0", padding: "4px 8px", marginBottom: "6px", borderLeft: "3px solid #333" }}>
                  लॉट विवरण
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>#</th>
                      <th style={thStyle}>लॉट नं.</th>
                      <th style={thStyle}>आलू किस्म</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>बोरे</th>
                      <th style={thStyle}>श्रेणी</th>
                      <th style={thStyle}>बोरा लेबल</th>
                      <th style={thStyle}>आलू का आकार</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lotsInBatch.map((lotItem, index) => (
                      <tr key={lotItem.id}>
                        <td style={cellStyle}>{index + 1}</td>
                        <td style={cellStyle}>{lotItem.marka || lotItem.lotNo}</td>
                        <td style={cellStyle}>{lotItem.type}</td>
                        <td style={numCellStyle}>{lotItem.size}</td>
                        <td style={cellStyle}>{getBagTypeHindi(lotItem.bagType)}</td>
                        <td style={cellStyle}>{lotItem.bagTypeLabel || "-"}</td>
                        <td style={cellStyle}>
                          {lotItem.potatoSize === "large" ? "बड़ा" : "छोटा"}
                        </td>
                      </tr>
                    ))}
                    {lotsInBatch.length > 1 && (
                      <tr>
                        <td colSpan={3} style={{ ...cellStyle, fontWeight: 600 }}>कुल / Total</td>
                        <td style={{ ...numCellStyle, fontWeight: 600 }}>{lotsInBatch.reduce((s, l) => s + l.size, 0)}</td>
                        <td colSpan={3} style={cellStyle}></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Remarks */}
              {remarksLots.length > 0 && (
                <div style={{ marginTop: "6px", fontSize: "11px" }}>
                  <span style={{ fontWeight: 600 }}>टिप्पणी: </span>
                  {remarksLots.length === 1
                    ? remarksLots[0].remarks
                    : remarksLots.map(l => `लॉट ${l.lotNo}: ${l.remarks}`).join(" | ")}
                </div>
              )}

              {/* Entry Date */}
              <div style={{ textAlign: "right", fontSize: "10px", color: "#666", marginTop: "8px" }}>
                प्रवेश दिनांक: {format(new Date(firstLot.createdAt), "dd/MM/yyyy HH:mm")}
              </div>

              {/* Footer */}
              <div style={{ textAlign: "center", fontSize: "9px", color: "#666", marginTop: "10px", paddingTop: "6px", borderTop: "1px solid #ccc" }}>
                <div>यह कंप्यूटर जनरेटेड रसीद है।</div>
                <div>By कृषुवेद</div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-receipt">
                बंद करें
              </Button>
              <Button
                variant="outline"
                onClick={handleShare}
                disabled={isSharing}
                data-testid="button-share-receipt"
              >
                {isSharing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Share2 className="h-4 w-4 mr-2" />
                )}
                {isSharing ? t("sharingReceipt") + "..." : t("share")}
              </Button>
              <Button onClick={handlePrint} data-testid="button-print-receipt">
                <Printer className="h-4 w-4 mr-2" />
                प्रिंट करें
              </Button>
            </div>
          </>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            इस बैच के लिए कोई लॉट नहीं मिला।
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
