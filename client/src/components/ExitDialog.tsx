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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { LogOut, RotateCcw, Printer, Save, X } from "lucide-react";
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
      const response = await fetch(`/api/sales-history/${sale.id}/exits`);
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
      toast({ title: t("success"), description: t("exitCreated") });
      setLastExit(data);
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history", sale?.id, "exits"] });
      refetchExits();
    },
    onError: (error: Error) => {
      toast({ title: t("error"), description: error.message || t("failedToCreateExit"), variant: "destructive" });
    },
  });

  const reverseExitMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/sales-history/${sale!.id}/exits/reverse-latest`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: t("success"), description: t("exitReversed") });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history", sale?.id, "exits"] });
      refetchExits();
    },
    onError: () => {
      toast({ title: t("error"), description: t("failedToReverseExit"), variant: "destructive" });
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

  const handleSaveAndPrint = () => {
    const bags = parseInt(bagsToExit);
    if (isNaN(bags) || bags <= 0 || bags > remainingToExit) {
      toast({ title: t("error"), description: `Max bags: ${remainingToExit}`, variant: "destructive" });
      return;
    }
    createExitMutation.mutate(bags, {
      onSuccess: (data: ExitHistory) => {
        setLastExit(data);
        setShowPrintReceipt(true);
      },
    });
  };

  const handlePrint = () => {
    if (!printRef.current) return;
    
    const printContent = printRef.current.innerHTML;
    const printWindow = window.open("", "_blank", "width=595,height=842");
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${t("exitReceipt")}</title>
        <style>
          @page { size: A5; margin: 10mm; }
          body { 
            font-family: 'Noto Sans Devanagari', Arial, sans-serif; 
            padding: 20px; 
            max-width: 420px;
            margin: 0 auto;
            font-size: 12px;
          }
          .header { text-align: center; margin-bottom: 20px; }
          .header h1 { font-size: 18px; margin: 0 0 5px; }
          .header h2 { font-size: 14px; margin: 0; font-weight: normal; border: 1px solid #000; padding: 5px; display: inline-block; }
          .details { margin-bottom: 15px; }
          .details-row { display: flex; margin-bottom: 5px; }
          .details-label { font-weight: bold; width: 45%; }
          .details-value { width: 55%; }
          .separator { border-top: 1px dashed #000; margin: 15px 0; }
          .signature { margin-top: 50px; text-align: right; }
          .signature-line { border-top: 1px solid #000; width: 200px; margin-left: auto; padding-top: 5px; }
          .footer { text-align: center; margin-top: 20px; font-size: 10px; color: #666; }
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
  };

  const formatDate = (date: Date | string) => {
    return format(new Date(date), "dd/MM/yyyy HH:mm");
  };

  if (!sale) return null;

  return (
    <>
      <Dialog open={open && !showPrintReceipt} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogOut className="h-5 w-5" />
              {t("exit")} / निकासी
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm bg-muted/50 p-3 rounded-md">
              <div>
                <span className="text-muted-foreground">{t("saleDate")}:</span>
                <div className="font-medium">{formatDate(sale.soldAt)}</div>
              </div>
              <div>
                <span className="text-muted-foreground">{t("lotNo")}:</span>
                <div className="font-medium">{sale.lotNo}</div>
              </div>
              <div>
                <span className="text-muted-foreground">{t("quantitySold")}:</span>
                <div className="font-medium">{sale.quantitySold} {t("bags")}</div>
              </div>
              <div>
                <span className="text-muted-foreground">{t("bagType")}:</span>
                <div className="font-medium">{sale.bagType === "wafer" ? t("wafer") : t("seed")}</div>
              </div>
              <div>
                <span className="text-muted-foreground">{t("potatoType")}:</span>
                <div className="font-medium">{sale.potatoType}</div>
              </div>
              <div>
                <span className="text-muted-foreground">{t("chamber")}:</span>
                <div className="font-medium">{sale.chamberName}</div>
              </div>
              <div>
                <span className="text-muted-foreground">{t("floor")}:</span>
                <div className="font-medium">{sale.floor}</div>
              </div>
              <div>
                <span className="text-muted-foreground">{t("position")}:</span>
                <div className="font-medium">{sale.position}</div>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">{t("buyerName")}:</span>
                <div className="font-medium">{sale.buyerName || "-"}</div>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span>{t("totalExited")}:</span>
                <span className="font-medium">{totalExited} {t("bags")}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>{t("remainingToExit")}:</span>
                <span className="font-medium text-primary">{remainingToExit} {t("bags")}</span>
              </div>

              {remainingToExit > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="bagsToExit">{t("bagsToExit")} *</Label>
                  <Input
                    id="bagsToExit"
                    type="number"
                    value={bagsToExit}
                    onChange={(e) => setBagsToExit(e.target.value)}
                    min={1}
                    max={remainingToExit}
                    data-testid="input-bags-to-exit"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("maxBagsToExit")}: {remainingToExit}
                  </p>
                </div>
              )}
            </div>

            {exits.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="font-medium mb-2">{t("exitHistory")}</h4>
                  <ScrollArea className="h-32">
                    <div className="space-y-2">
                      {exits.map((exit) => (
                        <div
                          key={exit.id}
                          className="flex items-center justify-between text-sm bg-muted/30 p-2 rounded"
                        >
                          <div>
                            <span className="font-medium">{exit.bagsExited} {t("bags")}</span>
                            <span className="text-muted-foreground ml-2">
                              {formatDate(exit.exitDate)}
                            </span>
                          </div>
                          {exit.isReversed === 1 && (
                            <Badge variant="outline" className="text-destructive">
                              {t("reversed")}
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {exits.some(e => e.isReversed === 0) && (
              <Button
                variant="outline"
                onClick={() => reverseExitMutation.mutate()}
                disabled={reverseExitMutation.isPending}
                className="w-full sm:w-auto"
                data-testid="button-reverse-exit"
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                {t("reverseExit")}
              </Button>
            )}
            <div className="flex gap-2 w-full sm:w-auto">
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="flex-1 sm:flex-initial"
                data-testid="button-cancel-exit"
              >
                {t("cancel")}
              </Button>
              {remainingToExit > 0 && (
                <>
                  <Button
                    variant="outline"
                    onClick={handleSave}
                    disabled={createExitMutation.isPending}
                    className="flex-1 sm:flex-initial"
                    data-testid="button-save-exit"
                  >
                    <Save className="h-4 w-4 mr-1" />
                    {t("save")}
                  </Button>
                  <Button
                    onClick={handleSaveAndPrint}
                    disabled={createExitMutation.isPending}
                    className="flex-1 sm:flex-initial"
                    data-testid="button-save-print-exit"
                  >
                    <Printer className="h-4 w-4 mr-1" />
                    {t("saveAndPrint")}
                  </Button>
                </>
              )}
            </div>
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
            </div>

            <div className="details">
              <div className="details-row">
                <span className="details-label">बिक्री तिथि / Sale Date:</span>
                <span className="details-value">{formatDate(sale.soldAt)}</span>
              </div>
              <div className="details-row">
                <span className="details-label">निकासी तिथि / Exit Date:</span>
                <span className="details-value">{lastExit ? formatDate(lastExit.exitDate) : formatDate(new Date())}</span>
              </div>
              <div className="details-row">
                <span className="details-label">लॉट नंबर / Lot No:</span>
                <span className="details-value">{sale.lotNo}</span>
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
              <div className="details-row">
                <span className="details-label">कुल बेचे / Total Sold:</span>
                <span className="details-value">{sale.quantitySold} बैग / bags</span>
              </div>
              <div className="details-row">
                <span className="details-label">निकासी किए / Exited Now:</span>
                <span className="details-value"><strong>{lastExit?.bagsExited || bagsToExit} बैग / bags</strong></span>
              </div>
              <div className="separator"></div>
              <div className="details-row">
                <span className="details-label">बैग प्रकार / Bag Type:</span>
                <span className="details-value">{sale.bagType === "wafer" ? "वेफर / Wafer" : "बीज / Seed"}</span>
              </div>
              <div className="details-row">
                <span className="details-label">आलू प्रकार / Potato Type:</span>
                <span className="details-value">{sale.potatoType}</span>
              </div>
              <div className="details-row">
                <span className="details-label">कक्ष / Chamber:</span>
                <span className="details-value">{sale.chamberName}</span>
              </div>
              <div className="details-row">
                <span className="details-label">मंजिल / Floor:</span>
                <span className="details-value">{sale.floor}</span>
              </div>
              <div className="details-row">
                <span className="details-label">स्थिति / Position:</span>
                <span className="details-value">{sale.position}</span>
              </div>
            </div>

            <div className="signature">
              <div className="signature-line">
                शीत भंडार प्रबंधक हस्ताक्षर<br/>
                Cold Storage Manager Signature
              </div>
            </div>

            <div className="footer">
              यह कंप्यूटर द्वारा जनित रसीद है / This is a computer generated receipt
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
