import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Pencil, Save, X, RotateCcw, History } from "lucide-react";
import { format } from "date-fns";
import type { SalesHistory, SaleEditHistory } from "@shared/schema";
import { calculateTotalColdCharges } from "@shared/schema";

interface EditSaleDialogProps {
  sale: SalesHistory | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditSaleDialog({ sale, open, onOpenChange }: EditSaleDialogProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  
  const [buyerName, setBuyerName] = useState("");
  const [pricePerKg, setPricePerKg] = useState("");
  const [netWeight, setNetWeight] = useState("");
  const [newPaymentStatus, setNewPaymentStatus] = useState<"paid" | "due" | "partial">("paid");
  const [customAmount, setCustomAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState<"cash" | "account">("cash");
  const [showReverseConfirm, setShowReverseConfirm] = useState(false);

  const totalCharge = sale ? calculateTotalColdCharges(sale) : 0;

  const { data: editHistory = [] } = useQuery<SaleEditHistory[]>({
    queryKey: ["/api/sales-history", sale?.id, "edit-history"],
    queryFn: async () => {
      if (!sale?.id) return [];
      const response = await fetch(`/api/sales-history/${sale.id}/edit-history`);
      return response.json();
    },
    enabled: !!sale?.id && open,
  });

  const getFieldLabel = (field: string): string => {
    const labels: Record<string, string> = {
      buyerName: t("buyerName"),
      pricePerKg: t("pricePerKg"),
      paymentStatus: t("paymentStatus"),
      paidAmount: t("paidAmount"),
      dueAmount: t("dueAmount"),
      paymentMode: t("paymentMode"),
      netWeight: t("netWeight"),
    };
    return labels[field] || field;
  };

  const formatValue = (field: string, value: string | null): string => {
    if (value === null || value === "") return "-";
    if (field === "paymentStatus") {
      return value === "paid" ? t("paid") : value === "due" ? t("due") : t("partial");
    }
    if (field === "paymentMode") {
      return value === "cash" ? t("cash") : t("account");
    }
    if (field === "paidAmount" || field === "dueAmount" || field === "pricePerKg" || field === "netWeight") {
      return `₹${parseFloat(value).toLocaleString()}`;
    }
    return value;
  };

  useEffect(() => {
    if (sale) {
      setBuyerName(sale.buyerName || "");
      setPricePerKg(sale.pricePerKg ? sale.pricePerKg.toString() : "");
      setNetWeight(sale.netWeight ? sale.netWeight.toString() : "");
      setNewPaymentStatus(sale.paymentStatus as "paid" | "due" | "partial");
      setCustomAmount(sale.paidAmount?.toString() || "0");
      setPaymentMode(sale.paymentMode as "cash" | "account" || "cash");
    }
  }, [sale]);

  const updateMutation = useMutation({
    mutationFn: async (data: {
      buyerName?: string;
      pricePerKg?: number;
      netWeight?: number | null;
      paymentStatus?: "paid" | "due" | "partial";
      paidAmount?: number;
      dueAmount?: number;
      paymentMode?: "cash" | "account";
    }) => {
      const response = await apiRequest("PATCH", `/api/sales-history/${sale!.id}`, data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: t("success"), description: t("saleUpdated") });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history", sale?.id, "edit-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/merchants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-stats"] });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: t("error"), description: t("failedToUpdateSale"), variant: "destructive" });
    },
  });

  const reverseMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/sales-history/${sale!.id}/reverse`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: t("success"), description: t("saleReversed") });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lots/search"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/merchants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/quality"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/chambers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/up-for-sale"] });
      setShowReverseConfirm(false);
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: t("error"), description: t("failedToReverseSale"), variant: "destructive" });
      setShowReverseConfirm(false);
    },
  });

  const handleSave = () => {
    if (!sale) return;

    const updates: Record<string, unknown> = {};

    if (buyerName !== (sale.buyerName || "")) {
      updates.buyerName = buyerName;
    }

    const newPriceKg = pricePerKg ? parseFloat(pricePerKg) : undefined;
    if (newPriceKg !== sale.pricePerKg) {
      updates.pricePerKg = newPriceKg || 0;
    }

    const newNetWeight = netWeight ? parseFloat(netWeight) : null;
    if (newNetWeight !== (sale.netWeight || null)) {
      updates.netWeight = newNetWeight;
    }

    if (newPaymentStatus !== sale.paymentStatus) {
      updates.paymentStatus = newPaymentStatus;
      
      if (newPaymentStatus === "paid") {
        updates.paidAmount = totalCharge;
        updates.dueAmount = 0;
        updates.paymentMode = paymentMode;
      } else if (newPaymentStatus === "due") {
        updates.paidAmount = 0;
        updates.dueAmount = totalCharge;
        updates.paymentMode = undefined;
      } else if (newPaymentStatus === "partial") {
        const paidAmt = parseFloat(customAmount) || 0;
        updates.paidAmount = Math.min(paidAmt, totalCharge);
        updates.dueAmount = totalCharge - (updates.paidAmount as number);
        updates.paymentMode = paymentMode;
      }
    } else if (newPaymentStatus === "partial") {
      const paidAmt = parseFloat(customAmount) || 0;
      const currentPaid = sale.paidAmount || 0;
      if (paidAmt !== currentPaid) {
        updates.paidAmount = Math.min(paidAmt, totalCharge);
        updates.dueAmount = totalCharge - (updates.paidAmount as number);
        updates.paymentMode = paymentMode;
      }
    }

    if (Object.keys(updates).length === 0) {
      toast({ description: t("noChanges") });
      return;
    }

    updateMutation.mutate(updates as Parameters<typeof updateMutation.mutate>[0]);
  };

  if (!sale) return null;

  const currentStatus = sale.paymentStatus as "paid" | "due" | "partial";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5" />
            {t("editSale")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="bg-muted/50 p-4 rounded-lg space-y-3">
            <h4 className="font-medium text-sm text-muted-foreground">{t("saleDetails")}</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">{t("farmerName")}:</span>
                <p className="font-medium">{sale.farmerName}</p>
              </div>
              <div>
                <span className="text-muted-foreground">{t("contactNumber")}:</span>
                <p className="font-medium">{sale.contactNumber}</p>
              </div>
              <div>
                <span className="text-muted-foreground">{t("lotNo")}:</span>
                <p className="font-medium">{sale.lotNo}</p>
              </div>
              <div>
                <span className="text-muted-foreground">{t("chamber")}:</span>
                <p className="font-medium">{sale.chamberName}</p>
              </div>
              <div>
                <span className="text-muted-foreground">{t("potatoType")}:</span>
                <p className="font-medium">{sale.potatoType}</p>
              </div>
              <div>
                <span className="text-muted-foreground">{t("bagType")}:</span>
                <Badge variant="outline">{t(sale.bagType)}</Badge>
              </div>
              <div>
                <span className="text-muted-foreground">{t("quantitySold")}:</span>
                <p className="font-medium">{sale.quantitySold} {t("bags")}</p>
              </div>
              <div>
                <span className="text-muted-foreground">{t("totalColdStorageCharges")}:</span>
                <p className="font-medium">Rs. {totalCharge.toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-medium">{t("editableFields")}</h4>
            
            <div className="space-y-2">
              <Label htmlFor="buyerName">{t("buyerName")}</Label>
              <Input
                id="buyerName"
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                placeholder={t("enterBuyerName")}
                data-testid="input-edit-buyer-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pricePerKg">{t("pricePerKg")} ({t("sellingPrice")})</Label>
              <Input
                id="pricePerKg"
                type="number"
                value={pricePerKg}
                onChange={(e) => setPricePerKg(e.target.value)}
                placeholder="0"
                data-testid="input-edit-price-per-kg"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="netWeight">{t("netWeight")} (kg)</Label>
              <Input
                id="netWeight"
                type="number"
                value={netWeight}
                onChange={(e) => setNetWeight(e.target.value)}
                placeholder={t("optional")}
                data-testid="input-edit-net-weight"
              />
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-medium">{t("paymentStatus")}</h4>
            
            <div className="p-3 bg-muted/30 rounded-lg space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{t("status")}:</span>
                <Badge 
                  variant={currentStatus === "paid" ? "default" : currentStatus === "partial" ? "secondary" : "destructive"}
                  className={currentStatus === "paid" ? "bg-green-600" : ""}
                >
                  {currentStatus === "paid" ? t("paid") : currentStatus === "due" ? t("due") : t("partialPaid")}
                </Badge>
              </div>
              {currentStatus === "partial" && (
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-green-600">{t("paid")}:</span>
                    <span className="font-medium">Rs. {(sale.paidAmount || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-amber-600">{t("remaining")}:</span>
                    <span className="font-medium">Rs. {(sale.dueAmount || 0).toLocaleString()}</span>
                  </div>
                </div>
              )}
              {currentStatus === "due" && (
                <div className="text-sm">
                  <div className="flex justify-between">
                    <span className="text-amber-600">{t("totalDue")}:</span>
                    <span className="font-medium">Rs. {totalCharge.toLocaleString()}</span>
                  </div>
                </div>
              )}
              {currentStatus === "paid" && (
                <div className="text-sm">
                  <div className="flex justify-between">
                    <span className="text-green-600">{t("totalPaid")}:</span>
                    <span className="font-medium">Rs. {totalCharge.toLocaleString()}</span>
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                {t("usePaymentManager")}
              </p>
            </div>
          </div>
        </div>

        {editHistory.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <History className="h-4 w-4" />
              {t("editHistory")}
            </div>
            <ScrollArea className="h-[120px] border rounded-md p-2">
              <div className="space-y-2">
                {editHistory.map((entry) => (
                  <div key={entry.id} className="text-xs border-b pb-2 last:border-b-0">
                    <div className="flex justify-between items-start gap-2">
                      <span className="font-medium">{getFieldLabel(entry.fieldChanged)}</span>
                      <span className="text-muted-foreground">
                        {format(new Date(entry.changedAt), "dd/MM/yyyy HH:mm")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-muted-foreground line-through">
                        {formatValue(entry.fieldChanged, entry.oldValue)}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-green-600 dark:text-green-400">
                        {formatValue(entry.fieldChanged, entry.newValue)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter className="flex flex-col sm:flex-row gap-2">
          <div className="flex gap-2 flex-1">
            <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-edit">
              <X className="h-4 w-4 mr-2" />
              {t("cancel")}
            </Button>
            <Button onClick={handleSave} disabled={updateMutation.isPending} data-testid="button-save-edit">
              <Save className="h-4 w-4 mr-2" />
              {updateMutation.isPending ? t("saving") : t("save")}
            </Button>
          </div>
          <Button 
            variant="destructive" 
            onClick={() => setShowReverseConfirm(true)}
            data-testid="button-reverse-sale"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            {t("reverseSale")}
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={showReverseConfirm} onOpenChange={setShowReverseConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("reverseSaleConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("reverseSaleConfirmMessage")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-reverse">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => reverseMutation.mutate()}
              disabled={reverseMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-reverse"
            >
              {reverseMutation.isPending ? t("reversing") : t("yesReverse")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
