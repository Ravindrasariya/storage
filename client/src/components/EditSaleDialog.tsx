import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, authFetch, invalidateSaleSideEffects } from "@/lib/queryClient";
import { Pencil, Save, X, RotateCcw, History, ChevronDown, ChevronUp, Check } from "lucide-react";
import { format } from "date-fns";
import type { SalesHistory, SaleEditHistory } from "@shared/schema";
import { capitalizeFirstLetter } from "@/lib/utils";
import { Currency, formatCurrency } from "@/components/Currency";

// Sibling sales returned by /api/sales-history/cs-bill-batch — same
// SalesHistory shape (lotNo is the human-facing receipt # the operator
// recognises, mirrored from the row).
type CsBillSibling = SalesHistory;

interface EditSaleDialogProps {
  sale: SalesHistory | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditSaleDialog({ sale, open, onOpenChange }: EditSaleDialogProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { coldStorage } = useAuth();
  
  const [buyerName, setBuyerName] = useState("");
  const [pricePerKg, setPricePerKg] = useState("");
  const [netWeight, setNetWeight] = useState("");
  const [newPaymentStatus, setNewPaymentStatus] = useState<"paid" | "due" | "partial">("paid");
  const [customAmount, setCustomAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState<"cash" | "account">("cash");
  const [showReverseConfirm, setShowReverseConfirm] = useState(false);
  const [showLaterSaleExistsError, setShowLaterSaleExistsError] = useState(false);
  const [chargesOpen, setChargesOpen] = useState(false);
  
  const [editColdCharge, setEditColdCharge] = useState("");
  const [editHammali, setEditHammali] = useState("");
  const [editKataCharges, setEditKataCharges] = useState("");
  const [editExtraHammali, setEditExtraHammali] = useState("");
  const [editGradingCharges, setEditGradingCharges] = useState("");
  // Sub-fields for Extra Due to Merchant (sum = extraDueToMerchant)
  const [editExtraDueHammaliMerchant, setEditExtraDueHammaliMerchant] = useState("");
  const [editExtraDueGradingMerchant, setEditExtraDueGradingMerchant] = useState("");
  const [editExtraDueOtherMerchant, setEditExtraDueOtherMerchant] = useState("");
  const [editAdjAmount, setEditAdjAmount] = useState("");

  // CS Bill # / Sale Date inline editor — surfaces a pencil that flips
  // the read-only display row into a pair of inputs. For sales that share
  // a CS bill # with siblings (Master Nikasi batches), the save cascades
  // to every sibling; single-row sales cascade to themselves only.
  const [csBillEditing, setCsBillEditing] = useState(false);
  const [csBillInput, setCsBillInput] = useState("");
  const [csBillDateInput, setCsBillDateInput] = useState("");

  // Get charge unit from sale record (recorded at time of sale) with fallback to cold storage
  // This ensures edits use the same calculation method as the original sale
  const chargeUnit = sale?.chargeUnitAtSale || coldStorage?.chargeUnit || "bag";
  const isQuintalBased = chargeUnit === "quintal";
  
  // Use stored values from sale record (recorded at time of sale)
  const storedChargeBasis = (sale?.chargeBasis as "actual" | "totalRemaining") || "actual";
  const storedInitialNetWeightKg = sale?.initialNetWeightKg || sale?.netWeight || null;
  const baseChargesWereBilled = (sale?.baseChargeAmountAtSale ?? -1) === 0; // If 0, base charges were already billed

  const getEditableChargeValue = (value: string, fallback: number) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  // Calculate base cold storage charge using stored chargeBasis and exact formulas
  const calculateBaseCharge = () => {
    if (!sale) return 0;
    // If base charges were already billed, return 0 regardless of rate edits
    if (baseChargesWereBilled) return 0;
    
    const coldCharge = getEditableChargeValue(editColdCharge, sale.coldCharge || 0);
    const hammali = getEditableChargeValue(editHammali, sale.hammali || 0);
    
    const initialNetWeight = storedInitialNetWeightKg || 0;
    const actualBags = sale.quantitySold || 0;
    const originalBags = sale.originalLotSize || 1; // Avoid division by zero
    
    // Remaining bags at time of sale (stored when sale was recorded)
    // Falls back to originalLotSize for legacy records
    const remainingBags = sale.remainingSizeAtSale || sale.originalLotSize || 0;
    const bagsToUse = storedChargeBasis === "totalRemaining" ? remainingBags : actualBags;
    
    if (isQuintalBased) {
      // Quintal-based formulas: cold charge (per quintal) + hammali (per bag)
      const coldChargeQuintal = (initialNetWeight * bagsToUse * coldCharge) / (100 * originalBags);
      const hammaliPerBag = hammali * bagsToUse;
      return coldChargeQuintal + hammaliPerBag;
    } else {
      // Bag-based formulas: (coldCharge + hammali) × bagsToUse
      return bagsToUse * (coldCharge + hammali);
    }
  };

  const calculateEditableTotal = () => {
    if (!sale) return 0;
    const baseCharge = calculateBaseCharge();
    const kata = getEditableChargeValue(editKataCharges, sale.kataCharges || 0);
    // extraHammali is now stored as per-bag rate in state, multiply by quantitySold for total
    const extraHammaliPerBag = getEditableChargeValue(editExtraHammali, 0);
    const extraHammaliTotal = extraHammaliPerBag * (sale.quantitySold || 0);
    const grading = getEditableChargeValue(editGradingCharges, sale.gradingCharges || 0);
    
    return baseCharge + kata + extraHammaliTotal + grading;
  };
  
  // Get the calculated base charge for display
  const baseCharge = calculateBaseCharge();

  const isNonSelfSale = !sale?.isSelfSale || sale?.isSelfSale === 0;
  
  const chargesWithoutAdj = calculateEditableTotal();
  const adjAmountValue = isNonSelfSale ? (parseFloat(editAdjAmount) || 0) : 0;
  const totalCharge = chargesWithoutAdj + adjAmountValue;

  const { data: editHistory = [] } = useQuery<SaleEditHistory[]>({
    queryKey: ["/api/sales-history", sale?.id, "edit-history"],
    queryFn: async () => {
      if (!sale?.id) return [];
      const response = await authFetch(`/api/sales-history/${sale.id}/edit-history`);
      return response.json();
    },
    enabled: !!sale?.id && open,
  });

  // Fetch sibling sales sharing this CS bill # within the sale's year so
  // the operator sees up front how many rows the cascade will touch. We
  // only query when the sale already has a CS bill # — for first-time
  // assignments there are no siblings to resolve.
  // Reversed sales are hard-deleted from sales_history, so any sale we
  // see here is by definition active — no isReversed guard needed.
  const csBillBatchEnabled =
    !!sale?.coldStorageBillNumber && !!sale?.saleYear && open;
  const { data: csBillSiblings = [] } = useQuery<CsBillSibling[]>({
    queryKey: [
      "/api/sales-history/cs-bill-batch",
      sale?.coldStorageBillNumber,
      sale?.saleYear,
    ],
    queryFn: async () => {
      if (!sale?.coldStorageBillNumber || !sale?.saleYear) return [];
      const response = await authFetch(
        `/api/sales-history/cs-bill-batch?billNumber=${sale.coldStorageBillNumber}&year=${sale.saleYear}`,
      );
      if (!response.ok) return [];
      return response.json();
    },
    enabled: csBillBatchEnabled,
  });

  // Get discount allocated to this specific sale (tracked directly on salesHistory)
  const discountAllocated = sale?.discountAllocated || 0;
  // Actual cash paid = paidAmount - discountAllocated
  const actualCashPaid = Math.max(0, (sale?.paidAmount || 0) - discountAllocated);

  const getFieldLabel = (field: string): string => {
    const labels: Record<string, string> = {
      buyerName: t("buyerName"),
      pricePerKg: t("pricePerKg"),
      paymentStatus: t("paymentStatus"),
      paidAmount: t("paidAmount"),
      dueAmount: t("dueAmount"),
      paymentMode: t("paymentMode"),
      netWeight: t("netWeight"),
      coldCharge: t("coldStorageCharge"),
      hammali: t("hammali"),
      kataCharges: t("kataCharges"),
      extraHammali: t("extraHammaliPerBag"),
      gradingCharges: t("totalGradingCharges"),
      coldStorageCharge: t("totalColdStorageCharges"),
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
    if (field === "paidAmount" || field === "dueAmount" || field === "pricePerKg" || field === "netWeight" ||
        field === "coldCharge" || field === "hammali" || field === "kataCharges" || 
        field === "extraHammali" || field === "gradingCharges" || field === "coldStorageCharge") {
      return `₹${formatCurrency(parseFloat(value))}`;
    }
    return value;
  };

  // Reset form state when dialog opens or sale changes
  // This ensures unsaved changes are discarded when reopening the dialog
  useEffect(() => {
    if (sale && open) {
      setBuyerName(sale.buyerName || "");
      setPricePerKg(sale.pricePerKg ? sale.pricePerKg.toString() : "");
      setNetWeight(sale.netWeight ? sale.netWeight.toString() : "");
      setNewPaymentStatus(sale.paymentStatus as "paid" | "due" | "partial");
      setCustomAmount(sale.paidAmount?.toString() || "0");
      setPaymentMode(sale.paymentMode as "cash" | "account" || "cash");
      setEditColdCharge(sale.coldCharge?.toString() || "0");
      setEditHammali(sale.hammali?.toString() || "0");
      setEditKataCharges(sale.kataCharges?.toString() || "0");
      // Convert total extraHammali to per-bag rate for consistency with sales entry
      const perBagExtraHammali = sale.quantitySold && sale.quantitySold > 0 
        ? (sale.extraHammali || 0) / sale.quantitySold 
        : 0;
      setEditExtraHammali(perBagExtraHammali.toString());
      setEditGradingCharges(sale.gradingCharges?.toString() || "0");
      // Load sub-fields for extraDueToMerchant (legacy records will have 0s)
      setEditExtraDueHammaliMerchant(sale.extraDueHammaliMerchant?.toString() || "0");
      setEditExtraDueGradingMerchant(sale.extraDueGradingMerchant?.toString() || "0");
      setEditExtraDueOtherMerchant(sale.extraDueOtherMerchant?.toString() || "0");
      setEditAdjAmount(sale.adjReceivableSelfDueAmount?.toString() || "0");
      setChargesOpen(false);

      // Reset CS bill # / date editor; pre-fill inputs with current values
      // so a cascade save without a manual edit is a no-op (skipped).
      setCsBillEditing(false);
      setCsBillInput(sale.coldStorageBillNumber != null ? String(sale.coldStorageBillNumber) : "");
      // soldAt is an ISO string from the API; format to YYYY-MM-DD in IST
      // to match the input[type=date] expectation and avoid TZ drift.
      const soldAtDate = sale.soldAt ? new Date(sale.soldAt) : null;
      setCsBillDateInput(
        soldAtDate
          ? new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Kolkata",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(soldAtDate)
          : "",
      );
    }
  }, [sale, open]);
  
  const { data: farmerDuesForEdit } = useQuery<{ pyReceivables: number; freightDue: number; advanceDue: number; selfDue: number; totalDue: number }>({
    queryKey: ["/api/farmer-dues", sale?.farmerLedgerId],
    enabled: !!sale?.farmerLedgerId && isNonSelfSale && open,
  });
  
  const maxAdjAmount = farmerDuesForEdit 
    ? (farmerDuesForEdit.pyReceivables || 0) + (farmerDuesForEdit.advanceDue || 0) + (farmerDuesForEdit.freightDue || 0) + (farmerDuesForEdit.selfDue || 0) + (sale?.adjReceivableSelfDueAmount || 0)
    : 0;

  // Cascade-update CS Bill # / sale date for the current sale and every
  // sibling sharing the same (bill #, year). Invoked from handleSave
  // BEFORE the per-sale PATCH so we can short-circuit the entire save if
  // the cascade fails (e.g. duplicate bill #).
  const updateCsBillMutation = useMutation({
    mutationFn: async (vars: {
      oldBillNumber: number | null;
      oldYear: number;
      newBillNumber?: number;
      newSoldAt?: string;
      saleId: string;
    }) => {
      const billPath = vars.oldBillNumber == null ? "none" : String(vars.oldBillNumber);
      const yearQuery = vars.oldBillNumber == null ? "" : `?year=${vars.oldYear}`;
      const body: Record<string, unknown> = { saleId: vars.saleId };
      if (vars.newBillNumber !== undefined) body.newBillNumber = vars.newBillNumber;
      if (vars.newSoldAt !== undefined) body.newSoldAt = vars.newSoldAt;
      const response = await apiRequest(
        "PATCH",
        `/api/sales-history/cs-bill/${billPath}${yearQuery}`,
        body,
      );
      return response.json();
    },
    onSuccess: () => {
      // Cascade touches every sibling sale row sharing the bill # — fan
      // out invalidations to every sale-aware view so the UI matches.
      invalidateSaleSideEffects(queryClient);
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history/cs-bill-batch"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: {
      buyerName?: string;
      pricePerKg?: number;
      netWeight?: number | null;
      paymentStatus?: "paid" | "due" | "partial";
      paidAmount?: number;
      dueAmount?: number;
      paymentMode?: "cash" | "account";
      coldCharge?: number;
      hammali?: number;
      kataCharges?: number;
      extraHammali?: number;
      gradingCharges?: number;
      coldStorageCharge?: number;
      chargeBasis?: "actual" | "totalRemaining";
      extraDueToMerchant?: number;
      extraDueHammaliMerchant?: number;
      extraDueGradingMerchant?: number;
      extraDueOtherMerchant?: number;
      adjReceivableSelfDueAmount?: number;
    }) => {
      const response = await apiRequest("PATCH", `/api/sales-history/${sale!.id}`, data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: t("success"), description: t("saleUpdated"), variant: "success" });
      invalidateSaleSideEffects(queryClient);
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history", sale?.id, "edit-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/merchants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/quality"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/chambers"] });
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("/api/dashboard/stats") });
      queryClient.invalidateQueries({ queryKey: ["/api/buyers/lookup"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts/buyers-with-dues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/farmer-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/farmer-ledger/dues-for-dropdown"] });
      queryClient.invalidateQueries({ queryKey: ["/api/farmer-ledger/dues-for-discount"] });
      queryClient.invalidateQueries({ queryKey: ["/api/buyer-ledger"] });
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("/api/farmer-dues") });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: t("error"), description: t("failedToUpdateSale"), variant: "destructive" });
    },
  });

  const reverseMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/sales-history/${sale!.id}/reverse`);
      const data = await response.json();
      if (!response.ok) {
        throw data;
      }
      return data;
    },
    onSuccess: () => {
      toast({ title: t("success"), description: t("saleReversed"), variant: "success" });
      invalidateSaleSideEffects(queryClient);
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lots/sales-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lots/search"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/merchants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/quality"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/chambers"] });
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("/api/dashboard/stats") });
      queryClient.invalidateQueries({ queryKey: ["/api/up-for-sale"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts/buyers-with-dues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/farmer-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/farmer-ledger/dues-for-dropdown"] });
      queryClient.invalidateQueries({ queryKey: ["/api/farmer-ledger/dues-for-discount"] });
      queryClient.invalidateQueries({ queryKey: ["/api/buyer-ledger"] });
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("/api/farmer-dues") });
      setShowReverseConfirm(false);
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      setShowReverseConfirm(false);
      const errorMessage = error instanceof Error ? error.message : "";
      if (errorMessage === "LATER_SALE_EXISTS") {
        setShowLaterSaleExistsError(true);
      } else {
        toast({ title: t("error"), description: t("failedToReverseSale"), variant: "destructive" });
      }
    },
  });

  const handleSave = async () => {
    if (!sale) return;

    // CS Bill # / Sale Date cascade dirty-check — independent of the
    // inline editor's open/closed state. The operator may have edited the
    // values, hit the inline confirm (which collapses the inline row), and
    // then clicked the bottom Save; we still need to apply those edits.
    // We always re-derive dirty-ness by comparing the input state to the
    // sale's current values.
    const trimmedBill = csBillInput.trim();
    const parsedBill = trimmedBill === "" ? NaN : parseInt(trimmedBill, 10);
    const billChanged = trimmedBill !== "" && parsedBill !== sale.coldStorageBillNumber;
    const dateInIst = sale.soldAt
      ? new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Kolkata",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(sale.soldAt))
      : "";
    const dateChanged = csBillDateInput !== "" && csBillDateInput !== dateInIst;

    let csBillApplied = false;
    if (billChanged || dateChanged) {
      // Cascade runs FIRST so a duplicate-bill or bad-date error blocks
      // the rest of the save — partial updates would be confusing and
      // hard to undo.
      if (trimmedBill !== "" && (!Number.isFinite(parsedBill) || parsedBill <= 0)) {
        toast({ title: t("error"), description: t("csBillNumberInvalid"), variant: "destructive" });
        return;
      }
      if (csBillDateInput !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(csBillDateInput)) {
        toast({ title: t("error"), description: t("csBillDateInvalid"), variant: "destructive" });
        return;
      }

      try {
        await updateCsBillMutation.mutateAsync({
          oldBillNumber: sale.coldStorageBillNumber ?? null,
          oldYear: sale.saleYear ?? new Date(sale.soldAt).getFullYear(),
          newBillNumber: billChanged ? parsedBill : undefined,
          newSoldAt: dateChanged ? csBillDateInput : undefined,
          saleId: sale.id,
        });
        csBillApplied = true;
        // Cache invalidation runs in the mutation's onSuccess handler.
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t("failedToUpdateSale");
        toast({ title: t("error"), description: message, variant: "destructive" });
        return; // Abort the rest of the save.
      }
    }

    const updates: Record<string, unknown> = {};

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

    const newColdCharge = getEditableChargeValue(editColdCharge, sale.coldCharge || 0);
    if (newColdCharge !== (sale.coldCharge || 0)) {
      updates.coldCharge = newColdCharge;
    }

    const newHammali = getEditableChargeValue(editHammali, sale.hammali || 0);
    if (newHammali !== (sale.hammali || 0)) {
      updates.hammali = newHammali;
    }

    const newKataCharges = getEditableChargeValue(editKataCharges, sale.kataCharges || 0);
    if (newKataCharges !== (sale.kataCharges || 0)) {
      updates.kataCharges = newKataCharges;
    }

    // extraHammali in state is per-bag rate, convert to total for API
    const newExtraHammaliPerBag = getEditableChargeValue(editExtraHammali, 0);
    const newExtraHammaliTotal = newExtraHammaliPerBag * (sale.quantitySold || 0);
    if (Math.abs(newExtraHammaliTotal - (sale.extraHammali || 0)) > 0.01) {
      updates.extraHammali = newExtraHammaliTotal;
    }

    const newGradingCharges = getEditableChargeValue(editGradingCharges, sale.gradingCharges || 0);
    if (newGradingCharges !== (sale.gradingCharges || 0)) {
      updates.gradingCharges = newGradingCharges;
    }

    // Compute extraDueToMerchant as sum of sub-fields
    const newHammaliMerchant = getEditableChargeValue(editExtraDueHammaliMerchant, 0);
    const newGradingMerchant = getEditableChargeValue(editExtraDueGradingMerchant, 0);
    const newOtherMerchant = getEditableChargeValue(editExtraDueOtherMerchant, 0);
    const newExtraDueToMerchant = newHammaliMerchant + newGradingMerchant + newOtherMerchant;
    
    // Always send sub-fields and computed total if any changed
    const oldHammaliMerchant = sale.extraDueHammaliMerchant || 0;
    const oldGradingMerchant = sale.extraDueGradingMerchant || 0;
    const oldOtherMerchant = sale.extraDueOtherMerchant || 0;
    if (Math.abs(newHammaliMerchant - oldHammaliMerchant) > 0.01 ||
        Math.abs(newGradingMerchant - oldGradingMerchant) > 0.01 ||
        Math.abs(newOtherMerchant - oldOtherMerchant) > 0.01) {
      updates.extraDueHammaliMerchant = newHammaliMerchant;
      updates.extraDueGradingMerchant = newGradingMerchant;
      updates.extraDueOtherMerchant = newOtherMerchant;
      updates.extraDueToMerchant = newExtraDueToMerchant;
    }

    // Check if adj amount changed (non-self sales only)
    if (isNonSelfSale) {
      const newAdj = parseFloat(editAdjAmount) || 0;
      const oldAdj = sale.adjReceivableSelfDueAmount || 0;
      if (Math.abs(newAdj - oldAdj) > 0.01) {
        updates.adjReceivableSelfDueAmount = newAdj;
      }
    }

    // Trigger recalculation if any charge-related field changed or if calculated total differs from stored value
    const originalTotal = sale.coldStorageCharge || 0;
    const chargeFieldsChanged = Object.keys(updates).some(key => 
      ['coldCharge', 'hammali', 'kataCharges', 'extraHammali', 'gradingCharges', 'netWeight', 'adjReceivableSelfDueAmount'].includes(key)
    ) || Math.abs(totalCharge - originalTotal) > 0.01;
    
    if (chargeFieldsChanged) {
      updates.coldStorageCharge = totalCharge;
      // Recalculate dueAmount based on new total
      const currentPaid = sale.paidAmount || 0;
      updates.dueAmount = Math.max(0, totalCharge - currentPaid);
      updates.paidAmount = Math.min(currentPaid, totalCharge);
      // Update payment status based on new amounts
      if (updates.dueAmount === 0 && totalCharge > 0) {
        updates.paymentStatus = "paid";
      } else if (updates.paidAmount === 0) {
        updates.paymentStatus = "due";
      } else {
        updates.paymentStatus = "partial";
      }
    }

    if (Object.keys(updates).length === 0) {
      // CS-only edit: the cascade already succeeded above, so this is a
      // genuine save (not a no-op). Surface the success toast and close
      // the dialog the same way per-sale updateMutation.onSuccess does.
      if (csBillApplied) {
        toast({ title: t("success"), description: t("csBillUpdated"), variant: "success" });
        onOpenChange(false);
        return;
      }
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

            {/* CS Bill # / Sale Date inline editor — read-only with a pencil
                that flips into a pair of inputs. Reversed sales are hard-
                deleted from sales_history, so any sale we see is active. */}
            <div className="border-b pb-3">
              {!csBillEditing ? (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div>
                      <span className="text-muted-foreground">{t("csBillNumber")}:</span>{" "}
                      <span className="font-medium" data-testid="text-cs-bill-number">
                        {sale.coldStorageBillNumber ?? "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t("saleDate")}:</span>{" "}
                      <span className="font-medium" data-testid="text-cs-bill-date">
                        {sale.soldAt
                          ? format(new Date(sale.soldAt), "dd/MM/yyyy")
                          : "—"}
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => setCsBillEditing(true)}
                    title={t("editCsBill")}
                    aria-label={t("editCsBill")}
                    data-testid="button-edit-cs-bill"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="cs-bill-number-input" className="text-xs">
                        {t("csBillNumber")}
                      </Label>
                      <Input
                        id="cs-bill-number-input"
                        type="number"
                        min={1}
                        step={1}
                        value={csBillInput}
                        onChange={(e) => setCsBillInput(e.target.value)}
                        className="h-8"
                        data-testid="input-edit-cs-bill-number"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="cs-bill-date-input" className="text-xs">
                        {t("saleDate")}
                      </Label>
                      <Input
                        id="cs-bill-date-input"
                        type="date"
                        value={csBillDateInput}
                        onChange={(e) => setCsBillDateInput(e.target.value)}
                        className="h-8"
                        data-testid="input-edit-cs-bill-date"
                      />
                    </div>
                  </div>
                  {csBillSiblings.length >= 2 && (
                    <div
                      className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5"
                      data-testid="text-cs-bill-cascade-warning"
                    >
                      <p>
                        {t("csBillCoversNSales").replace(
                          "{n}",
                          String(csBillSiblings.length),
                        )}
                      </p>
                      <p
                        className="font-medium"
                        data-testid="text-cs-bill-cascade-receipts"
                      >
                        {csBillSiblings
                          .map((sibling) => `#${sibling.lotNo}`)
                          .join(", ")}
                      </p>
                    </div>
                  )}
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => {
                        setCsBillEditing(false);
                        setCsBillInput(
                          sale.coldStorageBillNumber != null
                            ? String(sale.coldStorageBillNumber)
                            : "",
                        );
                        setCsBillDateInput(
                          sale.soldAt
                            ? new Intl.DateTimeFormat("en-CA", {
                                timeZone: "Asia/Kolkata",
                                year: "numeric",
                                month: "2-digit",
                                day: "2-digit",
                              }).format(new Date(sale.soldAt))
                            : "",
                        );
                      }}
                      data-testid="button-cancel-cs-bill-edit"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => setCsBillEditing(false)}
                      title={t("save")}
                      data-testid="button-confirm-cs-bill-edit"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>

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
                <span className="text-muted-foreground">{t("originalBags")}:</span>
                <p className="font-medium">{sale.originalLotSize} {t("bags")}</p>
              </div>
              <div>
                <span className="text-muted-foreground">{t("quantitySold")}:</span>
                <p className="font-medium">{sale.quantitySold} {t("bags")}</p>
              </div>
              {isQuintalBased && sale.netWeight && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">{t("initialNetWeight")}:</span>
                  <p className="font-medium">{sale.netWeight} kg</p>
                </div>
              )}
              <div className="col-span-2">
                <span className="text-muted-foreground">{t("buyerName")}:</span>
                <p className="font-medium">{sale.isSelfSale === 1 ? t("self") : (sale.buyerName || "-")}</p>
              </div>
            </div>
          </div>

          <Collapsible open={chargesOpen} onOpenChange={setChargesOpen}>
            <div className="border rounded-lg">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-between p-3 h-auto hover-elevate">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{t("totalColdStorageCharges")}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-chart-2"><Currency amount={totalCharge} /></span>
                    {chargesOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="p-3 pt-0 space-y-3 border-t">
                  <p className="text-xs text-muted-foreground">{t("editChargesHint") || "Click to expand and edit individual charges"}</p>
                  
                  {baseChargesWereBilled && (
                    <div className="bg-amber-100 dark:bg-amber-900/30 p-2 rounded-md">
                      <Badge variant="outline" className="text-amber-700 dark:text-amber-300 border-amber-500">
                        {t("baseColdChargesBilled") || "Base Cold Charges Already Billed"}
                      </Badge>
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                        {t("baseColdChargesBilledHint") || "Base charges were billed in a previous sale. Only extras can be edited."}
                      </p>
                    </div>
                  )}
                  
                  <div className="grid grid-cols-2 gap-3 text-sm bg-muted/30 p-2 rounded-md">
                    <div>
                      <span className="text-xs text-muted-foreground">{t("chargeBasis")}:</span>
                      <p className="font-medium">
                        {storedChargeBasis === "totalRemaining" ? t("allRemainingBags") : t("actualBags")}
                        <span className="text-muted-foreground ml-1">
                          ({storedChargeBasis === "totalRemaining" ? (sale.remainingSizeAtSale || sale.originalLotSize) : sale.quantitySold} {t("bags")})
                        </span>
                      </p>
                    </div>
                    {isQuintalBased && storedInitialNetWeightKg && (
                      <div>
                        <span className="text-xs text-muted-foreground">{t("initialNetWeight")}:</span>
                        <p className="font-medium">{storedInitialNetWeightKg} kg</p>
                      </div>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t("coldStorageCharge")}/{isQuintalBased ? t("quintal") : t("bag")}</Label>
                      <div className="flex items-center gap-1">
                        <Currency amount="" showIcon={true} className="text-xs text-muted-foreground" />
                        <Input
                          type="number"
                          min={0}
                          value={editColdCharge}
                          onChange={(e) => setEditColdCharge(e.target.value)}
                          className="h-8"
                          disabled={baseChargesWereBilled}
                          data-testid="input-edit-cold-charge"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("hammali")}/{t("bag")}</Label>
                      <div className="flex items-center gap-1">
                        <Currency amount="" showIcon={true} className="text-xs text-muted-foreground" />
                        <Input
                          type="number"
                          min={0}
                          value={editHammali}
                          onChange={(e) => setEditHammali(e.target.value)}
                          className="h-8"
                          disabled={baseChargesWereBilled}
                          data-testid="input-edit-hammali"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("kataCharges")}</Label>
                      <div className="flex items-center gap-1">
                        <Currency amount="" showIcon={true} className="text-xs text-muted-foreground" />
                        <Input
                          type="number"
                          min={0}
                          value={editKataCharges}
                          onChange={(e) => setEditKataCharges(e.target.value)}
                          className="h-8"
                          data-testid="input-edit-kata-charges"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("extraHammaliPerBag")}</Label>
                      <div className="flex items-center gap-1">
                        <Currency amount="" showIcon={true} className="text-xs text-muted-foreground" />
                        <Input
                          type="number"
                          min={0}
                          value={editExtraHammali}
                          onChange={(e) => setEditExtraHammali(e.target.value)}
                          className="h-8"
                          data-testid="input-edit-extra-hammali"
                        />
                      </div>
                    </div>
                    <div className="space-y-1 col-span-2">
                      <Label className="text-xs">{t("totalGradingCharges")}</Label>
                      <div className="flex items-center gap-1">
                        <Currency amount="" showIcon={true} className="text-xs text-muted-foreground" />
                        <Input
                          type="number"
                          min={0}
                          value={editGradingCharges}
                          onChange={(e) => setEditGradingCharges(e.target.value)}
                          className="h-8"
                          data-testid="input-edit-grading-charges"
                        />
                      </div>
                    </div>
                  </div>
                  
                  {/* Extra Due to Merchant - separate from cold charges, charged to original buyer */}
                  <div className="pt-3 border-t mt-3">
                    <Label className="text-xs font-medium">{t("extraDueToMerchant")}</Label>
                    <p className="text-xs text-muted-foreground mb-2">{t("extraDueToMerchantHint")}</p>
                    
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">{t("hammaliToMerchant")}</Label>
                        <div className="flex items-center gap-1">
                          <Currency amount="" showIcon={true} className="text-xs text-muted-foreground" />
                          <Input
                            type="number"
                            min={0}
                            value={editExtraDueHammaliMerchant}
                            onChange={(e) => setEditExtraDueHammaliMerchant(e.target.value)}
                            className="h-8"
                            data-testid="input-edit-extra-due-hammali-merchant"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{t("gradingToMerchant")}</Label>
                        <div className="flex items-center gap-1">
                          <Currency amount="" showIcon={true} className="text-xs text-muted-foreground" />
                          <Input
                            type="number"
                            min={0}
                            value={editExtraDueGradingMerchant}
                            onChange={(e) => setEditExtraDueGradingMerchant(e.target.value)}
                            className="h-8"
                            data-testid="input-edit-extra-due-grading-merchant"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{t("otherExtra")}</Label>
                        <div className="flex items-center gap-1">
                          <Currency amount="" showIcon={true} className="text-xs text-muted-foreground" />
                          <Input
                            type="number"
                            min={0}
                            value={editExtraDueOtherMerchant}
                            onChange={(e) => setEditExtraDueOtherMerchant(e.target.value)}
                            className="h-8"
                            data-testid="input-edit-extra-due-other-merchant"
                          />
                        </div>
                      </div>
                    </div>
                    
                    {/* Read-only total */}
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{t("total")}:</span>
                      <Currency 
                        amount={
                          getEditableChargeValue(editExtraDueHammaliMerchant, 0) +
                          getEditableChargeValue(editExtraDueGradingMerchant, 0) +
                          getEditableChargeValue(editExtraDueOtherMerchant, 0)
                        } 
                        className="font-medium"
                      />
                    </div>
                  </div>

                  {isNonSelfSale && (
                    <div className="space-y-2">
                      <Label className="text-xs">{t("adjReceivableSelfDueAmount") || "Adj Receivable & Self Due"}</Label>
                      <Input
                        type="number"
                        min={0}
                        max={maxAdjAmount || undefined}
                        step="0.01"
                        value={editAdjAmount}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (maxAdjAmount > 0 && val > maxAdjAmount) {
                            setEditAdjAmount(String(maxAdjAmount));
                          } else {
                            setEditAdjAmount(e.target.value);
                          }
                        }}
                        className="h-8"
                        data-testid="input-edit-adj-receivable-self-due"
                      />
                      {maxAdjAmount > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          {t("maxAdjAmount") || "Max"}: <Currency amount={maxAdjAmount} />
                          {farmerDuesForEdit && farmerDuesForEdit.pyReceivables > 0 && <span> | PY: <Currency amount={farmerDuesForEdit.pyReceivables} /></span>}
                          {farmerDuesForEdit && farmerDuesForEdit.freightDue > 0 && <span> | Freight: <Currency amount={farmerDuesForEdit.freightDue} /></span>}
                          {farmerDuesForEdit && farmerDuesForEdit.advanceDue > 0 && <span> | Advance: <Currency amount={farmerDuesForEdit.advanceDue} /></span>}
                          {farmerDuesForEdit && farmerDuesForEdit.selfDue > 0 && <span> | Self: <Currency amount={farmerDuesForEdit.selfDue} /></span>}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {t("noFarmerDues") || "No farmer dues found / किसान पर कोई बकाया नहीं"}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground pt-2 border-t">
                    {baseChargesWereBilled ? (
                      <div className="flex justify-between">
                        <span>{t("baseCharges")}</span>
                        <span>= <Currency amount={0} /> ({t("alreadyBilled")})</span>
                      </div>
                    ) : (
                      <div className="flex justify-between flex-wrap gap-1">
                        <span>{t("baseCharges")}</span>
                        <span>= <Currency amount={baseCharge} /></span>
                      </div>
                    )}
                    {(() => {
                      const kataVal = getEditableChargeValue(editKataCharges, 0);
                      const extraHammaliPerBag = getEditableChargeValue(editExtraHammali, 0);
                      const extraHammaliTotal = extraHammaliPerBag * (sale.quantitySold || 0);
                      const gradingVal = getEditableChargeValue(editGradingCharges, 0);
                      const surchargesTotal = kataVal + extraHammaliTotal + gradingVal;
                      return surchargesTotal > 0 ? (
                        <div className="flex justify-between">
                          <span>+ {t("surcharges")}</span>
                          <span>= <Currency amount={surchargesTotal} /></span>
                        </div>
                      ) : null;
                    })()}
                  </div>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>

          <div className="space-y-4">
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
              <Label htmlFor="netWeight">{t("finalNetWeight")} (kg)</Label>
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
                    <span className="font-medium"><Currency amount={actualCashPaid} /></span>
                  </div>
                  {discountAllocated > 0 && (
                    <div className="flex justify-between">
                      <span className="text-blue-600">{t("discount")}:</span>
                      <span className="font-medium"><Currency amount={discountAllocated} /></span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-amber-600">{t("remaining")}:</span>
                    <span className="font-medium"><Currency amount={sale.dueAmount || 0} /></span>
                  </div>
                </div>
              )}
              {currentStatus === "due" && (
                <div className="text-sm space-y-1">
                  {discountAllocated > 0 && (
                    <div className="flex justify-between">
                      <span className="text-blue-600">{t("discount")}:</span>
                      <span className="font-medium"><Currency amount={discountAllocated} /></span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-amber-600">{t("totalDue")}:</span>
                    <span className="font-medium"><Currency amount={sale.dueAmount || 0} /></span>
                  </div>
                </div>
              )}
              {currentStatus === "paid" && (
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-green-600">{t("totalPaid")}:</span>
                    <span className="font-medium"><Currency amount={actualCashPaid} /></span>
                  </div>
                  {discountAllocated > 0 && (
                    <div className="flex justify-between">
                      <span className="text-blue-600">{t("discount")}:</span>
                      <span className="font-medium"><Currency amount={discountAllocated} /></span>
                    </div>
                  )}
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

      <AlertDialog open={showLaterSaleExistsError} onOpenChange={setShowLaterSaleExistsError}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("laterSaleExistsTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("laterSaleExistsMessage")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction 
              onClick={() => setShowLaterSaleExistsError(false)}
              data-testid="button-ok-later-sale-exists"
            >
              {t("ok")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
