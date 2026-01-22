import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, authFetch } from "@/lib/queryClient";
import { LogOut, Printer, Save } from "lucide-react";
import { format } from "date-fns";
import type { SalesHistory, ExitHistory, ColdStorage } from "@shared/schema";

interface ExitDialogProps {
  sale: SalesHistory | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExitDialog({ sale, open, onOpenChange }: ExitDialogProps) {
  const { t, language } = useI18n();
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);
  
  const [bagsToExit, setBagsToExit] = useState("");
  const [showPrintReceipt, setShowPrintReceipt] = useState(false);
  const [lastExit, setLastExit] = useState<ExitHistory | null>(null);

  const { data: coldStorage } = useQuery<ColdStorage>({
    queryKey: ["/api/cold-storage"],
  });

  const { data: exitData, refetch: refetchExits } = useQuery<{ exits: ExitHistory[]; totalExited: number }>({
    queryKey: ["/api/sales-history", sale?.id, "exits"],
    queryFn: async () => {
      if (!sale?.id) return { exits: [], totalExited: 0 };
      const response = await authFetch(`/api/sales-history/${sale.id}/exits`);
      return response.json();
    },
    enabled: !!sale?.id && open,
  });

  const exits = exitData?.exits || [];
  const totalExited = exitData?.totalExited || 0;
  const remainingToExit = sale ? sale.quantitySold - totalExited : 0;

  useEffect(() => {
    if (sale && open) {
      setBagsToExit(remainingToExit.toString());
    }
  }, [sale, open, remainingToExit]);

  const createExitMutation = useMutation({
    mutationFn: async (bagsExited: number) => {
      const response = await apiRequest("POST", `/api/sales-history/${sale!.id}/exits`, { bagsExited });
      return response.json();
    },
    onSuccess: (data: ExitHistory) => {
      toast({ title: t("success"), description: t("exitCreated"), variant: "success" });
      setLastExit(data);
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history", sale?.id, "exits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history/years"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history/exits-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/merchants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      refetchExits();
    },
    onError: (error: Error) => {
      toast({ title: t("error"), description: error.message || t("failedToCreateExit"), variant: "destructive" });
    },
  });

  const handleSave = () => {
    const bags = parseInt(bagsToExit);
    if (isNaN(bags) || bags <= 0 || bags > remainingToExit) {
      toast({ title: t("error"), description: `Max bags: ${remainingToExit}`, variant: "destructive" });
      return;
    }
    createExitMutation.mutate(bags);
  };

  const handlePrint = () => {
    if (!printRef.current) return;
    
    const printContent = printRef.current.innerHTML;
    const printStyles = `
      @page { size: A4; margin: 8mm; }
      body { 
        font-family: 'Noto Sans Devanagari', Arial, sans-serif; 
        padding: 0;
        margin: 0;
        font-size: 14px;
      }
      .copies-container {
        display: flex;
        flex-direction: column;
        height: 100vh;
      }
      .copy {
        flex: 1;
        padding: 12px 20px;
        border-bottom: 2px dashed #000;
        page-break-inside: avoid;
      }
      .copy:last-child {
        border-bottom: none;
      }
      .copy-label {
        text-align: right;
        font-size: 11px;
        font-weight: bold;
        color: #666;
        margin-bottom: 8px;
      }
      .header { text-align: center; margin-bottom: 12px; }
      .header h1 { font-size: 20px; margin: 0 0 5px; }
      .header h2 { font-size: 16px; margin: 0; font-weight: normal; border: 1px solid #000; padding: 4px 10px; display: inline-block; }
      .header h3 { font-size: 15px; margin: 8px 0 0; }
      .details { margin-bottom: 10px; }
      .details-row { display: flex; margin-bottom: 4px; }
      .details-row-double { display: flex; margin-bottom: 4px; }
      .details-row-double > div { flex: 1; display: flex; }
      .details-label { font-weight: bold; width: 45%; font-size: 13px; }
      .details-value { width: 55%; font-size: 13px; }
      .separator { border-top: 1px dashed #000; margin: 8px 0; }
      .signature { margin-top: 20px; text-align: right; }
      .signature-line { border-top: 1px solid #000; width: 200px; margin-left: auto; padding-top: 5px; font-size: 12px; }
      .footer { text-align: center; margin-top: 10px; font-size: 11px; color: #666; }
    `;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${t("exitReceipt")}</title>
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

    // Try window.open first (works on desktop)
    const printWindow = window.open("", "_blank", "width=595,height=842");
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

  const formatDate = (date: Date | string) => {
    return format(new Date(date), "dd/MM/yyyy HH:mm");
  };

  if (!sale) return null;

  return (
    <>
      <Dialog open={open && !showPrintReceipt} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogOut className="h-5 w-5" />
              {t("exit")} / निकासी
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-xs bg-muted/50 p-2 rounded-md">
              <div className="truncate">
                <span className="text-muted-foreground">Lot:</span> <span className="font-medium">{sale.lotNo}</span>
              </div>
              <div className="truncate">
                <span className="text-muted-foreground">Bags:</span> <span className="font-medium">{sale.quantitySold}</span>
              </div>
              <div className="truncate">
                <span className="text-muted-foreground">Type:</span> <span className="font-medium">{sale.bagType === "wafer" ? "W" : "S"}</span>
              </div>
              <div className="truncate">
                <span className="text-muted-foreground">Ch:</span> <span className="font-medium">{sale.chamberName}</span>
              </div>
              <div className="truncate">
                <span className="text-muted-foreground">Fl:</span> <span className="font-medium">{sale.floor}</span>
              </div>
              <div className="truncate">
                <span className="text-muted-foreground">Pos:</span> <span className="font-medium">{sale.position}</span>
              </div>
              <div className="col-span-3 truncate">
                <span className="text-muted-foreground">Buyer:</span> <span className="font-medium">{sale.buyerName || "-"}</span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 text-sm">
              <div className="flex gap-4">
                <span><span className="text-muted-foreground">Exited:</span> <strong>{totalExited}</strong></span>
                <span><span className="text-muted-foreground">Remaining:</span> <strong className="text-primary">{remainingToExit}</strong></span>
              </div>
            </div>

            {remainingToExit > 0 && (
              <div className="flex items-center gap-2">
                <Label htmlFor="bagsToExit" className="whitespace-nowrap text-sm">{t("bagsToExit")}:</Label>
                <Input
                  id="bagsToExit"
                  type="number"
                  value={bagsToExit}
                  onChange={(e) => setBagsToExit(e.target.value)}
                  min={1}
                  max={remainingToExit}
                  className="w-24"
                  data-testid="input-bags-to-exit"
                />
                <span className="text-xs text-muted-foreground">(max {remainingToExit})</span>
              </div>
            )}

            {exits.length > 0 && (
              <div>
                <h4 className="text-xs font-medium mb-1 text-muted-foreground">{t("exitHistory")}</h4>
                <ScrollArea className="h-20">
                  <div className="space-y-1">
                    {exits.map((exit) => (
                      <div
                        key={exit.id}
                        className="flex items-center justify-between text-xs bg-muted/30 px-2 py-1 rounded"
                      >
                        <span>
                          <Badge variant="secondary" className="text-[10px] px-1 py-0 mr-1">
                            #{exit.billNumber || "-"}
                          </Badge>
                          <strong>{exit.bagsExited}</strong> bags - {format(new Date(exit.exitDate), "dd/MM HH:mm")}
                        </span>
                        <div className="flex items-center gap-1">
                          {exit.isReversed === 1 && (
                            <Badge variant="outline" className="text-destructive text-[10px] px-1 py-0">
                              Rev
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => {
                              setLastExit(exit);
                              setShowPrintReceipt(true);
                            }}
                            data-testid={`button-print-exit-${exit.id}`}
                          >
                            <Printer className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>

          <DialogFooter className="flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-exit"
            >
              Close
            </Button>
            {remainingToExit > 0 && (
              <Button
                size="sm"
                onClick={handleSave}
                disabled={createExitMutation.isPending}
                data-testid="button-submit-exit"
              >
                <Save className="h-3 w-3 mr-1" />
                Submit
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPrintReceipt} onOpenChange={setShowPrintReceipt}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("exitReceipt")}</DialogTitle>
          </DialogHeader>

          <div ref={printRef} className="p-4 bg-white text-black">
            <div className="header">
              <h1>{coldStorage?.name || "Cold Storage"}</h1>
              <h2>निकासी रसीद / Exit Receipt</h2>
              <h3 style={{ marginTop: "5px", fontSize: "12px" }}>बिल नंबर / Bill No: <strong>{lastExit?.billNumber || "-"}</strong></h3>
            </div>

            <div className="details">
              <div className="details-row-double">
                <div>
                  <span className="details-label">बिक्री तिथि / Sale:</span>
                  <span className="details-value">{formatDate(sale.soldAt)}</span>
                </div>
                <div>
                  <span className="details-label">निकासी तिथि / Exit:</span>
                  <span className="details-value">{lastExit ? formatDate(lastExit.exitDate) : formatDate(new Date())}</span>
                </div>
              </div>
              <div className="details-row-double">
                <div>
                  <span className="details-label">लॉट नंबर / Lot:</span>
                  <span className="details-value">{sale.lotNo}</span>
                </div>
                <div>
                  <span className="details-label">आलू / Potato:</span>
                  <span className="details-value">{sale.potatoType}</span>
                </div>
              </div>
              <div className="details-row">
                <span className="details-label">किसान / Farmer:</span>
                <span className="details-value">{sale.farmerName}</span>
              </div>
              <div className="details-row">
                <span className="details-label">खरीदार / Buyer:</span>
                <span className="details-value">{sale.buyerName || "-"}</span>
              </div>
              <div className="separator"></div>
              <div className="details-row-double">
                <div>
                  <span className="details-label">कुल बेचे / Sold:</span>
                  <span className="details-value">{sale.quantitySold} bags</span>
                </div>
                <div>
                  <span className="details-label">निकासी / Exited:</span>
                  <span className="details-value"><strong>{lastExit?.bagsExited || bagsToExit} bags</strong></span>
                </div>
              </div>
              <div className="details-row-double">
                <div>
                  <span className="details-label">बैग / Bag:</span>
                  <span className="details-value">{sale.bagType === "wafer" ? "Wafer" : "Seed"}</span>
                </div>
                <div>
                  <span className="details-label">कक्ष / Chamber:</span>
                  <span className="details-value">{sale.chamberName}</span>
                </div>
              </div>
              <div className="details-row-double">
                <div>
                  <span className="details-label">मंजिल / Floor:</span>
                  <span className="details-value">{sale.floor}</span>
                </div>
                <div>
                  <span className="details-label">स्थिति / Position:</span>
                  <span className="details-value">{sale.position}</span>
                </div>
              </div>
            </div>

            <div className="signature">
              <div className="signature-line">
                प्रबंधक हस्ताक्षर / Manager Sign
              </div>
            </div>

            <div className="footer">
              कंप्यूटर जनित रसीद / Computer generated receipt
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowPrintReceipt(false)} data-testid="button-close-exit-receipt">
              {t("close")}
            </Button>
            <Button onClick={handlePrint} data-testid="button-print-exit-receipt">
              <Printer className="h-4 w-4 mr-1" />
              {t("print")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
