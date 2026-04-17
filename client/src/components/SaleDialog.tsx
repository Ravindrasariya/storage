import { useState, useEffect } from "react";
import { useDropdownNavigation } from "@/hooks/use-dropdown-navigation";
import { useI18n } from "@/lib/i18n";
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

interface SaleDialogProps {
  lot: SaleLotInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SaleDialog({ lot, open, onOpenChange }: SaleDialogProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "due" | "partial">("due");
  const [partialQuantity, setPartialQuantity] = useState<number>(0);
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
  const buyerNav = useDropdownNavigation();
  const [chargeBasis, setChargeBasis] = useState<"actual" | "totalRemaining">("actual");
  const [isSelfBuyer, setIsSelfBuyer] = useState(false);
  const [adjAmount, setAdjAmount] = useState<string>("");

  const { data: buyersData } = useQuery<{ buyerName: string; isSelfSale: boolean }[]>({
    queryKey: ["/api/buyers/lookup"],
  });

  const { data: farmerDuesData } = useQuery<{ pyReceivables: number; freightDue: number; advanceDue: number; selfDue: number; totalDue: number }>({
    queryKey: ["/api/farmer-dues", lot?.farmerLedgerId],
    enabled: !!lot?.farmerLedgerId && open,
  });

  const buyerSuggestions = (() => {
    if (!buyersData || !buyerName.trim()) return [];
    const query = buyerName.toLowerCase();
    return buyersData
      .filter(b => b.buyerName.toLowerCase().includes(query))
      .filter(b => !b.isSelfSale)
      .slice(0, 8);
  })();

  const selectBuyerSuggestion = (buyer: { buyerName: string }) => {
    setBuyerName(buyer.buyerName);
    setShowBuyerSuggestions(false);
  };

  // Initialize / reset form fields whenever dialog opens, closes, or the lot changes
  useEffect(() => {
    if (open && lot) {
      // Full reset on (re)open or when switching to a different lot, then seed lot-derived fields
      setPartialQuantity(0);
      setPaymentStatus("due");
      setPaymentMode("cash");
      setBuyerName("");
      setPricePerKg("");
      setCustomPaidAmount("");
      setKataCharges("");
      setDeliveryType("gate");
      setExtraHammaliPerBag("");
      setTotalGradingCharges("");
      setNetWeight("");
      setIsSelfBuyer(false);
      setAdjAmount("");
      setEditPosition(lot.position);
      setEditableColdCharge(lot.coldCharge.toString());
      setEditableHammali(lot.hammali.toString());
      setChargeBasis(lot.baseColdChargesBilled === 1 ? "actual" : "actual");
    } else if (!open) {
      // Reset all state when closing
      setPartialQuantity(0);
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
      setAdjAmount("");
    }
  }, [open, lot?.id]);

  const partialSaleMutation = useMutation({
    mutationFn: async ({ lotId, quantity, pricePerBag, paymentStatus, paymentMode, buyerName, pricePerKg, paidAmount, dueAmount, position, kataCharges, extraHammali, gradingCharges, netWeight, customColdCharge, customHammali, chargeBasis, isSelfSale, adjReceivableSelfDueAmount }: { lotId: string; quantity: number; pricePerBag: number; paymentStatus: "paid" | "due" | "partial"; paymentMode?: "cash" | "account"; buyerName?: string; pricePerKg?: number; paidAmount?: number; dueAmount?: number; position?: string; kataCharges?: number; extraHammali?: number; gradingCharges?: number; netWeight?: number; customColdCharge?: number; customHammali?: number; chargeBasis?: "actual" | "totalRemaining"; isSelfSale?: boolean; adjReceivableSelfDueAmount?: number }) => {
      return apiRequest("POST", `/api/lots/${lotId}/partial-sale`, { quantitySold: quantity, pricePerBag, paymentStatus, paymentMode, buyerName, pricePerKg, paidAmount, dueAmount, position, kataCharges, extraHammali, gradingCharges, netWeight, customColdCharge, customHammali, chargeBasis, isSelfSale, adjReceivableSelfDueAmount });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("/api/dashboard/stats") });
      queryClient.invalidateQueries({ queryKey: ["/api/lots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lots/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/merchants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/quality"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/chambers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chambers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history/years"] });
      queryClient.invalidateQueries({ queryKey: ["/api/buyers/lookup"] });
      queryClient.invalidateQueries({ queryKey: ["/api/up-for-sale"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts/buyers-with-dues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/farmers-with-dues"] });
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("/api/farmer-receivables-with-dues") });
      queryClient.invalidateQueries({ queryKey: ["/api/buyer-dues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history/by-buyer"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history/buyer-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/farmer-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/farmer-ledger/dues-for-dropdown"] });
      queryClient.invalidateQueries({ queryKey: ["/api/farmer-ledger/dues-for-discount"] });
      queryClient.invalidateQueries({ queryKey: ["/api/buyer-ledger"] });
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("/api/farmer-dues") });
      toast({
        title: t("success"),
        description: "Partial sale recorded successfully",
        variant: "success",
      });
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: t("error"),
        description: "Failed to record partial sale",
        variant: "destructive",
      });
    },
  });

  const getEditableRate = (l: SaleLotInfo) => {
    const parsedColdCharge = parseFloat(editableColdCharge);
    const parsedHammali = parseFloat(editableHammali);
    const coldCharge = Number.isFinite(parsedColdCharge) ? parsedColdCharge : l.coldCharge;
    const hammali = Number.isFinite(parsedHammali) ? parsedHammali : l.hammali;
    return coldCharge + hammali;
  };

  const getEditableColdCharge = (l: SaleLotInfo) => {
    const parsedColdCharge = parseFloat(editableColdCharge);
    return Number.isFinite(parsedColdCharge) ? parsedColdCharge : l.coldCharge;
  };

  const getEditableHammali = (l: SaleLotInfo) => {
    const parsedHammali = parseFloat(editableHammali);
    return Number.isFinite(parsedHammali) ? parsedHammali : l.hammali;
  };

  const getChargeQuantity = (l: SaleLotInfo, actualQty?: number) => {
    if (chargeBasis === "totalRemaining") {
      return l.remainingSize;
    }
    return actualQty ?? l.remainingSize;
  };

  const calculateBaseCharge = (l: SaleLotInfo, quantity?: number, useChargeBasis: boolean = true) => {
    if (l.baseColdChargesBilled === 1) {
      return 0;
    }
    const actualQty = quantity ?? l.remainingSize;
    const chargeQty = useChargeBasis ? getChargeQuantity(l, actualQty) : actualQty;
    const coldChargeRate = getEditableColdCharge(l);
    const hammaliRate = getEditableHammali(l);
    if (l.chargeUnit === "quintal") {
      const coldChargeQuintal = (l.netWeight && l.originalSize > 0) ? (l.netWeight * chargeQty * coldChargeRate) / (l.originalSize * 100) : 0;
      const hammaliPerBag = hammaliRate * chargeQty;
      return coldChargeQuintal + hammaliPerBag;
    }
    return (coldChargeRate + hammaliRate) * chargeQty;
  };

  const calculateTotalCharge = (l: SaleLotInfo, quantity?: number, customRate?: number) => {
    const actualQty = quantity ?? l.remainingSize;
    const chargeQty = getChargeQuantity(l, actualQty);
    const coldChargeRate = getEditableColdCharge(l);
    const hammaliRate = getEditableHammali(l);
    const rate = customRate ?? (coldChargeRate + hammaliRate);
    let baseCharge: number = 0;
    if (l.baseColdChargesBilled !== 1) {
      if (l.chargeUnit === "quintal") {
        if (customRate !== undefined) {
          baseCharge = (l.netWeight && l.originalSize > 0) ? (l.netWeight * chargeQty * rate) / (l.originalSize * 100) : 0;
        } else {
          const coldChargeQuintal = (l.netWeight && l.originalSize > 0) ? (l.netWeight * chargeQty * coldChargeRate) / (l.originalSize * 100) : 0;
          const hammaliPerBag = hammaliRate * chargeQty;
          baseCharge = coldChargeQuintal + hammaliPerBag;
        }
      } else {
        baseCharge = rate * chargeQty;
      }
    }
    const kata = parseFloat(kataCharges) || 0;
    const extraHammali = deliveryType === "bilty" ? (parseFloat(extraHammaliPerBag) || 0) * actualQty : 0;
    const grading = deliveryType === "bilty" ? (parseFloat(totalGradingCharges) || 0) : 0;
    return baseCharge + kata + extraHammali + grading;
  };

  const handleConfirmSale = () => {
    if (!lot) return;
    if (!buyerName.trim()) {
      toast({
        title: t("error"),
        description: "Buyer name is required / खरीदार का नाम आवश्यक है",
        variant: "destructive",
      });
      return;
    }
    if (!partialQuantity || partialQuantity <= 0) {
      toast({
        title: t("error"),
        description: "Quantity must be greater than zero / मात्रा शून्य से अधिक होनी चाहिए",
        variant: "destructive",
      });
      return;
    }

    const parsedPricePerKg = pricePerKg ? parseFloat(pricePerKg) : undefined;
    const actualQty = partialQuantity;
    const parsedColdCharge = parseFloat(editableColdCharge);
    const parsedHammali = parseFloat(editableHammali);
    const customColdCharge = Number.isFinite(parsedColdCharge) ? parsedColdCharge : undefined;
    const customHammali = Number.isFinite(parsedHammali) ? parsedHammali : undefined;
    const editableRate = (customColdCharge ?? lot.coldCharge) + (customHammali ?? lot.hammali);

    const baseChargeTotal = calculateTotalCharge(lot, partialQuantity);
    const adjAmountForSale = (!isSelfBuyer && parseFloat(adjAmount) > 0) ? parseFloat(adjAmount) : 0;
    const totalCharge = baseChargeTotal + adjAmountForSale;

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

    const modeToSend = (paymentStatus === "paid" || paymentStatus === "partial") ? paymentMode : undefined;
    const parsedNetWeight = netWeight ? parseFloat(netWeight) : undefined;
    const effectiveChargeBasis = lot.baseColdChargesBilled === 1 ? "actual" : chargeBasis;

    partialSaleMutation.mutate({
      lotId: lot.id,
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
      chargeBasis: effectiveChargeBasis,
      isSelfSale: isSelfBuyer,
      adjReceivableSelfDueAmount: !isSelfBuyer ? (parseFloat(adjAmount) || 0) : 0,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t("sale")}</DialogTitle>
          <DialogDescription>
            {lot && `${lot.farmerName} - ${lot.lotNo}`}
          </DialogDescription>
        </DialogHeader>

        {lot && (
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-3 gap-3 p-3 rounded-lg bg-muted/50 border">
              <div>
                <Label className="text-xs text-muted-foreground">{t("chamber")}</Label>
                <div className="font-medium">{lot.chamberName}</div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">{t("floor")}</Label>
                <div className="font-medium">{lot.floor}</div>
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
              <div className="text-sm font-medium">{t("rateBreakdown")}</div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("coldStorageCharge")} {lot.chargeUnit === "quintal" ? t("perQuintal") : t("perBag")}</Label>
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
                  <Label className="text-xs text-muted-foreground">{t("hammali")} {t("perBag")}</Label>
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
                <span className="font-bold">
                  {lot.chargeUnit === "quintal" ? (
                    <><Currency amount={getEditableColdCharge(lot)} />{t("perQuintal")} + <Currency amount={getEditableHammali(lot)} />{t("perBag")}</>
                  ) : (
                    <><Currency amount={getEditableRate(lot)} />{t("perBag")}</>
                  )}
                </span>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-muted text-sm space-y-1">
              <div>
                <span className="text-muted-foreground">{t("remaining")}: </span>
                <span className="font-bold">{lot.remainingSize} {t("bags")}</span>
              </div>
              {lot.netWeight && (
                <div>
                  <span className="text-muted-foreground">{t("initialNetWeight")}: </span>
                  <span className="font-bold">{lot.netWeight} {t("kg")}</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>{t("quantity")} <span className="text-destructive">*</span></Label>
                {partialQuantity > lot.remainingSize && (
                  <span className="text-xs text-destructive font-medium">
                    {t("quantityExceedsRemaining")}
                  </span>
                )}
              </div>
              <Input
                type="number"
                min={1}
                max={lot.remainingSize}
                value={partialQuantity || ""}
                onChange={(e) => setPartialQuantity(Number(e.target.value))}
                placeholder={`Max: ${lot.remainingSize}`}
                className={partialQuantity > lot.remainingSize ? "border-destructive" : ""}
                data-testid="input-partial-quantity"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>{t("buyerName")} <span className="text-destructive">*</span></Label>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="self-buyer-partial"
                    checked={isSelfBuyer}
                    onCheckedChange={(checked) => {
                      setIsSelfBuyer(!!checked);
                      if (checked && lot) {
                        const compositeName = `${lot.farmerName} - ${lot.contactNumber} - ${lot.village}`;
                        setBuyerName(compositeName);
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
                  onFocus={() => { setShowBuyerSuggestions(true); buyerNav.resetActive(); }}
                  onBlur={() => setTimeout(() => { setShowBuyerSuggestions(false); buyerNav.resetActive(); }, 200)}
                  onKeyDown={(e) => buyerNav.handleKeyDown(e, buyerSuggestions.length, (i) => { selectBuyerSuggestion(buyerSuggestions[i]); setShowBuyerSuggestions(false); }, () => setShowBuyerSuggestions(false))}
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
                        className={`w-full px-3 py-2 text-left hover-elevate text-sm ${buyerNav.activeIndex === idx ? "bg-accent" : ""}`}
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

            {lot.chargeUnit === "quintal" && (
              <div className="space-y-2">
                <Label>{t("initialNetWeightFromRegister")}</Label>
                <Input
                  type="number"
                  value={lot.netWeight || 0}
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
              <Select
                value={chargeBasis}
                onValueChange={(value: "actual" | "totalRemaining") => setChargeBasis(value)}
                disabled={lot?.baseColdChargesBilled === 1}
              >
                <SelectTrigger
                  data-testid="select-partial-charge-basis"
                  className={lot?.baseColdChargesBilled === 1 ? "bg-muted cursor-not-allowed" : ""}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="actual">{t("actualBags")}</SelectItem>
                  <SelectItem value="totalRemaining">{t("allRemainingBags")}</SelectItem>
                </SelectContent>
              </Select>
              {lot?.baseColdChargesBilled === 1 && (
                <p className="text-xs text-muted-foreground">{t("baseChargesBilledChargeBasisHint") || "Base charges already billed - using actual bags only"}</p>
              )}
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

            {!isSelfBuyer && (
              <div className="space-y-2">
                <Label>{t("adjReceivableSelfDueAmount") || "Adj Receivable & Self Due Amt / बकाया व स्वयं बिक्री समायोजन"}</Label>
                <Input
                  type="number"
                  min={0}
                  max={farmerDuesData ? (farmerDuesData.pyReceivables || 0) + (farmerDuesData.advanceDue || 0) + (farmerDuesData.freightDue || 0) + (farmerDuesData.selfDue || 0) : 0}
                  step="0.01"
                  value={adjAmount}
                  onChange={(e) => {
                    const maxDue = farmerDuesData ? (farmerDuesData.pyReceivables || 0) + (farmerDuesData.advanceDue || 0) + (farmerDuesData.freightDue || 0) + (farmerDuesData.selfDue || 0) : 0;
                    const val = parseFloat(e.target.value);
                    if (maxDue > 0 && val > maxDue) {
                      setAdjAmount(String(maxDue));
                    } else {
                      setAdjAmount(e.target.value);
                    }
                  }}
                  placeholder="0"
                  data-testid="input-adj-receivable-self-due"
                />
                {farmerDuesData && ((farmerDuesData.pyReceivables || 0) + (farmerDuesData.advanceDue || 0) + (farmerDuesData.freightDue || 0) + (farmerDuesData.selfDue || 0)) > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("maxAdjAmount") || "Max"}: <Currency amount={(farmerDuesData.pyReceivables || 0) + (farmerDuesData.advanceDue || 0) + (farmerDuesData.freightDue || 0) + (farmerDuesData.selfDue || 0)} />
                    {farmerDuesData.pyReceivables > 0 && <span> | PY: <Currency amount={farmerDuesData.pyReceivables} /></span>}
                    {farmerDuesData.freightDue > 0 && <span> | Freight: <Currency amount={farmerDuesData.freightDue} /></span>}
                    {farmerDuesData.advanceDue > 0 && <span> | Advance: <Currency amount={farmerDuesData.advanceDue} /></span>}
                    {farmerDuesData.selfDue > 0 && <span> | Self: <Currency amount={farmerDuesData.selfDue} /></span>}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("noFarmerDues") || "No farmer dues found / किसान पर कोई बकाया नहीं"}
                  </p>
                )}
              </div>
            )}

            {partialQuantity > 0 && (
              <div className="p-4 rounded-lg bg-muted">
                {lot.chargeUnit === "quintal" && !lot.netWeight ? (
                  <div className="text-red-600 dark:text-red-400 font-medium text-center py-2">
                    {t("addInitialNetWeightWarning")}
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">{t("total")} {t("storageCharge")}:</span>
                      <span className="text-2xl font-bold text-chart-2">
                        <Currency amount={calculateTotalCharge(lot, partialQuantity) + (!isSelfBuyer ? (parseFloat(adjAmount) || 0) : 0)} />
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground mt-1 space-y-1">
                      {lot.baseColdChargesBilled === 1 ? (
                        <div className="text-teal-600 dark:text-teal-400 font-medium">{t("baseColdChargesBilled")} - <Currency amount={0} /></div>
                      ) : lot.chargeUnit === "quintal" && lot.netWeight ? (
                        <div>
                          ({lot.netWeight} {t("kg")} × {getChargeQuantity(lot, partialQuantity)} × <Currency amount={getEditableColdCharge(lot)} />) / ({lot.originalSize} × 100) + (<Currency amount={getEditableHammali(lot)} /> × {getChargeQuantity(lot, partialQuantity)}) = <Currency amount={calculateBaseCharge(lot, partialQuantity)} />
                        </div>
                      ) : (
                        <div>{getChargeQuantity(lot, partialQuantity)} {t("bags")} x <Currency amount={getEditableRate(lot)} /> = <Currency amount={calculateBaseCharge(lot, partialQuantity)} /></div>
                      )}
                      {chargeBasis === "totalRemaining" && lot.baseColdChargesBilled !== 1 && (
                        <div className="text-xs text-amber-600 dark:text-amber-400">({t("chargeBasis")}: {t("allRemainingBags")} - {lot.remainingSize} {t("bags")})</div>
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
                      {!isSelfBuyer && (parseFloat(adjAmount) || 0) > 0 && (
                        <div>+ {t("adjReceivableSelfDueAmount") || "Adj Receivable & Self Due"}: <Currency amount={parseFloat(adjAmount) || 0} /></div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-sale"
          >
            {t("cancel")}
          </Button>
          <Button
            onClick={handleConfirmSale}
            disabled={
              (lot?.chargeUnit === "quintal" && !lot?.netWeight) ||
              partialSaleMutation.isPending ||
              partialQuantity <= 0 ||
              partialQuantity > (lot?.remainingSize || 0)
            }
            data-testid="button-confirm-sale"
          >
            {partialSaleMutation.isPending ? t("loading") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
