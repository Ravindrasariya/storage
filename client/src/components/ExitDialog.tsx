import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, authFetch, invalidateSaleSideEffects } from "@/lib/queryClient";
import { LogOut, Printer, Save } from "lucide-react";
import { format } from "date-fns";
import type { SalesHistory, ExitHistory, ColdStorage } from "@shared/schema";
import { NikasiPrintable, printNikasiReceipt, type NikasiReceiptData } from "@/components/NikasiPrintable";

type BatchExitRow = {
  exitId: string;
  exitDate: string;
  billNumber: number;
  bagsExited: number;
  isReversed: number;
  saleId: string;
  lotNo: string;
  marka: string | null;
  bagType: string;
  chamberName: string;
  floor: number;
  position: string;
  farmerName: string;
  village: string;
  contactNumber: string;
  farmerLedgerId: string | null;
};

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
  const [billNumberInput, setBillNumberInput] = useState<string>("");
  const [billNumberEdited, setBillNumberEdited] = useState(false);
  const [lastExit, setLastExit] = useState<ExitHistory | null>(null);
  const [pendingPrint, setPendingPrint] = useState(false);
  const [batchData, setBatchData] = useState<NikasiReceiptData | null>(null);
  const [pendingBatchPrint, setPendingBatchPrint] = useState(false);
  const [reprintingExitId, setReprintingExitId] = useState<string | null>(null);
  const batchPrintRef = useRef<HTMLDivElement>(null);

  const { data: coldStorage } = useQuery<ColdStorage>({
    queryKey: ["/api/cold-storage"],
  });

  // Pre-fill the exit bill number from the cold-storage counter when the
  // dialog opens. The operator can override this to match a manual
  // receipt-book number; we keep an "edited" flag to switch the visual
  // state from auto/amber to edited/blue.
  useEffect(() => {
    if (open && coldStorage?.nextExitBillNumber != null) {
      setBillNumberInput(String(coldStorage.nextExitBillNumber));
      setBillNumberEdited(false);
    }
    if (!open) {
      setBillNumberInput("");
      setBillNumberEdited(false);
    }
  }, [open, coldStorage?.nextExitBillNumber]);

  const { data: farmerLedgerData } = useQuery<{ farmers: Array<{ id: string; entityType: string }> }>({
    queryKey: ["/api/farmer-ledger"],
  });
  const isCompany = !!sale?.farmerLedgerId && farmerLedgerData?.farmers?.find(f => f.id === sale.farmerLedgerId)?.entityType === "company";
  const partyRowLabel = isCompany ? "कंपनी / Company:" : "किसान / Farmer:";
  const batchPartyLabel = isCompany ? "कंपनी / Company" : "किसान / Farmer";

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

  // Auto-print when lastExit is set and print is pending
  useEffect(() => {
    if (pendingPrint && lastExit) {
      const timer = setTimeout(() => {
        handlePrint();
        setPendingPrint(false);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [pendingPrint, lastExit]);

  const createExitMutation = useMutation({
    mutationFn: async ({ bagsExited, billNumber }: { bagsExited: number; billNumber?: number }) => {
      const response = await apiRequest("POST", `/api/sales-history/${sale!.id}/exits`,
        billNumber != null ? { bagsExited, billNumber } : { bagsExited });
      return response.json();
    },
    onSuccess: (data: ExitHistory) => {
      toast({ title: t("success"), description: t("exitCreated"), variant: "success" });
      setLastExit(data);
      setPendingPrint(true);
      invalidateSaleSideEffects(queryClient);
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history", sale?.id, "exits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lots/sales-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history/years"] });
      // Refresh the cold-storage counter so the next dialog opening
      // pre-fills with the up-to-date next-bill #s.
      queryClient.invalidateQueries({ queryKey: ["/api/cold-storage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history/exits-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/merchants"] });
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("/api/dashboard/stats") });
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
    const billNum = parseInt(billNumberInput);
    if (!Number.isFinite(billNum) || billNum <= 0) {
      toast({ title: t("error"), description: "Exit bill number must be a positive integer", variant: "destructive" });
      return;
    }
    createExitMutation.mutate({ bagsExited: bags, billNumber: billNum });
  };

  // Auto-print when batchData is set and a batch print is pending.
  useEffect(() => {
    if (pendingBatchPrint && batchData) {
      const timer = setTimeout(() => {
        if (batchPrintRef.current) {
          printNikasiReceipt(batchPrintRef.current.innerHTML, t("masterNikasi"));
        }
        setPendingBatchPrint(false);
        setReprintingExitId(null);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [pendingBatchPrint, batchData, t]);

  const handleReprintExit = async (exit: ExitHistory) => {
    // Detect Master Nikasi batch by counting siblings sharing this billNumber.
    // If 2+ exits share it, render the consolidated Master Nikasi receipt;
    // otherwise fall back to the existing single-lot Exit Receipt.
    if (!exit.billNumber) {
      setLastExit(exit);
      setPendingPrint(true);
      return;
    }
    setReprintingExitId(exit.id);
    try {
      const response = await authFetch(`/api/exits/by-bill/${exit.billNumber}`);
      const json = await response.json() as { exits: BatchExitRow[] };
      const siblings = json.exits || [];
      if (siblings.length >= 2) {
        // Build consolidated receipt data. Use the earliest exit date as the
        // batch's exit date (all rows share it for true Master Nikasi batches,
        // but be defensive in case of edge cases).
        const sortedByDate = [...siblings].sort(
          (a, b) => new Date(a.exitDate).getTime() - new Date(b.exitDate).getTime(),
        );
        const first = sortedByDate[0];
        setBatchData({
          sharedExitBillNumber: exit.billNumber,
          exitDate: first.exitDate,
          farmer: {
            farmerName: first.farmerName,
            village: first.village,
            contactNumber: first.contactNumber,
          },
          sales: siblings.map(s => ({
            saleId: s.saleId,
            lotNo: s.lotNo,
            marka: s.marka,
            bagsExited: s.bagsExited,
            bagType: s.bagType,
            chamberName: s.chamberName,
            floor: s.floor,
            position: s.position,
          })),
        });
        setPendingBatchPrint(true);
      } else {
        setLastExit(exit);
        setPendingPrint(true);
        setReprintingExitId(null);
      }
    } catch (err) {
      // On lookup failure, fall back to single-lot reprint so the user still
      // gets a receipt rather than a silent failure.
      toast({
        title: t("error"),
        description: (err as Error).message || "Failed to check batch",
        variant: "destructive",
      });
      setLastExit(exit);
      setPendingPrint(true);
      setReprintingExitId(null);
    }
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
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogOut className="h-5 w-5" />
              {t("exit")} / निकासी
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-sm bg-muted/50 p-2 rounded-md">
              <div className="truncate">
                <span className="text-muted-foreground">Receipt:</span> <span className="font-medium">{sale.lotNo}</span>
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
                <span className="text-muted-foreground">Buyer:</span> <span className="font-medium">{sale.isSelfSale === 1 ? t("self") : (sale.buyerName || "-")}</span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 text-sm">
              <div className="flex gap-4">
                <span><span className="text-muted-foreground">Exited:</span> <strong>{totalExited}</strong></span>
                <span><span className="text-muted-foreground">Remaining:</span> <strong className="text-primary">{remainingToExit}</strong></span>
              </div>
            </div>

            {remainingToExit > 0 && (
              <>
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
                <div className={`flex items-start gap-2 rounded-md p-2 border ${
                  billNumberEdited
                    ? "border-blue-300 dark:border-blue-700 bg-blue-50/60 dark:bg-blue-900/20"
                    : "border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-900/20"
                }`}>
                  <Label htmlFor="exitBillNumber" className="whitespace-nowrap text-sm pt-1.5">
                    {t("exitBillNumber") || "Exit Bill #"}:
                  </Label>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Input
                        id="exitBillNumber"
                        type="number"
                        min={1}
                        value={billNumberInput}
                        onChange={(e) => {
                          setBillNumberInput(e.target.value);
                          setBillNumberEdited(true);
                        }}
                        className="w-28 h-8"
                        data-testid="input-exit-bill-number"
                      />
                      <Badge
                        variant="outline"
                        className={billNumberEdited
                          ? "text-blue-700 dark:text-blue-300 border-blue-400 dark:border-blue-700"
                          : "text-amber-700 dark:text-amber-300 border-amber-400 dark:border-amber-700"}
                        data-testid="badge-exit-bill-state"
                      >
                        {billNumberEdited ? "edited" : "auto"}
                      </Badge>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {billNumberEdited
                        ? "Edited — please verify before submit"
                        : "Auto-filled — please verify before submit"}
                    </span>
                  </div>
                </div>
              </>
            )}

            {exits.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-1 text-muted-foreground">{t("exitHistory")}</h4>
                <ScrollArea className="h-28">
                  <div className="space-y-1">
                    {exits.map((exit) => (
                      <div
                        key={exit.id}
                        className="flex items-center justify-between text-sm bg-muted/30 px-2 py-1 rounded"
                      >
                        <span>
                          <Badge variant="secondary" className="text-xs px-1 py-0 mr-1">
                            #{exit.billNumber || "-"}
                          </Badge>
                          <strong>{exit.bagsExited}</strong> bags - {format(new Date(exit.exitDate), "dd/MM HH:mm")}
                        </span>
                        <div className="flex items-center gap-1">
                          {exit.isReversed === 1 && (
                            <Badge variant="outline" className="text-destructive text-xs px-1 py-0">
                              Rev
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleReprintExit(exit)}
                            disabled={reprintingExitId === exit.id}
                            data-testid={`button-print-exit-${exit.id}`}
                          >
                            <Printer className="h-3.5 w-3.5" />
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

      {/* Hidden batch print content — used when reprinting an exit that
          belongs to a Master Nikasi batch (2+ exits sharing one billNumber). */}
      <div style={{ position: "absolute", left: "-9999px", top: 0, pointerEvents: "none" }}>
        <div ref={batchPrintRef}>
          {batchData && (
            <NikasiPrintable
              data={batchData}
              coldStorage={coldStorage}
              partyRowLabel={batchPartyLabel}
              t={t}
            />
          )}
        </div>
      </div>

      {/* Hidden print content — rendered off-screen for printRef capture */}
      <div style={{ position: "absolute", left: "-9999px", top: 0, pointerEvents: "none" }}>
        <div ref={printRef}>
          {sale && lastExit && (
            <>
              <div className="header">
                <h1>{coldStorage?.name || "Cold Storage"}</h1>
                <h2>निकासी रसीद / Exit Receipt</h2>
                <h3 style={{ marginTop: "5px", fontSize: "12px" }}>बिल नंबर / Bill No: <strong>{lastExit.billNumber || "-"}</strong></h3>
              </div>

              <div className="details">
                <div className="details-row-double">
                  <div>
                    <span className="details-label">बिक्री तिथि / Sale:</span>
                    <span className="details-value">{formatDate(sale.soldAt)}</span>
                  </div>
                  <div>
                    <span className="details-label">निकासी तिथि / Exit:</span>
                    <span className="details-value">{formatDate(lastExit.exitDate)}</span>
                  </div>
                </div>
                <div className="details-row-double">
                  <div>
                    <span className="details-label">रसीद नं. / Receipt #:</span>
                    <span className="details-value">{sale.lotNo}</span>
                  </div>
                  <div>
                    <span className="details-label">आलू / Potato:</span>
                    <span className="details-value">{sale.potatoType}</span>
                  </div>
                </div>
                <div className="details-row-double">
                  <div>
                    <span className="details-label">लॉट नं. / Lot #:</span>
                    <span className="details-value">{sale.marka || "—"}</span>
                  </div>
                  <div>
                    <span className="details-label"></span>
                    <span className="details-value"></span>
                  </div>
                </div>
                <div className="details-row">
                  <span className="details-label">{partyRowLabel}</span>
                  <span className="details-value">{sale.farmerName}</span>
                </div>
                <div className="details-row">
                  <span className="details-label">खरीदार / Buyer:</span>
                  <span className="details-value">{sale.isSelfSale === 1 ? (language === "hi" ? "स्वयं" : "Self") : (sale.buyerName || "-")}</span>
                </div>
                <div className="separator"></div>
                <div className="details-row-double">
                  <div>
                    <span className="details-label">कुल बेचे / Sold:</span>
                    <span className="details-value">{sale.quantitySold} bags</span>
                  </div>
                  <div>
                    <span className="details-label">निकासी / Exited:</span>
                    <span className="details-value"><strong>{lastExit.bagsExited} bags</strong></span>
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
            </>
          )}
        </div>
      </div>
    </>
  );
}
