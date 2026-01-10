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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const [editPosition, setEditPosition] = useState<string>("");
  const [kataCharges, setKataCharges] = useState<string>("");
  const [deliveryType, setDeliveryType] = useState<"gate" | "bilty">("gate");
  const [extraHammaliPerBag, setExtraHammaliPerBag] = useState<string>("");
  const [totalGradingCharges, setTotalGradingCharges] = useState<string>("");

  const finalizeSaleMutation = useMutation({
    mutationFn: async ({ lotId, paymentStatus, buyerName, pricePerKg, paidAmount, dueAmount, position }: { lotId: string; paymentStatus: "paid" | "due" | "partial"; buyerName?: string; pricePerKg?: number; paidAmount?: number; dueAmount?: number; position?: string }) => {
      return apiRequest("POST", `/api/lots/${lotId}/finalize-sale`, { paymentStatus, buyerName, pricePerKg, paidAmount, dueAmount, position });
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
    mutationFn: async ({ lotId, quantity, pricePerBag, paymentStatus, buyerName, pricePerKg, paidAmount, dueAmount, position }: { lotId: string; quantity: number; pricePerBag: number; paymentStatus: "paid" | "due" | "partial"; buyerName?: string; pricePerKg?: number; paidAmount?: number; dueAmount?: number; position?: string }) => {
      return apiRequest("POST", `/api/lots/${lotId}/partial-sale`, { quantitySold: quantity, pricePerBag, paymentStatus, buyerName, pricePerKg, paidAmount, dueAmount, position });
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
    setEditPosition("");
    setKataCharges("");
    setDeliveryType("gate");
    setExtraHammaliPerBag("");
    setTotalGradingCharges("");
  };

  const openSaleDialog = (lot: SaleLotInfo, mode: "full" | "partial") => {
    setSelectedLot(lot);
    setSaleMode(mode);
    setPartialQuantity(0);
    setPartialPrice(lot.rate);
    setEditPosition(lot.position);
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
        ? calculateTotalCharge(selectedLot, partialQuantity, selectedLot.rate) 
        : calculateTotalCharge(selectedLot);
      
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
          pricePerBag: selectedLot.rate,
          paymentStatus,
          buyerName: buyerName || undefined,
          pricePerKg: parsedPricePerKg,
          paidAmount,
          dueAmount,
          position: editPosition || undefined,
        });
      } else {
        finalizeSaleMutation.mutate({
          lotId: selectedLot.id,
          paymentStatus,
          buyerName: buyerName || undefined,
          pricePerKg: parsedPricePerKg,
          paidAmount,
          dueAmount,
          position: editPosition || undefined,
        });
      }
    }
  };

  const calculateBaseCharge = (lot: SaleLotInfo, quantity?: number) => {
    const qty = quantity ?? lot.remainingSize;
    return lot.rate * qty;
  };

  const calculateTotalCharge = (lot: SaleLotInfo, quantity?: number, customRate?: number) => {
    const qty = quantity ?? lot.remainingSize;
    const rate = customRate ?? lot.rate;
    const baseCharge = rate * qty;
    const kata = parseFloat(kataCharges) || 0;
    const extraHammali = deliveryType === "bilty" ? (parseFloat(extraHammaliPerBag) || 0) * qty : 0;
    const grading = deliveryType === "bilty" ? (parseFloat(totalGradingCharges) || 0) : 0;
    return baseCharge + kata + extraHammali + grading;
  };

  const calculateCharge = (lot: SaleLotInfo) => {
    return calculateTotalCharge(lot);
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
                        {t("lot")} {lot.lotNo} ({lot.originalSize} {t("bags")})
                      </Badge>
                      <Badge variant="secondary" className="text-xs capitalize">
                        {lot.bagType} | {lot.type} | {lot.quality} | {lot.potatoSize}
                      </Badge>
                    </div>
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
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm p-2 rounded bg-muted/50">
                  <div>
                    <span className="text-muted-foreground text-xs">{t("chamber")}</span>
                    <div className="font-medium">{lot.chamberName}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">{t("floor")}</span>
                    <div className="font-medium">{lot.floor}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">{t("position")}</span>
                    <div className="font-medium">{lot.position || "-"}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">{t("remaining")}</span>
                    <div className="font-medium text-chart-1">{lot.remainingSize} {t("bags")}</div>
                  </div>
                </div>
                
                <div className="text-sm">
                  <span className="text-muted-foreground">{t("storageCharge")}: </span>
                  <span className="font-medium text-chart-2">
                    Rs. {calculateBaseCharge(lot).toLocaleString()}
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
              <div className="grid grid-cols-3 gap-3 p-3 rounded-lg bg-muted/50 border">
                <div>
                  <Label className="text-xs text-muted-foreground">{t("chamber")}</Label>
                  <div className="font-medium">{selectedLot.chamberName}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("floor")}</Label>
                  <div className="font-medium">{selectedLot.floor}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("position")}</Label>
                  <Input
                    type="text"
                    value={editPosition}
                    onChange={(e) => setEditPosition(e.target.value)}
                    className="h-8 mt-0.5"
                    data-testid="input-edit-position"
                  />
                </div>
              </div>

              <div className="p-4 rounded-lg bg-muted/50 border space-y-3">
                <div className="text-sm font-medium">{t("rateBreakdown")} ({t("perBag")})</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("coldStorageCharge")}:</span>
                    <span className="font-medium">Rs. {selectedLot.coldCharge}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("hammali")}:</span>
                    <span className="font-medium">Rs. {selectedLot.hammali}</span>
                  </div>
                </div>
                <div className="border-t pt-2 flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("total")} {t("rate")}:</span>
                  <span className="font-bold">Rs. {selectedLot.rate}{t("perBag")}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("kataCharges")} <span className="text-muted-foreground text-xs">({t("optional")})</span></Label>
                <Input
                  type="number"
                  min={0}
                  value={kataCharges}
                  onChange={(e) => setKataCharges(e.target.value)}
                  placeholder="0"
                  data-testid="input-kata-charges"
                />
              </div>

              <div className="space-y-2">
                <Label>{t("deliveryType")}</Label>
                <Select value={deliveryType} onValueChange={(value: "gate" | "bilty") => setDeliveryType(value)}>
                  <SelectTrigger data-testid="select-delivery-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gate">{t("gateCut")}</SelectItem>
                    <SelectItem value="bilty">{t("biltyCut")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {deliveryType === "bilty" && (
                <div className="space-y-4 p-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/20">
                  <div className="space-y-2">
                    <Label>{t("extraHammaliPerBag")}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={extraHammaliPerBag}
                      onChange={(e) => setExtraHammaliPerBag(e.target.value)}
                      placeholder="0"
                      data-testid="input-extra-hammali"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("totalGradingCharges")}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={totalGradingCharges}
                      onChange={(e) => setTotalGradingCharges(e.target.value)}
                      placeholder="0"
                      data-testid="input-grading-charges"
                    />
                  </div>
                </div>
              )}

              <div className="p-4 rounded-lg bg-muted">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">{t("total")} {t("storageCharge")}:</span>
                  <span className="text-2xl font-bold text-chart-2">
                    Rs. {calculateCharge(selectedLot).toLocaleString()}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground mt-1 space-y-1">
                  <div>{selectedLot.remainingSize} {t("bags")} x Rs.{selectedLot.rate} = Rs. {calculateBaseCharge(selectedLot).toLocaleString()}</div>
                  {(parseFloat(kataCharges) || 0) > 0 && (
                    <div>+ {t("kataCharges")}: Rs. {parseFloat(kataCharges).toLocaleString()}</div>
                  )}
                  {deliveryType === "bilty" && (parseFloat(extraHammaliPerBag) || 0) > 0 && (
                    <div>+ {t("extraHammaliPerBag")}: Rs. {((parseFloat(extraHammaliPerBag) || 0) * selectedLot.remainingSize).toLocaleString()} ({selectedLot.remainingSize} x Rs.{extraHammaliPerBag})</div>
                  )}
                  {deliveryType === "bilty" && (parseFloat(totalGradingCharges) || 0) > 0 && (
                    <div>+ {t("totalGradingCharges")}: Rs. {parseFloat(totalGradingCharges).toLocaleString()}</div>
                  )}
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
              <div className="grid grid-cols-3 gap-3 p-3 rounded-lg bg-muted/50 border">
                <div>
                  <Label className="text-xs text-muted-foreground">{t("chamber")}</Label>
                  <div className="font-medium">{selectedLot.chamberName}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("floor")}</Label>
                  <div className="font-medium">{selectedLot.floor}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("position")}</Label>
                  <Input
                    type="text"
                    value={editPosition}
                    onChange={(e) => setEditPosition(e.target.value)}
                    className="h-8 mt-0.5"
                    data-testid="input-partial-edit-position"
                  />
                </div>
              </div>

              <div className="p-4 rounded-lg bg-muted/50 border space-y-3">
                <div className="text-sm font-medium">{t("rateBreakdown")} ({t("perBag")})</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("coldStorageCharge")}:</span>
                    <span className="font-medium">Rs. {selectedLot.coldCharge}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("hammali")}:</span>
                    <span className="font-medium">Rs. {selectedLot.hammali}</span>
                  </div>
                </div>
                <div className="border-t pt-2 flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("total")} {t("rate")}:</span>
                  <span className="font-bold">Rs. {selectedLot.rate}/{t("bag")}</span>
                </div>
              </div>

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

              <div className="space-y-2">
                <Label>{t("kataCharges")} <span className="text-muted-foreground text-xs">({t("optional")})</span></Label>
                <Input
                  type="number"
                  min={0}
                  value={kataCharges}
                  onChange={(e) => setKataCharges(e.target.value)}
                  placeholder="0"
                  data-testid="input-partial-kata-charges"
                />
              </div>

              <div className="space-y-2">
                <Label>{t("deliveryType")}</Label>
                <Select value={deliveryType} onValueChange={(value: "gate" | "bilty") => setDeliveryType(value)}>
                  <SelectTrigger data-testid="select-partial-delivery-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gate">{t("gateCut")}</SelectItem>
                    <SelectItem value="bilty">{t("biltyCut")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {deliveryType === "bilty" && (
                <div className="space-y-4 p-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/20">
                  <div className="space-y-2">
                    <Label>{t("extraHammaliPerBag")}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={extraHammaliPerBag}
                      onChange={(e) => setExtraHammaliPerBag(e.target.value)}
                      placeholder="0"
                      data-testid="input-partial-extra-hammali"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("totalGradingCharges")}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={totalGradingCharges}
                      onChange={(e) => setTotalGradingCharges(e.target.value)}
                      placeholder="0"
                      data-testid="input-partial-grading-charges"
                    />
                  </div>
                </div>
              )}

              {partialQuantity > 0 && (
                <div className="p-4 rounded-lg bg-muted">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">{t("total")} {t("storageCharge")}:</span>
                    <span className="text-2xl font-bold text-chart-2">
                      Rs. {calculateTotalCharge(selectedLot, partialQuantity, selectedLot.rate).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 space-y-1">
                    <div>{partialQuantity} {t("bags")} x Rs.{selectedLot.rate} = Rs. {(partialQuantity * selectedLot.rate).toLocaleString()}</div>
                    {(parseFloat(kataCharges) || 0) > 0 && (
                      <div>+ {t("kataCharges")}: Rs. {parseFloat(kataCharges).toLocaleString()}</div>
                    )}
                    {deliveryType === "bilty" && (parseFloat(extraHammaliPerBag) || 0) > 0 && (
                      <div>+ {t("extraHammaliPerBag")}: Rs. {((parseFloat(extraHammaliPerBag) || 0) * partialQuantity).toLocaleString()} ({partialQuantity} x Rs.{extraHammaliPerBag})</div>
                    )}
                    {deliveryType === "bilty" && (parseFloat(totalGradingCharges) || 0) > 0 && (
                      <div>+ {t("totalGradingCharges")}: Rs. {parseFloat(totalGradingCharges).toLocaleString()}</div>
                    )}
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
              
              {paymentStatus === "partial" && partialQuantity > 0 && (
                <div className="space-y-3 p-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20">
                  <div className="text-sm text-muted-foreground">
                    {t("total")} {t("storageCharge")}: <span className="font-bold text-foreground">Rs. {calculateTotalCharge(selectedLot, partialQuantity, selectedLot.rate).toLocaleString()}</span>
                  </div>
                  <div className="space-y-2">
                    <Label>{t("amountPaid") || "Amount Paid"}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={calculateTotalCharge(selectedLot, partialQuantity, selectedLot.rate)}
                      value={customPaidAmount}
                      onChange={(e) => setCustomPaidAmount(e.target.value)}
                      placeholder="0"
                      className="text-lg font-medium"
                      data-testid="input-partial-custom-paid-amount"
                    />
                    <p className="text-xs text-muted-foreground">
                      Max: Rs. {calculateTotalCharge(selectedLot, partialQuantity, selectedLot.rate).toLocaleString()}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-background text-sm space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-green-600 font-medium">{t("paid")}:</span>
                      <span className="font-bold text-green-600">Rs. {Math.min(parseFloat(customPaidAmount) || 0, calculateTotalCharge(selectedLot, partialQuantity, selectedLot.rate)).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-amber-600 font-medium">{t("due")}:</span>
                      <span className="font-bold text-amber-600">Rs. {Math.max(0, calculateTotalCharge(selectedLot, partialQuantity, selectedLot.rate) - (parseFloat(customPaidAmount) || 0)).toLocaleString()}</span>
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
                (saleMode === "partial" && (partialSaleMutation.isPending || partialQuantity <= 0 || partialQuantity > (selectedLot?.remainingSize || 0)))
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
