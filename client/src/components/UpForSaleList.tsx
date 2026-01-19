import { useState, useMemo } from "react";
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
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ShoppingCart, Phone, MapPin, Package, Check, Minus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SaleLotInfo } from "@shared/schema";
import { capitalizeFirstLetter } from "@/lib/utils";
import { Currency } from "@/components/Currency";

interface UpForSaleListProps {
  saleLots: SaleLotInfo[];
}

export function UpForSaleList({ saleLots }: UpForSaleListProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [selectedLot, setSelectedLot] = useState<SaleLotInfo | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "due" | "partial">("due");
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
  const [paymentMode, setPaymentMode] = useState<"cash" | "account">("cash");
  const [netWeight, setNetWeight] = useState<string>("");
  const [editableColdCharge, setEditableColdCharge] = useState<string>("");
  const [editableHammali, setEditableHammali] = useState<string>("");
  const [showBuyerSuggestions, setShowBuyerSuggestions] = useState(false);
  const [chargeBasis, setChargeBasis] = useState<"actual" | "totalRemaining">("actual");
  const [isSelfBuyer, setIsSelfBuyer] = useState(false);

  const { data: buyersData } = useQuery<{ buyerName: string }[]>({
    queryKey: ["/api/buyers/lookup"],
  });

  const buyerSuggestions = useMemo(() => {
    if (!buyersData || !buyerName.trim()) return [];
    const query = buyerName.toLowerCase();
    return buyersData
      .filter(b => b.buyerName.toLowerCase().includes(query))
      .slice(0, 8);
  }, [buyersData, buyerName]);

  const selectBuyerSuggestion = (buyer: { buyerName: string }) => {
    setBuyerName(buyer.buyerName);
    setShowBuyerSuggestions(false);
  };

  const finalizeSaleMutation = useMutation({
    mutationFn: async ({ lotId, paymentStatus, paymentMode, buyerName, pricePerKg, paidAmount, dueAmount, position, kataCharges, extraHammali, gradingCharges, netWeight, customColdCharge, customHammali }: { lotId: string; paymentStatus: "paid" | "due" | "partial"; paymentMode?: "cash" | "account"; buyerName?: string; pricePerKg?: number; paidAmount?: number; dueAmount?: number; position?: string; kataCharges?: number; extraHammali?: number; gradingCharges?: number; netWeight?: number; customColdCharge?: number; customHammali?: number }) => {
      return apiRequest("POST", `/api/lots/${lotId}/finalize-sale`, { paymentStatus, paymentMode, buyerName, pricePerKg, paidAmount, dueAmount, position, kataCharges, extraHammali, gradingCharges, netWeight, customColdCharge, customHammali });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/merchants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/quality"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/chambers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history/years"] });
      queryClient.invalidateQueries({ queryKey: ["/api/buyers/lookup"] });
      queryClient.invalidateQueries({ queryKey: ["/api/up-for-sale"] });
      toast({
        title: t("success"),
        description: "Lot marked as sold successfully",
        variant: "success",
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
    mutationFn: async ({ lotId, quantity, pricePerBag, paymentStatus, paymentMode, buyerName, pricePerKg, paidAmount, dueAmount, position, kataCharges, extraHammali, gradingCharges, netWeight, customColdCharge, customHammali, chargeBasis }: { lotId: string; quantity: number; pricePerBag: number; paymentStatus: "paid" | "due" | "partial"; paymentMode?: "cash" | "account"; buyerName?: string; pricePerKg?: number; paidAmount?: number; dueAmount?: number; position?: string; kataCharges?: number; extraHammali?: number; gradingCharges?: number; netWeight?: number; customColdCharge?: number; customHammali?: number; chargeBasis?: "actual" | "totalRemaining" }) => {
      return apiRequest("POST", `/api/lots/${lotId}/partial-sale`, { quantitySold: quantity, pricePerBag, paymentStatus, paymentMode, buyerName, pricePerKg, paidAmount, dueAmount, position, kataCharges, extraHammali, gradingCharges, netWeight, customColdCharge, customHammali, chargeBasis });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/merchants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/quality"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/chambers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history/years"] });
      queryClient.invalidateQueries({ queryKey: ["/api/buyers/lookup"] });
      queryClient.invalidateQueries({ queryKey: ["/api/up-for-sale"] });
      toast({
        title: t("success"),
        description: "Partial sale recorded successfully",
        variant: "success",
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
    setPaymentStatus("due");
    setPaymentMode("cash");
    setBuyerName("");
    setPricePerKg("");
    setCustomPaidAmount("");
    setEditPosition("");
    setKataCharges("");
    setDeliveryType("gate");
    setExtraHammaliPerBag("");
    setTotalGradingCharges("");
    setNetWeight("");
    setIsSelfBuyer(false);
    setEditableColdCharge("");
    setEditableHammali("");
    setChargeBasis("actual");
  };

  const openSaleDialog = (lot: SaleLotInfo, mode: "full" | "partial") => {
    setSelectedLot(lot);
    setSaleMode(mode);
    setPartialQuantity(0);
    setPartialPrice(lot.rate);
    setEditPosition(lot.position);
    setEditableColdCharge(lot.coldCharge.toString());
    setEditableHammali(lot.hammali.toString());
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
        variant: "success",
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
      // Validate buyer name is required
      if (!buyerName.trim()) {
        toast({
          title: t("error"),
          description: "Buyer name is required / खरीदार का नाम आवश्यक है",
          variant: "destructive",
        });
        return;
      }
      
      // Validate quantity for partial sales
      if (saleMode === "partial" && (!partialQuantity || partialQuantity <= 0)) {
        toast({
          title: t("error"),
          description: "Quantity must be greater than zero / मात्रा शून्य से अधिक होनी चाहिए",
          variant: "destructive",
        });
        return;
      }
      
      const parsedPricePerKg = pricePerKg ? parseFloat(pricePerKg) : undefined;
      const actualQty = saleMode === "partial" ? partialQuantity : selectedLot.remainingSize;
      // Use charge basis quantity for calculating charges (consistent with calculateTotalCharge)
      const chargeQty = getChargeQuantity(selectedLot, actualQty);
      
      // Parse custom rate components with NaN guard
      const parsedColdCharge = parseFloat(editableColdCharge);
      const parsedHammali = parseFloat(editableHammali);
      const customColdCharge = Number.isFinite(parsedColdCharge) ? parsedColdCharge : undefined;
      const customHammali = Number.isFinite(parsedHammali) ? parsedHammali : undefined;
      const editableRate = (customColdCharge ?? selectedLot.coldCharge) + (customHammali ?? selectedLot.hammali);
      
      const totalCharge = saleMode === "partial" 
        ? calculateTotalCharge(selectedLot, partialQuantity) 
        : calculateTotalCharge(selectedLot);
      
      // Extra hammali and grading always use actual bags being sold (not charge basis)
      const kata = parseFloat(kataCharges) || 0;
      const extraHammaliTotal = deliveryType === "bilty" ? (parseFloat(extraHammaliPerBag) || 0) * actualQty : 0;
      const grading = deliveryType === "bilty" ? (parseFloat(totalGradingCharges) || 0) : 0;
      
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
      
      // Only include paymentMode if payment status is paid or partial
      const modeToSend = (paymentStatus === "paid" || paymentStatus === "partial") ? paymentMode : undefined;
      
      const parsedNetWeight = netWeight ? parseFloat(netWeight) : undefined;
      
      if (saleMode === "partial") {
        partialSaleMutation.mutate({
          lotId: selectedLot.id,
          quantity: partialQuantity,
          pricePerBag: editableRate,
          paymentStatus,
          paymentMode: modeToSend,
          buyerName: buyerName || undefined,
          pricePerKg: parsedPricePerKg,
          paidAmount,
          dueAmount,
          position: editPosition || undefined,
          kataCharges: kata > 0 ? kata : undefined,
          extraHammali: extraHammaliTotal > 0 ? extraHammaliTotal : undefined,
          gradingCharges: grading > 0 ? grading : undefined,
          netWeight: parsedNetWeight,
          customColdCharge,
          customHammali,
          chargeBasis,
        });
      } else {
        finalizeSaleMutation.mutate({
          lotId: selectedLot.id,
          paymentStatus,
          paymentMode: modeToSend,
          buyerName: buyerName || undefined,
          pricePerKg: parsedPricePerKg,
          paidAmount,
          dueAmount,
          position: editPosition || undefined,
          kataCharges: kata > 0 ? kata : undefined,
          extraHammali: extraHammaliTotal > 0 ? extraHammaliTotal : undefined,
          gradingCharges: grading > 0 ? grading : undefined,
          netWeight: parsedNetWeight,
          customColdCharge,
          customHammali,
        });
      }
    }
  };

  const getEditableRate = (lot: SaleLotInfo) => {
    const parsedColdCharge = parseFloat(editableColdCharge);
    const parsedHammali = parseFloat(editableHammali);
    const coldCharge = Number.isFinite(parsedColdCharge) ? parsedColdCharge : lot.coldCharge;
    const hammali = Number.isFinite(parsedHammali) ? parsedHammali : lot.hammali;
    return coldCharge + hammali;
  };

  // Get the quantity to use for charge calculation based on chargeBasis selection
  const getChargeQuantity = (lot: SaleLotInfo, actualQty?: number) => {
    if (chargeBasis === "totalRemaining") {
      return lot.remainingSize;
    }
    return actualQty ?? lot.remainingSize;
  };

  const calculateBaseCharge = (lot: SaleLotInfo, quantity?: number, useChargeBasis: boolean = true) => {
    // Skip base charge if already paid
    if (lot.baseColdChargesBilled === 1) {
      return 0;
    }
    
    const actualQty = quantity ?? lot.remainingSize;
    const chargeQty = useChargeBasis ? getChargeQuantity(lot, actualQty) : actualQty;
    const rate = getEditableRate(lot);
    
    // For quintal mode: (Initial Net Weight (Kg) × Charge Qty × Rate per quintal) / (Original Bags × 100)
    // For bag mode: Charge Qty × Rate
    if (lot.chargeUnit === "quintal" && lot.netWeight && lot.originalSize > 0) {
      return (lot.netWeight * chargeQty * rate) / (lot.originalSize * 100);
    }
    return rate * chargeQty;
  };

  const calculateTotalCharge = (lot: SaleLotInfo, quantity?: number, customRate?: number) => {
    const actualQty = quantity ?? lot.remainingSize;
    const chargeQty = getChargeQuantity(lot, actualQty);
    const rate = customRate ?? getEditableRate(lot);
    
    // Skip base charge if already paid (only extras apply)
    let baseCharge: number = 0;
    if (lot.baseColdChargesBilled !== 1) {
      // For quintal mode: (Initial Net Weight (Kg) × Charge Qty × Rate per quintal) / (Original Bags × 100)
      // For bag mode: Charge Qty × Rate
      if (lot.chargeUnit === "quintal" && lot.netWeight && lot.originalSize > 0) {
        baseCharge = (lot.netWeight * chargeQty * rate) / (lot.originalSize * 100);
      } else {
        baseCharge = rate * chargeQty;
      }
    }
    
    const kata = parseFloat(kataCharges) || 0;
    // Extra hammali and grading always use actual bags being sold (not charge basis)
    const extraHammali = deliveryType === "bilty" ? (parseFloat(extraHammaliPerBag) || 0) * actualQty : 0;
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
                      {lot.baseColdChargesBilled === 1 && (
                        <Badge variant="outline" className="text-xs bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-400" data-testid={`sale-base-charges-paid-${lot.id}`}>
                          {t("baseColdChargesBilled")}
                        </Badge>
                      )}
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
                  {lot.chargeUnit === "quintal" && !lot.netWeight ? (
                    <span className="text-muted-foreground">-</span>
                  ) : (
                    <>
                      <span className="font-medium text-chart-2">
                        <Currency amount={calculateBaseCharge(lot)} />
                      </span>
                      <span className="text-muted-foreground text-xs ml-1">
                        {lot.chargeUnit === "quintal" && lot.netWeight ? (
                          <>({lot.netWeight} {t("kg")} × {lot.remainingSize} × <Currency amount={lot.rate} />) / ({lot.originalSize} × 100)</>
                        ) : (
                          <>({lot.remainingSize} x <Currency amount={lot.rate} />)</>
                        )}
                      </span>
                    </>
                  )}
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
                <div className="text-sm font-medium">{t("rateBreakdown")} ({selectedLot.chargeUnit === "quintal" ? t("perQuintal") : t("perBag")})</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t("coldStorageCharge")}</Label>
                    <div className="flex items-center gap-1">
                      <Currency amount="" showIcon={true} className="text-muted-foreground" />
                      <Input
                        type="number"
                        min={0}
                        value={editableColdCharge}
                        onChange={(e) => setEditableColdCharge(e.target.value)}
                        className="h-8 w-20"
                        data-testid="input-cold-charge"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t("hammali")}</Label>
                    <div className="flex items-center gap-1">
                      <Currency amount="" showIcon={true} className="text-muted-foreground" />
                      <Input
                        type="number"
                        min={0}
                        value={editableHammali}
                        onChange={(e) => setEditableHammali(e.target.value)}
                        className="h-8 w-20"
                        data-testid="input-hammali"
                      />
                    </div>
                  </div>
                </div>
                <div className="border-t pt-2 flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("total")} {t("rate")}:</span>
                  <span className="font-bold"><Currency amount={getEditableRate(selectedLot)} />{selectedLot.chargeUnit === "quintal" ? t("perQuintal") : t("perBag")}</span>
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
                <Label>{t("chargeBasis")}</Label>
                <Select value={chargeBasis} onValueChange={(value: "actual" | "totalRemaining") => setChargeBasis(value)}>
                  <SelectTrigger data-testid="select-charge-basis">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="actual">{t("actualBags")}</SelectItem>
                    <SelectItem value="totalRemaining">{t("allRemainingBags")}</SelectItem>
                  </SelectContent>
                </Select>
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
                    <Currency amount={calculateCharge(selectedLot)} />
                  </span>
                </div>
                <div className="text-sm text-muted-foreground mt-1 space-y-1">
                  {selectedLot.baseColdChargesBilled === 1 ? (
                    <div className="text-teal-600 dark:text-teal-400 font-medium">{t("baseColdChargesBilled")} - <Currency amount={0} /></div>
                  ) : selectedLot.chargeUnit === "quintal" && selectedLot.netWeight ? (
                    <div>
                      ({selectedLot.netWeight} {t("kg")} × {getChargeQuantity(selectedLot, selectedLot.remainingSize)} × <Currency amount={getEditableRate(selectedLot)} />) / ({selectedLot.originalSize} × 100) = <Currency amount={calculateBaseCharge(selectedLot)} />
                    </div>
                  ) : (
                    <div>{getChargeQuantity(selectedLot, selectedLot.remainingSize)} {t("bags")} x <Currency amount={getEditableRate(selectedLot)} /> = <Currency amount={calculateBaseCharge(selectedLot)} /></div>
                  )}
                  {chargeBasis === "totalRemaining" && selectedLot.baseColdChargesBilled !== 1 && (
                    <div className="text-xs text-amber-600 dark:text-amber-400">({t("chargeBasis")}: {t("allRemainingBags")})</div>
                  )}
                  {(parseFloat(kataCharges) || 0) > 0 && (
                    <div>+ {t("kataCharges")}: <Currency amount={parseFloat(kataCharges)} /></div>
                  )}
                  {deliveryType === "bilty" && (parseFloat(extraHammaliPerBag) || 0) > 0 && (
                    <div>+ {t("extraHammaliPerBag")}: <Currency amount={(parseFloat(extraHammaliPerBag) || 0) * selectedLot.remainingSize} /> ({selectedLot.remainingSize} x <Currency amount={parseFloat(extraHammaliPerBag) || 0} />)</div>
                  )}
                  {deliveryType === "bilty" && (parseFloat(totalGradingCharges) || 0) > 0 && (
                    <div>+ {t("totalGradingCharges")}: <Currency amount={parseFloat(totalGradingCharges)} /></div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{t("buyerName")} <span className="text-destructive">*</span></Label>
                  <div className="flex items-center gap-2">
                    <Checkbox 
                      id="self-buyer-full"
                      checked={isSelfBuyer}
                      onCheckedChange={(checked) => {
                        setIsSelfBuyer(!!checked);
                        if (checked && selectedLot) {
                          setBuyerName(selectedLot.farmerName);
                          setShowBuyerSuggestions(false);
                        } else {
                          setBuyerName("");
                        }
                      }}
                      data-testid="checkbox-self-buyer"
                    />
                    <Label htmlFor="self-buyer-full" className="text-sm font-normal cursor-pointer">{t("self")}</Label>
                  </div>
                </div>
                <div className="relative">
                  <Input
                    type="text"
                    value={buyerName}
                    onChange={(e) => {
                      setBuyerName(capitalizeFirstLetter(e.target.value));
                      setShowBuyerSuggestions(true);
                    }}
                    onFocus={() => setShowBuyerSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowBuyerSuggestions(false), 200)}
                    placeholder={t("buyerName")}
                    autoComplete="off"
                    disabled={isSelfBuyer}
                    className={isSelfBuyer ? "bg-muted" : ""}
                    data-testid="input-buyer-name"
                  />
                  {!isSelfBuyer && showBuyerSuggestions && buyerSuggestions.length > 0 && buyerName && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                      {buyerSuggestions.map((buyer, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className="w-full px-3 py-2 text-left hover-elevate text-sm"
                          onClick={() => selectBuyerSuggestion(buyer)}
                          data-testid={`suggestion-buyer-${idx}`}
                        >
                          {buyer.buyerName}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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

              {selectedLot.chargeUnit === "quintal" && selectedLot.netWeight && (
                <div className="space-y-2">
                  <Label>{t("initialNetWeightFromRegister")}</Label>
                  <Input
                    type="number"
                    value={selectedLot.netWeight}
                    disabled
                    className="bg-muted"
                    data-testid="input-initial-net-weight-readonly"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>{t("finalNetWeight")} <span className="text-muted-foreground text-xs">({t("optional")})</span></Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={netWeight}
                  onChange={(e) => setNetWeight(e.target.value)}
                  placeholder={t("netWeightKg")}
                  data-testid="input-net-weight"
                />
              </div>

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
                <div className="text-sm font-medium">{t("rateBreakdown")} ({selectedLot.chargeUnit === "quintal" ? t("perQuintal") : t("perBag")})</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t("coldStorageCharge")}</Label>
                    <div className="flex items-center gap-1">
                      <Currency amount="" showIcon={true} className="text-muted-foreground" />
                      <Input
                        type="number"
                        min={0}
                        value={editableColdCharge}
                        onChange={(e) => setEditableColdCharge(e.target.value)}
                        className="h-8 w-20"
                        data-testid="input-partial-cold-charge"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t("hammali")}</Label>
                    <div className="flex items-center gap-1">
                      <Currency amount="" showIcon={true} className="text-muted-foreground" />
                      <Input
                        type="number"
                        min={0}
                        value={editableHammali}
                        onChange={(e) => setEditableHammali(e.target.value)}
                        className="h-8 w-20"
                        data-testid="input-partial-hammali"
                      />
                    </div>
                  </div>
                </div>
                <div className="border-t pt-2 flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("total")} {t("rate")}:</span>
                  <span className="font-bold"><Currency amount={getEditableRate(selectedLot)} />{selectedLot.chargeUnit === "quintal" ? t("perQuintal") : t("perBag")}</span>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-muted text-sm space-y-1">
                <div>
                  <span className="text-muted-foreground">{t("remaining")}: </span>
                  <span className="font-bold">{selectedLot.remainingSize} {t("bags")}</span>
                </div>
                {selectedLot.netWeight && (
                  <div>
                    <span className="text-muted-foreground">{t("initialNetWeight")}: </span>
                    <span className="font-bold">{selectedLot.netWeight} {t("kg")}</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>{t("quantity")} <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  min={1}
                  max={selectedLot.remainingSize}
                  value={partialQuantity || ""}
                  onChange={(e) => setPartialQuantity(Number(e.target.value))}
                  placeholder={`Max: ${selectedLot.remainingSize}`}
                  data-testid="input-partial-quantity"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{t("buyerName")} <span className="text-destructive">*</span></Label>
                  <div className="flex items-center gap-2">
                    <Checkbox 
                      id="self-buyer-partial"
                      checked={isSelfBuyer}
                      onCheckedChange={(checked) => {
                        setIsSelfBuyer(!!checked);
                        if (checked && selectedLot) {
                          setBuyerName(selectedLot.farmerName);
                          setShowBuyerSuggestions(false);
                        } else {
                          setBuyerName("");
                        }
                      }}
                      data-testid="checkbox-partial-self-buyer"
                    />
                    <Label htmlFor="self-buyer-partial" className="text-sm font-normal cursor-pointer">{t("self")}</Label>
                  </div>
                </div>
                <div className="relative">
                  <Input
                    type="text"
                    value={buyerName}
                    onChange={(e) => {
                      setBuyerName(capitalizeFirstLetter(e.target.value));
                      setShowBuyerSuggestions(true);
                    }}
                    onFocus={() => setShowBuyerSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowBuyerSuggestions(false), 200)}
                    placeholder={t("buyerName")}
                    autoComplete="off"
                    disabled={isSelfBuyer}
                    className={isSelfBuyer ? "bg-muted" : ""}
                    data-testid="input-partial-buyer-name"
                  />
                  {!isSelfBuyer && showBuyerSuggestions && buyerSuggestions.length > 0 && buyerName && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                      {buyerSuggestions.map((buyer, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className="w-full px-3 py-2 text-left hover-elevate text-sm"
                          onClick={() => selectBuyerSuggestion(buyer)}
                          data-testid={`suggestion-partial-buyer-${idx}`}
                        >
                          {buyer.buyerName}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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

              {selectedLot.chargeUnit === "quintal" && selectedLot.netWeight && (
                <div className="space-y-2">
                  <Label>{t("initialNetWeightFromRegister")}</Label>
                  <Input
                    type="number"
                    value={selectedLot.netWeight}
                    disabled
                    className="bg-muted"
                    data-testid="input-partial-initial-net-weight-readonly"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>{t("finalNetWeight")} <span className="text-muted-foreground text-xs">({t("optional")})</span></Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={netWeight}
                  onChange={(e) => setNetWeight(e.target.value)}
                  placeholder={t("netWeightKg")}
                  data-testid="input-partial-net-weight"
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
                <Label>{t("chargeBasis")}</Label>
                <Select value={chargeBasis} onValueChange={(value: "actual" | "totalRemaining") => setChargeBasis(value)}>
                  <SelectTrigger data-testid="select-partial-charge-basis">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="actual">{t("actualBags")}</SelectItem>
                    <SelectItem value="totalRemaining">{t("allRemainingBags")}</SelectItem>
                  </SelectContent>
                </Select>
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
                      <Currency amount={calculateTotalCharge(selectedLot, partialQuantity)} />
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 space-y-1">
                    {selectedLot.baseColdChargesBilled === 1 ? (
                      <div className="text-teal-600 dark:text-teal-400 font-medium">{t("baseColdChargesBilled")} - <Currency amount={0} /></div>
                    ) : selectedLot.chargeUnit === "quintal" && selectedLot.netWeight ? (
                      <div>
                        ({selectedLot.netWeight} {t("kg")} × {getChargeQuantity(selectedLot, partialQuantity)} × <Currency amount={getEditableRate(selectedLot)} />) / ({selectedLot.originalSize} × 100) = <Currency amount={calculateBaseCharge(selectedLot, partialQuantity)} />
                      </div>
                    ) : (
                      <div>{getChargeQuantity(selectedLot, partialQuantity)} {t("bags")} x <Currency amount={getEditableRate(selectedLot)} /> = <Currency amount={calculateBaseCharge(selectedLot, partialQuantity)} /></div>
                    )}
                    {chargeBasis === "totalRemaining" && selectedLot.baseColdChargesBilled !== 1 && (
                      <div className="text-xs text-amber-600 dark:text-amber-400">({t("chargeBasis")}: {t("allRemainingBags")} - {selectedLot.remainingSize} {t("bags")})</div>
                    )}
                    {(parseFloat(kataCharges) || 0) > 0 && (
                      <div>+ {t("kataCharges")}: <Currency amount={parseFloat(kataCharges)} /></div>
                    )}
                    {deliveryType === "bilty" && (parseFloat(extraHammaliPerBag) || 0) > 0 && (
                      <div>+ {t("extraHammaliPerBag")}: <Currency amount={(parseFloat(extraHammaliPerBag) || 0) * partialQuantity} /> ({partialQuantity} x <Currency amount={parseFloat(extraHammaliPerBag) || 0} />)</div>
                    )}
                    {deliveryType === "bilty" && (parseFloat(totalGradingCharges) || 0) > 0 && (
                      <div>+ {t("totalGradingCharges")}: <Currency amount={parseFloat(totalGradingCharges)} /></div>
                    )}
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
