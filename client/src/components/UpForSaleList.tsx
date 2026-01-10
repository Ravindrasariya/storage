import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ShoppingCart, Phone, MapPin, Package, Check, Minus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SaleLotInfo } from "@shared/schema";

interface UpForSaleListProps {
  saleLots: SaleLotInfo[];
}

export function UpForSaleList({ saleLots }: UpForSaleListProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [selectedLot, setSelectedLot] = useState<SaleLotInfo | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "due" | "partial">("paid");
  const [saleMode, setSaleMode] = useState<"full" | "partial">("full");
  const [partialQuantity, setPartialQuantity] = useState<number>(0);
  const [partialPrice, setPartialPrice] = useState<number>(0);
  const [buyerName, setBuyerName] = useState<string>("");
  const [pricePerKg, setPricePerKg] = useState<string>("");
  const [customPaidAmount, setCustomPaidAmount] = useState<string>("");

  const finalizeSaleMutation = useMutation({
    mutationFn: async ({ lotId, paymentStatus, buyerName, pricePerKg, paidAmount, dueAmount }: { lotId: string; paymentStatus: "paid" | "due" | "partial"; buyerName?: string; pricePerKg?: number; paidAmount?: number; dueAmount?: number }) => {
      return apiRequest("POST", `/api/lots/${lotId}/finalize-sale`, { paymentStatus, buyerName, pricePerKg, paidAmount, dueAmount });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
      toast({
        title: t("success"),
        description: "Lot marked as sold successfully",
      });
      resetDialog();
    },
    onError: () => {
      toast({
        title: t("error"),
        description: "Failed to mark lot as sold",
        variant: "destructive",
      });
    },
  });

  const partialSaleMutation = useMutation({
    mutationFn: async ({ lotId, quantity, pricePerBag, paymentStatus, buyerName, pricePerKg, paidAmount, dueAmount }: { lotId: string; quantity: number; pricePerBag: number; paymentStatus: "paid" | "due" | "partial"; buyerName?: string; pricePerKg?: number; paidAmount?: number; dueAmount?: number }) => {
      return apiRequest("POST", `/api/lots/${lotId}/partial-sale`, { quantitySold: quantity, pricePerBag, paymentStatus, buyerName, pricePerKg, paidAmount, dueAmount });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lots"] });
      toast({
        title: t("success"),
        description: "Partial sale recorded successfully",
      });
      resetDialog();
    },
    onError: () => {
      toast({
        title: t("error"),
        description: "Failed to record partial sale",
        variant: "destructive",
      });
    },
  });

  const resetDialog = () => {
    setSelectedLot(null);
    setSaleMode("full");
    setPartialQuantity(0);
    setPartialPrice(0);
    setPaymentStatus("paid");
    setBuyerName("");
    setPricePerKg("");
    setCustomPaidAmount("");
  };

  const removeFromSaleMutation = useMutation({
    mutationFn: async (lotId: string) => {
      return apiRequest("PATCH", `/api/lots/${lotId}`, { upForSale: 0 });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lots"] });
      toast({
        title: t("success"),
        description: t("removedFromSale"),
      });
    },
    onError: () => {
      toast({
        title: t("error"),
        description: "Failed to remove from sale",
        variant: "destructive",
      });
    },
  });

  const handleConfirmSale = () => {
    if (selectedLot) {
      const parsedPricePerKg = pricePerKg ? parseFloat(pricePerKg) : undefined;
      const totalCharge = saleMode === "partial" 
        ? partialQuantity * partialPrice 
        : calculateCharge(selectedLot);
      
      let paidAmount: number | undefined;
      let dueAmount: number | undefined;
      
      if (paymentStatus === "paid") {
        paidAmount = totalCharge;
        dueAmount = 0;
      } else if (paymentStatus === "due") {
        paidAmount = 0;
        dueAmount = totalCharge;
      } else if (paymentStatus === "partial") {
        const customPaid = parseFloat(customPaidAmount) || 0;
        paidAmount = Math.min(customPaid, totalCharge);
        dueAmount = totalCharge - paidAmount;
      }
      
      if (saleMode === "partial") {
        partialSaleMutation.mutate({
          lotId: selectedLot.id,
          quantity: partialQuantity,
          pricePerBag: partialPrice,
          paymentStatus,
          buyerName: buyerName || undefined,
          pricePerKg: parsedPricePerKg,
          paidAmount,
          dueAmount,
        });
      } else {
        finalizeSaleMutation.mutate({
          lotId: selectedLot.id,
          paymentStatus,
          buyerName: buyerName || undefined,
          pricePerKg: parsedPricePerKg,
          paidAmount,
          dueAmount,
        });
      }
    }
  };

  const openSaleDialog = (lot: SaleLotInfo, mode: "full" | "partial") => {
    setSelectedLot(lot);
    setSaleMode(mode);
    setPartialQuantity(0);
    setPartialPrice(lot.rate);
  };

  const calculateCharge = (lot: SaleLotInfo) => {
    return lot.rate * lot.remainingSize;
  };

  if (saleLots.length === 0) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <ShoppingCart className="h-5 w-5 text-chart-3" />
          <h3 className="text-lg font-semibold">{t("upForSale") || "Up for Sale"}</h3>
        </div>
        <div className="text-center py-8 text-muted-foreground">
          No lots are currently marked for sale
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <ShoppingCart className="h-5 w-5 text-chart-3" />
          <h3 className="text-lg font-semibold">{t("upForSale") || "Up for Sale"}</h3>
          <Badge variant="secondary" className="ml-auto">{saleLots.length}</Badge>
        </div>
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {saleLots.map((lot) => (
            <div
              key={lot.id}
              className="p-4 rounded-lg border bg-card"
              data-testid={`sale-lot-${lot.id}`}
            >
              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-base" data-testid={`sale-farmer-${lot.id}`}>
                        {lot.farmerName}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {lot.lotNo}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-chart-1 font-bold shrink-0">
                    <Package className="h-4 w-4" />
                    <span data-testid={`sale-size-${lot.id}`}>{lot.remainingSize}</span>
                  </div>
                </div>
                
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Phone className="h-3 w-3 shrink-0" />
                    {lot.contactNumber}
                  </span>
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {lot.village}
                  </span>
                  <span className="text-xs">
                    {lot.chamberName} | {lot.bagType} | {lot.type}
                  </span>
                </div>
                
                <div className="text-sm">
                  <span className="text-muted-foreground">{t("storageCharge")}: </span>
                  <span className="font-medium text-chart-2">
                    Rs. {calculateCharge(lot).toLocaleString()}
                  </span>
                  <span className="text-muted-foreground text-xs ml-1">
                    ({lot.remainingSize} x Rs.{lot.rate})
                  </span>
                </div>
                
                <div className="flex gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openSaleDialog(lot, "partial")}
                    data-testid={`button-partial-${lot.id}`}
                  >
                    <Minus className="h-4 w-4 mr-1" />
                    {t("partialSale")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openSaleDialog(lot, "full")}
                    data-testid={`button-sold-${lot.id}`}
                  >
                    <Check className="h-4 w-4 mr-1" />
                    {t("sold")}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeFromSaleMutation.mutate(lot.id)}
                    disabled={removeFromSaleMutation.isPending}
                    data-testid={`button-remove-sale-${lot.id}`}
                    title={t("removeFromSale")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Dialog open={!!selectedLot} onOpenChange={(open) => !open && resetDialog()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{saleMode === "partial" ? t("partialSale") : t("confirmSale")}</DialogTitle>
            <DialogDescription>
              {selectedLot && `${selectedLot.farmerName} - ${selectedLot.lotNo}`}
            </DialogDescription>
          </DialogHeader>
          
          {selectedLot && saleMode === "full" && (
            <div className="space-y-4 py-4">
              <div className="p-4 rounded-lg bg-muted">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">{t("storageCharge")}:</span>
                  <span className="text-2xl font-bold text-chart-2">
                    Rs. {calculateCharge(selectedLot).toLocaleString()}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  {selectedLot.remainingSize} {t("bags")} x Rs.{selectedLot.rate} per bag
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("buyerName")} <span className="text-muted-foreground text-xs">({t("optional")})</span></Label>
                <Input
                  type="text"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  placeholder={t("buyerName")}
                  data-testid="input-buyer-name"
                />
              </div>

              <div className="space-y-2">
                <Label>{t("pricePerKg")} <span className="text-muted-foreground text-xs">({t("optional")})</span></Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={pricePerKg}
                  onChange={(e) => setPricePerKg(e.target.value)}
                  placeholder={t("pricePerKg")}
                  data-testid="input-price-per-kg"
                />
              </div>

              <div className="space-y-2">
                <Label>{t("paymentStatus")}</Label>
                <RadioGroup
                  value={paymentStatus}
                  onValueChange={(value) => setPaymentStatus(value as "paid" | "due" | "partial")}
                  className="flex flex-wrap gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="paid" id="paid" data-testid="radio-paid" />
                    <Label htmlFor="paid" className="text-green-600 font-medium">
                      {t("paid")}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="due" id="due" data-testid="radio-due" />
                    <Label htmlFor="due" className="text-amber-600 font-medium">
                      {t("due")}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="partial" id="partial" data-testid="radio-partial-payment" />
                    <Label htmlFor="partial" className="text-blue-600 font-medium">
                      {t("partialPayment") || "Partial Payment"}
                    </Label>
                  </div>
                </RadioGroup>
              </div>
              
              {paymentStatus === "partial" && (
                <div className="space-y-3 p-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20">
                  <div className="text-sm text-muted-foreground">
                    {t("total")} {t("storageCharge")}: <span className="font-bold text-foreground">Rs. {calculateCharge(selectedLot).toLocaleString()}</span>
                    <span className="text-xs ml-2">({selectedLot.remainingSize} × Rs.{selectedLot.rate})</span>
                  </div>
                  <div className="space-y-2">
                    <Label>{t("amountPaid") || "Amount Paid"}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={calculateCharge(selectedLot)}
                      value={customPaidAmount}
                      onChange={(e) => setCustomPaidAmount(e.target.value)}
                      placeholder="0"
                      className="text-lg font-medium"
                      data-testid="input-custom-paid-amount"
                    />
                    <p className="text-xs text-muted-foreground">
                      Max: Rs. {calculateCharge(selectedLot).toLocaleString()}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-background text-sm space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-green-600 font-medium">{t("paid")}:</span>
                      <span className="font-bold text-green-600">Rs. {Math.min(parseFloat(customPaidAmount) || 0, calculateCharge(selectedLot)).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-amber-600 font-medium">{t("due")}:</span>
                      <span className="font-bold text-amber-600">Rs. {Math.max(0, calculateCharge(selectedLot) - (parseFloat(customPaidAmount) || 0)).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {selectedLot && saleMode === "partial" && (
            <div className="space-y-4 py-4">
              <div className="p-4 rounded-lg bg-muted text-sm">
                <span className="text-muted-foreground">{t("remaining")}: </span>
                <span className="font-bold">{selectedLot.remainingSize} {t("bags")}</span>
              </div>

              <div className="space-y-2">
                <Label>{t("quantity")}</Label>
                <Input
                  type="number"
                  min={0}
                  max={selectedLot.remainingSize}
                  value={partialQuantity || ""}
                  onChange={(e) => setPartialQuantity(Number(e.target.value))}
                  placeholder={`Max: ${selectedLot.remainingSize}`}
                  data-testid="input-partial-quantity"
                />
              </div>

              <div className="space-y-2">
                <Label>{t("pricePerBag")}</Label>
                <Input
                  type="number"
                  min={0}
                  value={partialPrice || ""}
                  onChange={(e) => setPartialPrice(Number(e.target.value))}
                  data-testid="input-partial-price"
                />
              </div>

              <div className="space-y-2">
                <Label>{t("buyerName")} <span className="text-muted-foreground text-xs">({t("optional")})</span></Label>
                <Input
                  type="text"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  placeholder={t("buyerName")}
                  data-testid="input-partial-buyer-name"
                />
              </div>

              <div className="space-y-2">
                <Label>{t("pricePerKg")} <span className="text-muted-foreground text-xs">({t("optional")})</span></Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={pricePerKg}
                  onChange={(e) => setPricePerKg(e.target.value)}
                  placeholder={t("pricePerKg")}
                  data-testid="input-partial-price-per-kg"
                />
              </div>

              {partialQuantity > 0 && partialPrice > 0 && (
                <div className="p-4 rounded-lg bg-muted">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Total:</span>
                    <span className="text-2xl font-bold text-chart-2">
                      Rs. {(partialQuantity * partialPrice).toLocaleString()}
                    </span>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>{t("paymentStatus")}</Label>
                <RadioGroup
                  value={paymentStatus}
                  onValueChange={(value) => setPaymentStatus(value as "paid" | "due" | "partial")}
                  className="flex flex-wrap gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="paid" id="partial-paid" data-testid="radio-partial-paid" />
                    <Label htmlFor="partial-paid" className="text-green-600 font-medium">
                      {t("paid")}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="due" id="partial-due" data-testid="radio-partial-due" />
                    <Label htmlFor="partial-due" className="text-amber-600 font-medium">
                      {t("due")}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="partial" id="partial-partial" data-testid="radio-partial-partial-payment" />
                    <Label htmlFor="partial-partial" className="text-blue-600 font-medium">
                      {t("partialPayment") || "Partial Payment"}
                    </Label>
                  </div>
                </RadioGroup>
              </div>
              
              {paymentStatus === "partial" && partialQuantity > 0 && partialPrice > 0 && (
                <div className="space-y-3 p-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20">
                  <div className="text-sm text-muted-foreground">
                    {t("total")} {t("storageCharge")}: <span className="font-bold text-foreground">Rs. {(partialQuantity * partialPrice).toLocaleString()}</span>
                    <span className="text-xs ml-2">({partialQuantity} × Rs.{partialPrice})</span>
                  </div>
                  <div className="space-y-2">
                    <Label>{t("amountPaid") || "Amount Paid"}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={partialQuantity * partialPrice}
                      value={customPaidAmount}
                      onChange={(e) => setCustomPaidAmount(e.target.value)}
                      placeholder="0"
                      className="text-lg font-medium"
                      data-testid="input-partial-custom-paid-amount"
                    />
                    <p className="text-xs text-muted-foreground">
                      Max: Rs. {(partialQuantity * partialPrice).toLocaleString()}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-background text-sm space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-green-600 font-medium">{t("paid")}:</span>
                      <span className="font-bold text-green-600">Rs. {Math.min(parseFloat(customPaidAmount) || 0, partialQuantity * partialPrice).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-amber-600 font-medium">{t("due")}:</span>
                      <span className="font-bold text-amber-600">Rs. {Math.max(0, (partialQuantity * partialPrice) - (parseFloat(customPaidAmount) || 0)).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={resetDialog}
              data-testid="button-cancel-sale"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleConfirmSale}
              disabled={
                (saleMode === "full" && finalizeSaleMutation.isPending) ||
                (saleMode === "partial" && (partialSaleMutation.isPending || partialQuantity <= 0 || partialQuantity > (selectedLot?.remainingSize || 0) || partialPrice <= 0))
              }
              data-testid="button-confirm-sale"
            >
              {(finalizeSaleMutation.isPending || partialSaleMutation.isPending) ? t("loading") : t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
