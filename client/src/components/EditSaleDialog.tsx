import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Pencil, Save, X, RotateCcw } from "lucide-react";
import type { SalesHistory } from "@shared/schema";

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

  const totalCharge = sale 
    ? (sale.coldStorageCharge || 0) + (sale.kataCharges || 0) + (sale.extraHammali || 0) + (sale.gradingCharges || 0)
    : 0;

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
            
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-sm text-muted-foreground mb-2">
                {t("currentStatus")}: 
                <Badge 
                  variant={currentStatus === "paid" ? "default" : currentStatus === "partial" ? "secondary" : "destructive"}
                  className={`ml-2 ${currentStatus === "paid" ? "bg-green-600" : ""}`}
                >
                  {t(currentStatus)}
                </Badge>
                {currentStatus === "partial" && (
                  <span className="ml-2 text-xs">
                    ({t("paid")}: Rs. {(sale.paidAmount || 0).toLocaleString()}, {t("due")}: Rs. {(sale.dueAmount || 0).toLocaleString()})
                  </span>
                )}
              </p>
            </div>

            <RadioGroup 
              value={newPaymentStatus} 
              onValueChange={(v) => setNewPaymentStatus(v as "paid" | "due" | "partial")}
              className="space-y-2"
            >
              {currentStatus === "paid" && (
                <>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="paid" id="status-paid" data-testid="radio-status-paid" />
                    <Label htmlFor="status-paid">{t("keepAsPaid")}</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="due" id="status-due" data-testid="radio-status-due" />
                    <Label htmlFor="status-due">{t("markAsDue")}</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="partial" id="status-partial" data-testid="radio-status-partial" />
                    <Label htmlFor="status-partial">{t("markAsPartial")}</Label>
                  </div>
                </>
              )}

              {currentStatus === "due" && (
                <>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="due" id="status-due" data-testid="radio-status-due" />
                    <Label htmlFor="status-due">{t("keepAsDue")}</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="paid" id="status-paid" data-testid="radio-status-paid" />
                    <Label htmlFor="status-paid">{t("markAsPaid")}</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="partial" id="status-partial" data-testid="radio-status-partial" />
                    <Label htmlFor="status-partial">{t("markAsPartial")}</Label>
                  </div>
                </>
              )}

              {currentStatus === "partial" && (
                <>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="partial" id="status-partial" data-testid="radio-status-partial" />
                    <Label htmlFor="status-partial">{t("keepAsPartial")}</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="paid" id="status-paid" data-testid="radio-status-paid" />
                    <Label htmlFor="status-paid">{t("markAsPaid")}</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="due" id="status-due" data-testid="radio-status-due" />
                    <Label htmlFor="status-due">{t("markAsDue")}</Label>
                  </div>
                </>
              )}
            </RadioGroup>

            {newPaymentStatus === "partial" && (
              <div className="space-y-2 pl-6">
                <Label htmlFor="customAmount">{t("paidAmount")}</Label>
                <Input
                  id="customAmount"
                  type="number"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  placeholder="0"
                  max={totalCharge}
                  data-testid="input-partial-amount"
                />
                <p className="text-xs text-muted-foreground">
                  {t("maxAmount")}: Rs. {totalCharge.toLocaleString()}
                </p>
              </div>
            )}

            {(newPaymentStatus === "paid" || newPaymentStatus === "partial") && (
              <div className="space-y-2">
                <Label>{t("paymentMode")}</Label>
                <RadioGroup 
                  value={paymentMode} 
                  onValueChange={(v) => setPaymentMode(v as "cash" | "account")}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="cash" id="mode-cash" data-testid="radio-mode-cash" />
                    <Label htmlFor="mode-cash">{t("cash")}</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="account" id="mode-account" data-testid="radio-mode-account" />
                    <Label htmlFor="mode-account">{t("account")}</Label>
                  </div>
                </RadioGroup>
              </div>
            )}
          </div>
        </div>

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
