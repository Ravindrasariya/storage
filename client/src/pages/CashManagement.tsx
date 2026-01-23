import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, authFetch } from "@/lib/queryClient";
import { Banknote, CreditCard, Calendar, Save, ArrowDownLeft, ArrowUpRight, Wallet, Building2, Filter, X, RotateCcw, ArrowLeftRight, Settings, Plus, Trash2, Download } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import type { CashReceipt, Expense, CashTransfer, CashOpeningBalance, OpeningReceivable, SalesHistory, PaymentStats, Discount } from "@shared/schema";

const CASH_MGMT_STATE_KEY_PREFIX = "cashManagementFormState";
const STATE_EXPIRY_MS = 30000; // 30 seconds

// Helper to display bag type with proper capitalization
function formatBagType(bagType: string): string {
  const lower = bagType.toLowerCase();
  if (lower === "wafer") return "Wafer";
  if (lower === "seed") return "Seed";
  if (lower === "ration") return "Ration";
  return bagType; // fallback to original value
}

interface PersistedFormState {
  timestamp: number;
  activeTab: "inward" | "expense" | "self";
  payerType: string;
  buyerName: string;
  customBuyerName: string;
  salesGoodsBuyerName: string;
  receiptType: string;
  accountType: string;
  inwardAmount: string;
  receivedDate: string;
  inwardRemarks: string;
  expenseType: string;
  expenseReceiverName: string;
  expensePaymentMode: string;
  expenseAccountType: string;
  expenseAmount: string;
  expenseDate: string;
  expenseRemarks: string;
  transferFromAccount: string;
  transferToAccount: string;
  transferAmount: string;
  transferDate: string;
  transferRemarks: string;
  transferTypeMode: "internal" | "buyer";
  buyerTransferFrom: string;
  buyerTransferTo: string;
  selectedSaleId: string;
  buyerTransferAmount: string;
  buyerTransferDate: string;
  buyerTransferRemarks: string;
}

function getStateKey(coldStorageId: string): string {
  return `${CASH_MGMT_STATE_KEY_PREFIX}:${coldStorageId}`;
}

function loadPersistedState(coldStorageId: string): Partial<PersistedFormState> | null {
  try {
    const stored = sessionStorage.getItem(getStateKey(coldStorageId));
    if (!stored) return null;
    const parsed: PersistedFormState = JSON.parse(stored);
    const now = Date.now();
    if (now - parsed.timestamp > STATE_EXPIRY_MS) {
      sessionStorage.removeItem(getStateKey(coldStorageId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearPersistedState(coldStorageId: string): void {
  sessionStorage.removeItem(getStateKey(coldStorageId));
}

interface BuyerWithDue {
  buyerName: string;
  totalDue: number;
}

type TransactionItem = 
  | { type: "inflow"; data: CashReceipt; timestamp: number }
  | { type: "outflow"; data: Expense; timestamp: number }
  | { type: "transfer"; data: CashTransfer; timestamp: number }
  | { type: "buyerTransfer"; data: SalesHistory; timestamp: number }
  | { type: "discount"; data: Discount; timestamp: number };

export default function CashManagement() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { canEdit, coldStorage } = useAuth();
  const coldStorageId = coldStorage?.id || "";
  
  // Load persisted state once on mount (scoped to coldStorageId)
  const [initialLoadResult] = useState<{ state: Partial<PersistedFormState> | null; wasLoaded: boolean }>(() => {
    if (coldStorageId) {
      const state = loadPersistedState(coldStorageId);
      return { state, wasLoaded: true };
    }
    return { state: null, wasLoaded: false };
  });
  const persistedState = initialLoadResult.state;
  
  // Track if persisted state has been loaded (either on mount or async)
  const [hasLoadedPersistedState, setHasLoadedPersistedState] = useState(initialLoadResult.wasLoaded);
  const todayDate = format(new Date(), "yyyy-MM-dd");
  
  const [activeTab, setActiveTab] = useState<"inward" | "expense" | "self">(persistedState?.activeTab || "inward");
  
  const [payerType, setPayerType] = useState<"cold_merchant" | "sales_goods" | "kata" | "others">((persistedState?.payerType as "cold_merchant" | "sales_goods" | "kata" | "others") || "cold_merchant");
  const [buyerName, setBuyerName] = useState(persistedState?.buyerName || "");
  const [customBuyerName, setCustomBuyerName] = useState(persistedState?.customBuyerName || "");
  const [salesGoodsBuyerName, setSalesGoodsBuyerName] = useState(persistedState?.salesGoodsBuyerName || "");
  const [receiptType, setReceiptType] = useState<"cash" | "account">((persistedState?.receiptType as "cash" | "account") || "cash");
  const [accountType, setAccountType] = useState<"limit" | "current">((persistedState?.accountType as "limit" | "current") || "limit");
  const [inwardAmount, setInwardAmount] = useState(persistedState?.inwardAmount || "");
  const [receivedDate, setReceivedDate] = useState(persistedState?.receivedDate || todayDate);
  const [inwardRemarks, setInwardRemarks] = useState(persistedState?.inwardRemarks || "");

  const [expenseType, setExpenseType] = useState<string>(persistedState?.expenseType || "");
  const [expenseReceiverName, setExpenseReceiverName] = useState(persistedState?.expenseReceiverName || "");
  const [showReceiverSuggestions, setShowReceiverSuggestions] = useState(false);
  const [expensePaymentMode, setExpensePaymentMode] = useState<"cash" | "account" | "discount">((persistedState?.expensePaymentMode as "cash" | "account" | "discount") || "cash");
  const [expenseAccountType, setExpenseAccountType] = useState<"limit" | "current">((persistedState?.expenseAccountType as "limit" | "current") || "limit");
  const [expenseAmount, setExpenseAmount] = useState(persistedState?.expenseAmount || "");
  const [expenseDate, setExpenseDate] = useState(persistedState?.expenseDate || todayDate);
  const [expenseRemarks, setExpenseRemarks] = useState(persistedState?.expenseRemarks || "");
  
  // Discount state
  const [discountFarmerKey, setDiscountFarmerKey] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountDate, setDiscountDate] = useState(todayDate);
  const [discountRemarks, setDiscountRemarks] = useState("");
  const [discountBuyerAllocations, setDiscountBuyerAllocations] = useState<{ buyerName: string; amount: string; maxAmount: number }[]>([]);

  const [transferFromAccount, setTransferFromAccount] = useState<"cash" | "limit" | "current">((persistedState?.transferFromAccount as "cash" | "limit" | "current") || "cash");
  const [transferToAccount, setTransferToAccount] = useState<"cash" | "limit" | "current">((persistedState?.transferToAccount as "cash" | "limit" | "current") || "limit");
  const [transferAmount, setTransferAmount] = useState(persistedState?.transferAmount || "");
  const [transferDate, setTransferDate] = useState(persistedState?.transferDate || todayDate);
  const [transferRemarks, setTransferRemarks] = useState(persistedState?.transferRemarks || "");
  
  // Buyer-to-buyer transfer state
  const [transferTypeMode, setTransferTypeMode] = useState<"internal" | "buyer">(persistedState?.transferTypeMode || "internal");
  const [buyerTransferFrom, setBuyerTransferFrom] = useState(persistedState?.buyerTransferFrom || "");
  const [buyerTransferTo, setBuyerTransferTo] = useState(persistedState?.buyerTransferTo || "");
  const [selectedSaleId, setSelectedSaleId] = useState(persistedState?.selectedSaleId || "");
  const [buyerTransferAmount, setBuyerTransferAmount] = useState(persistedState?.buyerTransferAmount || "");
  const [buyerTransferDate, setBuyerTransferDate] = useState(persistedState?.buyerTransferDate || todayDate);
  const [buyerTransferRemarks, setBuyerTransferRemarks] = useState(persistedState?.buyerTransferRemarks || "");
  const [showBuyerFromSuggestions, setShowBuyerFromSuggestions] = useState(false);
  const [showBuyerToSuggestions, setShowBuyerToSuggestions] = useState(false);

  const [filterTransactionType, setFilterTransactionType] = useState<"all" | "inward" | "expense" | "self" | "buyerTransfer">("all");
  const [filterPaymentMode, setFilterPaymentMode] = useState<string>("");
  const [filterPayerType, setFilterPayerType] = useState<string>("");
  const [filterBuyer, setFilterBuyer] = useState<string>("");
  const [filterBuyerSearch, setFilterBuyerSearch] = useState<string>("");
  const [filterExpenseType, setFilterExpenseType] = useState<string>("");
  const [filterRemarks, setFilterRemarks] = useState<string>("");
  const [filterMonth, setFilterMonth] = useState<string>("");
  const [filterYear, setFilterYear] = useState<string>("");
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionItem | null>(null);

  // Settings dialog state
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"balances" | "receivables">("balances");
  const currentYear = new Date().getFullYear();
  const [settingsYear, setSettingsYear] = useState(currentYear);
  
  // Opening balance form state
  const [openingCashInHand, setOpeningCashInHand] = useState("");
  const [openingLimitBalance, setOpeningLimitBalance] = useState("");
  const [openingCurrentBalance, setOpeningCurrentBalance] = useState("");
  
  // Receivable form state
  const [newReceivablePayerType, setNewReceivablePayerType] = useState<string>("cold_merchant");
  const [newReceivableBuyerName, setNewReceivableBuyerName] = useState("");
  const [newReceivableAmount, setNewReceivableAmount] = useState("");
  const [newReceivableRemarks, setNewReceivableRemarks] = useState("");
  const [showBuyerSuggestions, setShowBuyerSuggestions] = useState(false);
  
  // Save form state to sessionStorage (persists for 30 seconds when navigating away)
  const saveFormState = useCallback(() => {
    if (!coldStorageId) return; // Don't save if no cold storage
    const stateToSave: PersistedFormState = {
      timestamp: Date.now(),
      activeTab,
      payerType,
      buyerName,
      customBuyerName,
      salesGoodsBuyerName,
      receiptType,
      accountType,
      inwardAmount,
      receivedDate,
      inwardRemarks,
      expenseType,
      expenseReceiverName,
      expensePaymentMode,
      expenseAccountType,
      expenseAmount,
      expenseDate,
      expenseRemarks,
      transferFromAccount,
      transferToAccount,
      transferAmount,
      transferDate,
      transferRemarks,
      transferTypeMode,
      buyerTransferFrom,
      buyerTransferTo,
      selectedSaleId,
      buyerTransferAmount,
      buyerTransferDate,
      buyerTransferRemarks,
    };
    sessionStorage.setItem(getStateKey(coldStorageId), JSON.stringify(stateToSave));
  }, [
    coldStorageId, activeTab, payerType, buyerName, customBuyerName, salesGoodsBuyerName, receiptType, accountType,
    inwardAmount, receivedDate, inwardRemarks, expenseType, expenseReceiverName, expensePaymentMode,
    expenseAccountType, expenseAmount, expenseDate, expenseRemarks, transferFromAccount, transferToAccount,
    transferAmount, transferDate, transferRemarks, transferTypeMode, buyerTransferFrom, buyerTransferTo,
    selectedSaleId, buyerTransferAmount, buyerTransferDate, buyerTransferRemarks
  ]);

  // Auto-save form state whenever any form field changes
  useEffect(() => {
    if (hasLoadedPersistedState) {
      saveFormState();
    }
  }, [saveFormState, hasLoadedPersistedState]);

  // Load persisted state when coldStorageId becomes available after mount
  useEffect(() => {
    if (coldStorageId && !hasLoadedPersistedState) {
      const loaded = loadPersistedState(coldStorageId);
      if (loaded) {
        // Apply loaded state to all form fields
        if (loaded.activeTab) setActiveTab(loaded.activeTab);
        if (loaded.payerType) setPayerType(loaded.payerType as "cold_merchant" | "sales_goods" | "kata" | "others");
        if (loaded.buyerName) setBuyerName(loaded.buyerName);
        if (loaded.customBuyerName) setCustomBuyerName(loaded.customBuyerName);
        if (loaded.salesGoodsBuyerName) setSalesGoodsBuyerName(loaded.salesGoodsBuyerName);
        if (loaded.receiptType) setReceiptType(loaded.receiptType as "cash" | "account");
        if (loaded.accountType) setAccountType(loaded.accountType as "limit" | "current");
        if (loaded.inwardAmount) setInwardAmount(loaded.inwardAmount);
        if (loaded.receivedDate) setReceivedDate(loaded.receivedDate);
        if (loaded.inwardRemarks) setInwardRemarks(loaded.inwardRemarks);
        if (loaded.expenseType) setExpenseType(loaded.expenseType);
        if (loaded.expenseReceiverName) setExpenseReceiverName(loaded.expenseReceiverName);
        if (loaded.expensePaymentMode) setExpensePaymentMode(loaded.expensePaymentMode as "cash" | "account");
        if (loaded.expenseAccountType) setExpenseAccountType(loaded.expenseAccountType as "limit" | "current");
        if (loaded.expenseAmount) setExpenseAmount(loaded.expenseAmount);
        if (loaded.expenseDate) setExpenseDate(loaded.expenseDate);
        if (loaded.expenseRemarks) setExpenseRemarks(loaded.expenseRemarks);
        if (loaded.transferFromAccount) setTransferFromAccount(loaded.transferFromAccount as "cash" | "limit" | "current");
        if (loaded.transferToAccount) setTransferToAccount(loaded.transferToAccount as "cash" | "limit" | "current");
        if (loaded.transferAmount) setTransferAmount(loaded.transferAmount);
        if (loaded.transferDate) setTransferDate(loaded.transferDate);
        if (loaded.transferRemarks) setTransferRemarks(loaded.transferRemarks);
        if (loaded.transferTypeMode) setTransferTypeMode(loaded.transferTypeMode);
        if (loaded.buyerTransferFrom) setBuyerTransferFrom(loaded.buyerTransferFrom);
        if (loaded.buyerTransferTo) setBuyerTransferTo(loaded.buyerTransferTo);
        if (loaded.selectedSaleId) setSelectedSaleId(loaded.selectedSaleId);
        if (loaded.buyerTransferAmount) setBuyerTransferAmount(loaded.buyerTransferAmount);
        if (loaded.buyerTransferDate) setBuyerTransferDate(loaded.buyerTransferDate);
        if (loaded.buyerTransferRemarks) setBuyerTransferRemarks(loaded.buyerTransferRemarks);
      }
      setHasLoadedPersistedState(true);
    }
  }, [coldStorageId, hasLoadedPersistedState]);

  const { data: buyersWithDues = [], isLoading: loadingBuyers } = useQuery<BuyerWithDue[]>({
    queryKey: ["/api/cash-receipts/buyers-with-dues"],
  });

  const { data: receipts = [], isLoading: loadingReceipts } = useQuery<CashReceipt[]>({
    queryKey: ["/api/cash-receipts"],
  });

  const { data: expensesList = [], isLoading: loadingExpenses } = useQuery<Expense[]>({
    queryKey: ["/api/expenses"],
  });

  const { data: salesGoodsBuyers = [] } = useQuery<string[]>({
    queryKey: ["/api/cash-receipts/sales-goods-buyers"],
  });

  const { data: receiverNames = [] } = useQuery<string[]>({
    queryKey: ["/api/expenses/receiver-names"],
  });

  const { data: transfers = [], isLoading: loadingTransfers } = useQuery<CashTransfer[]>({
    queryKey: ["/api/cash-transfers"],
  });

  // Current year opening balance for summary calculation (always enabled)
  const { data: currentYearOpeningBalance } = useQuery<CashOpeningBalance | null>({
    queryKey: ["/api/opening-balances", currentYear],
  });

  // Opening settings queries (for dialog)
  const { data: openingBalance } = useQuery<CashOpeningBalance | null>({
    queryKey: ["/api/opening-balances", settingsYear],
    enabled: showSettings,
  });

  const { data: openingReceivables = [] } = useQuery<OpeningReceivable[]>({
    queryKey: ["/api/opening-receivables", settingsYear],
    enabled: showSettings,
  });

  // All buyers for Buyer To dropdown
  const { data: allBuyers = [] } = useQuery<{ buyerName: string }[]>({
    queryKey: ["/api/buyers/lookup"],
  });

  // Sales with dues for selected buyer (for buyer-to-buyer transfer)
  const { data: buyerSalesWithDues = [] } = useQuery<SalesHistory[]>({
    queryKey: ["/api/sales-history/by-buyer", buyerTransferFrom],
    enabled: !!buyerTransferFrom && transferTypeMode === "buyer",
  });

  // Payment stats for expense type dropdown (totalHammali, totalGradingCharges)
  const { data: paymentStats } = useQuery<PaymentStats>({
    queryKey: ["/api/analytics/payments"],
    queryFn: async () => {
      const response = await authFetch("/api/analytics/payments");
      if (!response.ok) throw new Error("Failed to fetch payment stats");
      return response.json();
    },
  });

  // Discount queries - farmers with dues
  const { data: farmersWithDues = [] } = useQuery<{ farmerName: string; village: string; contactNumber: string; totalDue: number }[]>({
    queryKey: ["/api/farmers-with-dues"],
    enabled: expensePaymentMode === "discount",
  });

  // Parse selected farmer key to get details
  const selectedFarmerDetails = useMemo(() => {
    if (!discountFarmerKey) return null;
    const farmer = farmersWithDues.find(f => 
      `${f.farmerName}|${f.village}|${f.contactNumber}` === discountFarmerKey
    );
    return farmer || null;
  }, [discountFarmerKey, farmersWithDues]);

  // Buyer dues for selected farmer
  const { data: buyerDuesForFarmer = [] } = useQuery<{ buyerName: string; totalDue: number; latestSaleDate: string }[]>({
    queryKey: ["/api/buyer-dues", discountFarmerKey],
    queryFn: async () => {
      if (!selectedFarmerDetails) return [];
      const params = new URLSearchParams({
        farmerName: selectedFarmerDetails.farmerName,
        village: selectedFarmerDetails.village,
        contactNumber: selectedFarmerDetails.contactNumber,
      });
      const response = await authFetch(`/api/buyer-dues?${params}`);
      if (!response.ok) throw new Error("Failed to fetch buyer dues");
      return response.json();
    },
    enabled: !!selectedFarmerDetails && expensePaymentMode === "discount",
  });

  // Auto-populate discount allocations when discount amount changes
  useEffect(() => {
    if (!buyerDuesForFarmer.length || !discountAmount) {
      // Clear allocations when no discount amount
      if (!discountAmount && discountBuyerAllocations.length > 0) {
        setDiscountBuyerAllocations([]);
      }
      return;
    }
    
    const totalDiscount = parseFloat(discountAmount);
    if (isNaN(totalDiscount) || totalDiscount <= 0) {
      return;
    }
    
    // Auto-allocate from top to bottom until discount is exhausted
    let remaining = totalDiscount;
    const newAllocations: { buyerName: string; amount: string; maxAmount: number }[] = [];
    
    for (const buyer of buyerDuesForFarmer) {
      if (remaining <= 0) {
        // No more discount to allocate, add with 0 amount
        newAllocations.push({
          buyerName: buyer.buyerName,
          amount: "",
          maxAmount: buyer.totalDue,
        });
      } else {
        const allocation = Math.min(remaining, buyer.totalDue);
        newAllocations.push({
          buyerName: buyer.buyerName,
          amount: allocation > 0 ? allocation.toString() : "",
          maxAmount: buyer.totalDue,
        });
        remaining -= allocation;
      }
    }
    
    setDiscountBuyerAllocations(newAllocations);
  }, [discountAmount, buyerDuesForFarmer]);

  // Discounts list
  const { data: discountsList = [], isLoading: loadingDiscounts } = useQuery<Discount[]>({
    queryKey: ["/api/discounts"],
  });

  // Buyer-to-buyer transfers for cash flow history
  const { data: buyerTransfers = [], isLoading: loadingBuyerTransfers } = useQuery<SalesHistory[]>({
    queryKey: ["/api/sales-history/buyer-transfers"],
  });

  const createBuyerTransferMutation = useMutation({
    mutationFn: async (data: { saleId: string; fromBuyerName: string; toBuyerName: string; amount: number; transferDate: string; remarks?: string }) => {
      const response = await apiRequest("POST", "/api/buyer-transfer", data);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: t("success"),
        description: t("buyerTransferRecorded"),
        variant: "success",
      });
      setBuyerTransferFrom("");
      setBuyerTransferTo("");
      setSelectedSaleId("");
      setBuyerTransferAmount("");
      setBuyerTransferDate(format(new Date(), "yyyy-MM-dd"));
      setBuyerTransferRemarks("");
      clearPersistedState(coldStorageId);
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts/buyers-with-dues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history/by-buyer"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history/buyer-transfers"] });
    },
    onError: () => {
      toast({ title: t("error"), description: "Failed to record buyer transfer", variant: "destructive" });
    },
  });

  const createReceiptMutation = useMutation({
    mutationFn: async (data: { payerType: string; buyerName?: string; receiptType: string; accountType?: string; amount: number; receivedAt: string; notes?: string }) => {
      const response = await apiRequest("POST", "/api/cash-receipts", data);
      return response.json();
    },
    onSuccess: (result: { receipt: CashReceipt; salesUpdated: number }) => {
      toast({
        title: t("success"),
        description: `${t("paymentRecorded")} - ${result.salesUpdated} ${t("salesAdjusted")}`,
        variant: "success",
      });
      setPayerType("cold_merchant");
      setBuyerName("");
      setCustomBuyerName("");
      setSalesGoodsBuyerName("");
      setReceiptType("cash");
      setAccountType("limit");
      setInwardAmount("");
      setReceivedDate(format(new Date(), "yyyy-MM-dd"));
      setInwardRemarks("");
      clearPersistedState(coldStorageId);
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts/buyers-with-dues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts/sales-goods-buyers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history/by-buyer"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history/buyer-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/quality"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/merchants"] });
    },
    onError: () => {
      toast({ title: t("error"), description: "Failed to record payment", variant: "destructive" });
    },
  });

  const createExpenseMutation = useMutation({
    mutationFn: async (data: { expenseType: string; receiverName?: string; paymentMode: string; accountType?: string; amount: number; paidAt: string; remarks?: string }) => {
      const response = await apiRequest("POST", "/api/expenses", data);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: t("success"),
        description: t("expenseRecorded"),
        variant: "success",
      });
      setExpenseType("");
      setExpenseReceiverName("");
      setExpenseAmount("");
      setExpenseDate(format(new Date(), "yyyy-MM-dd"));
      setExpenseRemarks("");
      clearPersistedState(coldStorageId);
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/receiver-names"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/merchants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
    onError: () => {
      toast({ title: t("error"), description: "Failed to record expense", variant: "destructive" });
    },
  });

  const reverseReceiptMutation = useMutation({
    mutationFn: async (receiptId: string) => {
      const response = await apiRequest("POST", `/api/cash-receipts/${receiptId}/reverse`, {});
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: t("success"),
        description: t("entryReversed"),
        variant: "success",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts/buyers-with-dues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history/by-buyer"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history/buyer-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/quality"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/merchants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
    onError: () => {
      toast({ title: t("error"), description: t("reversalFailed"), variant: "destructive" });
    },
  });

  const reverseExpenseMutation = useMutation({
    mutationFn: async (expenseId: string) => {
      const response = await apiRequest("POST", `/api/expenses/${expenseId}/reverse`, {});
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: t("success"),
        description: t("entryReversed"),
        variant: "success",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/merchants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
    onError: () => {
      toast({ title: t("error"), description: t("reversalFailed"), variant: "destructive" });
    },
  });

  // Discount mutations
  const createDiscountMutation = useMutation({
    mutationFn: async (data: { farmerName: string; village: string; contactNumber: string; totalAmount: number; discountDate: string; remarks?: string; buyerAllocations: { buyerName: string; amount: number }[] }) => {
      const response = await apiRequest("POST", "/api/discounts", data);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: t("success"),
        description: "Discount recorded successfully",
        variant: "success",
      });
      setDiscountFarmerKey("");
      setDiscountAmount("");
      setDiscountDate(format(new Date(), "yyyy-MM-dd"));
      setDiscountRemarks("");
      setDiscountBuyerAllocations([]);
      clearPersistedState(coldStorageId);
      queryClient.invalidateQueries({ queryKey: ["/api/discounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/farmers-with-dues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/buyer-dues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/merchants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts/buyers-with-dues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
    onError: (error: any) => {
      const errorMsg = error?.message || "Failed to record discount";
      toast({ title: t("error"), description: errorMsg, variant: "destructive" });
    },
  });

  const reverseDiscountMutation = useMutation({
    mutationFn: async (discountId: string) => {
      const response = await apiRequest("POST", `/api/discounts/${discountId}/reverse`, {});
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: t("success"),
        description: t("entryReversed"),
        variant: "success",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/discounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/farmers-with-dues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/buyer-dues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/merchants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts/buyers-with-dues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
    onError: () => {
      toast({ title: t("error"), description: t("reversalFailed"), variant: "destructive" });
    },
  });

  const createTransferMutation = useMutation({
    mutationFn: async (data: { fromAccountType: string; toAccountType: string; amount: number; transferredAt: string; remarks?: string }) => {
      const response = await apiRequest("POST", "/api/cash-transfers", data);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: t("success"),
        description: t("transferRecorded"),
        variant: "success",
      });
      setTransferFromAccount("cash");
      setTransferToAccount("limit");
      setTransferAmount("");
      setTransferDate(format(new Date(), "yyyy-MM-dd"));
      setTransferRemarks("");
      clearPersistedState(coldStorageId);
      queryClient.invalidateQueries({ queryKey: ["/api/cash-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
    },
    onError: () => {
      toast({ title: t("error"), description: "Failed to record transfer", variant: "destructive" });
    },
  });

  const reverseTransferMutation = useMutation({
    mutationFn: async (transferId: string) => {
      const response = await apiRequest("POST", `/api/cash-transfers/${transferId}/reverse`, {});
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: t("success"),
        description: t("entryReversed"),
        variant: "success",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
    },
    onError: () => {
      toast({ title: t("error"), description: t("reversalFailed"), variant: "destructive" });
    },
  });

  // Opening settings mutations
  const saveOpeningBalanceMutation = useMutation({
    mutationFn: async (data: { year: number; cashInHand: number; limitBalance: number; currentBalance: number }) => {
      const response = await apiRequest("POST", "/api/opening-balances", data);
      return response.json();
    },
    onSuccess: (_result, variables) => {
      toast({ title: t("success"), description: t("openingBalancesSaved"), variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["/api/opening-balances", settingsYear] });
      // Also invalidate currentYear query to update the summary display
      if (variables.year === currentYear) {
        queryClient.invalidateQueries({ queryKey: ["/api/opening-balances", currentYear] });
      }
    },
    onError: () => {
      toast({ title: t("error"), description: t("saveFailed"), variant: "destructive" });
    },
  });

  const createReceivableMutation = useMutation({
    mutationFn: async (data: { year: number; payerType: string; buyerName?: string; dueAmount: number; remarks?: string }) => {
      const response = await apiRequest("POST", "/api/opening-receivables", data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: t("success"), description: t("receivableAdded"), variant: "success" });
      setNewReceivableBuyerName("");
      setNewReceivableAmount("");
      setNewReceivableRemarks("");
      queryClient.invalidateQueries({ queryKey: ["/api/opening-receivables", settingsYear] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts/buyers-with-dues"] });
    },
    onError: () => {
      toast({ title: t("error"), description: t("saveFailed"), variant: "destructive" });
    },
  });

  const deleteReceivableMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/opening-receivables/${id}`, {});
      return response.json();
    },
    onSuccess: () => {
      toast({ title: t("success"), description: t("receivableDeleted"), variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["/api/opening-receivables", settingsYear] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts/buyers-with-dues"] });
    },
    onError: () => {
      toast({ title: t("error"), description: t("deleteFailed"), variant: "destructive" });
    },
  });

  const handleInwardSubmit = () => {
    // Determine buyer name based on payer type
    let finalBuyerName: string | undefined;
    if (payerType === "cold_merchant") {
      finalBuyerName = buyerName === "__other__" ? customBuyerName.trim() : buyerName;
    } else if (payerType === "sales_goods") {
      finalBuyerName = salesGoodsBuyerName.trim();
    } else if (payerType === "others") {
      finalBuyerName = customBuyerName.trim();
    }
    // For kata, no buyer name needed
    
    // Validate required fields based on payer type
    if (payerType !== "kata" && !finalBuyerName) {
      toast({ title: t("error"), description: "Please fill all required fields", variant: "destructive" });
      return;
    }
    
    if (!inwardAmount || parseFloat(inwardAmount) <= 0) {
      toast({ title: t("error"), description: "Please fill all required fields", variant: "destructive" });
      return;
    }

    createReceiptMutation.mutate({
      payerType,
      buyerName: finalBuyerName,
      receiptType,
      accountType: receiptType === "account" ? accountType : undefined,
      amount: parseFloat(inwardAmount),
      receivedAt: new Date(receivedDate).toISOString(),
      notes: inwardRemarks || undefined,
    });
  };

  const handleExpenseSubmit = () => {
    if (!expenseType || !expenseAmount || parseFloat(expenseAmount) <= 0) {
      toast({ title: t("error"), description: "Please fill all required fields", variant: "destructive" });
      return;
    }

    createExpenseMutation.mutate({
      expenseType,
      receiverName: expenseReceiverName || undefined,
      paymentMode: expensePaymentMode,
      accountType: expensePaymentMode === "account" ? expenseAccountType : undefined,
      amount: parseFloat(expenseAmount),
      paidAt: new Date(expenseDate).toISOString(),
      remarks: expenseRemarks || undefined,
    });
  };

  const handleDiscountSubmit = () => {
    if (!selectedFarmerDetails || !discountAmount || parseFloat(discountAmount) <= 0) {
      toast({ title: t("error"), description: "Please select a farmer and enter discount amount", variant: "destructive" });
      return;
    }

    // Validate allocations sum
    const allocationsWithAmounts = discountBuyerAllocations.filter(a => parseFloat(a.amount) > 0);
    if (allocationsWithAmounts.length === 0) {
      toast({ title: t("error"), description: "Please allocate discount to at least one buyer", variant: "destructive" });
      return;
    }

    const allocationSum = allocationsWithAmounts.reduce((sum, a) => sum + parseFloat(a.amount || "0"), 0);
    const totalDiscount = parseFloat(discountAmount);
    if (Math.abs(allocationSum - totalDiscount) > 0.01) {
      toast({ 
        title: t("error"), 
        description: `Allocation total (₹${allocationSum.toLocaleString()}) must equal discount amount (₹${totalDiscount.toLocaleString()})`, 
        variant: "destructive" 
      });
      return;
    }

    createDiscountMutation.mutate({
      farmerName: selectedFarmerDetails.farmerName,
      village: selectedFarmerDetails.village,
      contactNumber: selectedFarmerDetails.contactNumber,
      totalAmount: totalDiscount,
      discountDate: new Date(discountDate).toISOString(),
      remarks: discountRemarks || undefined,
      buyerAllocations: allocationsWithAmounts.map(a => ({
        buyerName: a.buyerName,
        amount: parseFloat(a.amount),
      })),
    });
  };

  const handleTransferSubmit = () => {
    if (transferFromAccount === transferToAccount) {
      toast({ title: t("error"), description: t("sameAccountError"), variant: "destructive" });
      return;
    }
    if (!transferAmount || parseFloat(transferAmount) <= 0) {
      toast({ title: t("error"), description: "Please fill all required fields", variant: "destructive" });
      return;
    }

    createTransferMutation.mutate({
      fromAccountType: transferFromAccount,
      toAccountType: transferToAccount,
      amount: parseFloat(transferAmount),
      transferredAt: new Date(transferDate).toISOString(),
      remarks: transferRemarks || undefined,
    });
  };

  const handleBuyerTransferSubmit = () => {
    if (!buyerTransferFrom || !buyerTransferTo || !selectedSaleId || !buyerTransferAmount) {
      toast({ title: t("error"), description: "Please fill all required fields", variant: "destructive" });
      return;
    }
    if (parseFloat(buyerTransferAmount) <= 0) {
      toast({ title: t("error"), description: "Amount must be greater than zero", variant: "destructive" });
      return;
    }

    createBuyerTransferMutation.mutate({
      saleId: selectedSaleId,
      fromBuyerName: buyerTransferFrom,
      toBuyerName: buyerTransferTo,
      amount: parseFloat(buyerTransferAmount),
      transferDate: new Date(buyerTransferDate).toISOString(),
      remarks: buyerTransferRemarks || undefined,
    });
  };

  const getAccountLabel = (account: string) => {
    switch (account) {
      case "cash": return t("cashInHand");
      case "limit": return t("limitAccount");
      case "current": return t("currentAccount");
      default: return account;
    }
  };

  const selectedBuyerDue = buyersWithDues.find(b => 
    b.buyerName.trim().toLowerCase() === buyerName.trim().toLowerCase()
  )?.totalDue || 0;

  const getExpenseTypeLabel = (type: string) => {
    switch (type) {
      case "salary": return t("salary");
      case "hammali": return t("hammali");
      case "grading_charges": return t("gradingCharges");
      case "general_expenses": return t("generalExpenses");
      default: return type;
    }
  };

  const getPayerTypeLabel = (type: string) => {
    switch (type) {
      case "cold_merchant": return t("coldMerchant");
      case "sales_goods": return t("salesGoods");
      case "kata": return t("kata");
      case "others": return t("others");
      default: return type;
    }
  };

  const handleExportCashFlowCSV = (transactions: TransactionItem[]) => {
    if (transactions.length === 0) {
      toast({
        title: t("noTransactions"),
        variant: "destructive",
      });
      return;
    }

    const headers = [
      "Transaction ID",
      "Date",
      "Type",
      "Name/Description",
      "Amount",
      "Payment Mode",
      "Account Type",
      "Payer Type",
      "Remarks",
      "Status",
    ];

    const rows = transactions.map(transaction => {
      const isReversed = transaction.type !== "buyerTransfer" && (transaction.data as CashReceipt | Expense | CashTransfer).isReversed === 1;
      const dateStr = format(new Date(transaction.timestamp), "dd/MM/yyyy");
      
      if (transaction.type === "inflow") {
        const r = transaction.data as CashReceipt;
        return [
          r.transactionId || "",
          dateStr,
          t("inflow"),
          r.buyerName || getPayerTypeLabel(r.payerType),
          r.amount.toString(),
          r.receiptType === "cash" ? t("cash") : t("account"),
          r.receiptType === "account" ? (r.accountType === "limit" ? t("limitAccount") : t("currentAccount")) : "",
          getPayerTypeLabel(r.payerType),
          r.notes || "",
          isReversed ? t("reversed") : t("active"),
        ];
      } else if (transaction.type === "outflow") {
        const e = transaction.data as Expense;
        return [
          e.transactionId || "",
          dateStr,
          t("outflow"),
          getExpenseTypeLabel(e.expenseType) + (e.receiverName ? ` - ${e.receiverName}` : ""),
          e.amount.toString(),
          e.paymentMode === "cash" ? t("cash") : t("account"),
          e.paymentMode === "account" ? (e.accountType === "limit" ? t("limitAccount") : t("currentAccount")) : "",
          "",
          e.remarks || "",
          isReversed ? t("reversed") : t("active"),
        ];
      } else if (transaction.type === "transfer") {
        const tr = transaction.data as CashTransfer;
        return [
          tr.transactionId || "",
          dateStr,
          t("transfer"),
          `${getAccountLabel(tr.fromAccountType)} → ${getAccountLabel(tr.toAccountType)}`,
          tr.amount.toString(),
          t("transfer"),
          "",
          "",
          tr.remarks || "",
          isReversed ? t("reversed") : t("active"),
        ];
      } else if (transaction.type === "discount") {
        const d = transaction.data as Discount;
        const discountIsReversed = d.isReversed === 1;
        // Parse buyer allocations for CSV
        let allocationsStr = "";
        try {
          const allocations = JSON.parse(d.buyerAllocations);
          allocationsStr = allocations.map((a: { buyerName: string; amount: number }) => `${a.buyerName}: ₹${a.amount}`).join("; ");
        } catch { /* ignore */ }
        return [
          d.transactionId || "",
          dateStr,
          t("discount"),
          `${d.farmerName} - ${d.village}`,
          d.totalAmount.toString(),
          t("discount"),
          "",
          "",
          `${allocationsStr}${d.remarks ? ` | ${d.remarks}` : ""}`,
          discountIsReversed ? t("reversed") : t("active"),
        ];
      } else {
        const bt = transaction.data as SalesHistory;
        return [
          "",
          dateStr,
          t("buyerToBuyer"),
          `${bt.buyerName} → ${bt.transferToBuyerName}`,
          (bt.dueAmount || 0).toString(),
          t("liabilityTransfer"),
          "",
          "",
          bt.transferRemarks || "",
          t("active"),
        ];
      }
    });

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cash_flow_history_${format(new Date(), "yyyy-MM-dd")}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: t("downloadSuccess") || "Download successful",
      description: `${transactions.length} ${t("entries")} exported`,
    });
  };

  // Filter and sort transactions for display (latest first)
  const allTransactions: TransactionItem[] = useMemo(() => {
    // Apply filters to receipts
    let filteredReceipts = receipts;
    
    // Payment mode filter for receipts
    if (filterPaymentMode) {
      if (filterPaymentMode === "cash") {
        filteredReceipts = filteredReceipts.filter(r => r.receiptType === "cash");
      } else if (filterPaymentMode === "limit" || filterPaymentMode === "current") {
        filteredReceipts = filteredReceipts.filter(r => r.receiptType === "account" && r.accountType === filterPaymentMode);
      }
    }
    
    // Payer type filter
    if (filterPayerType) {
      filteredReceipts = filteredReceipts.filter(r => r.payerType === filterPayerType);
    }
    
    // Buyer name filter
    if (filterBuyer) {
      const filterKey = filterBuyer.trim().toLowerCase();
      filteredReceipts = filteredReceipts.filter(r => r.buyerName && r.buyerName.trim().toLowerCase() === filterKey);
    }
    
    // Month filter for receipts
    if (filterMonth) {
      filteredReceipts = filteredReceipts.filter(r => {
        const date = new Date(r.receivedAt);
        return format(date, "yyyy-MM") === filterMonth;
      });
    }
    
    // Year filter for receipts
    if (filterYear) {
      filteredReceipts = filteredReceipts.filter(r => {
        const date = new Date(r.receivedAt);
        return format(date, "yyyy") === filterYear;
      });
    }
    
    // Remarks filter for receipts
    if (filterRemarks) {
      const searchKey = filterRemarks.trim().toLowerCase();
      filteredReceipts = filteredReceipts.filter(r => r.notes && r.notes.toLowerCase().includes(searchKey));
    }

    // Apply filters to expenses
    let filteredExpenses = expensesList;
    
    // Payment mode filter for expenses
    if (filterPaymentMode) {
      if (filterPaymentMode === "cash") {
        filteredExpenses = filteredExpenses.filter(e => e.paymentMode === "cash");
      } else if (filterPaymentMode === "limit" || filterPaymentMode === "current") {
        filteredExpenses = filteredExpenses.filter(e => e.paymentMode === "account" && e.accountType === filterPaymentMode);
      }
    }
    
    // Expense type filter
    if (filterExpenseType) {
      filteredExpenses = filteredExpenses.filter(e => e.expenseType === filterExpenseType);
    }
    
    // Month filter for expenses
    if (filterMonth) {
      filteredExpenses = filteredExpenses.filter(e => {
        const date = new Date(e.paidAt);
        return format(date, "yyyy-MM") === filterMonth;
      });
    }
    
    // Year filter for expenses
    if (filterYear) {
      filteredExpenses = filteredExpenses.filter(e => {
        const date = new Date(e.paidAt);
        return format(date, "yyyy") === filterYear;
      });
    }
    
    // Remarks filter for expenses
    if (filterRemarks) {
      const searchKey = filterRemarks.trim().toLowerCase();
      filteredExpenses = filteredExpenses.filter(e => e.remarks && e.remarks.toLowerCase().includes(searchKey));
    }

    // Apply filters to transfers
    let filteredTransfers = transfers;
    
    // Month filter for transfers
    if (filterMonth) {
      filteredTransfers = filteredTransfers.filter(t => {
        const date = new Date(t.transferredAt);
        return format(date, "yyyy-MM") === filterMonth;
      });
    }
    
    // Year filter for transfers
    if (filterYear) {
      filteredTransfers = filteredTransfers.filter(t => {
        const date = new Date(t.transferredAt);
        return format(date, "yyyy") === filterYear;
      });
    }
    
    // Remarks filter for transfers
    if (filterRemarks) {
      const searchKey = filterRemarks.trim().toLowerCase();
      filteredTransfers = filteredTransfers.filter(t => t.remarks && t.remarks.toLowerCase().includes(searchKey));
    }

    // Apply transaction type filter
    // When filterPaymentMode is "discount", only show discounts
    const isDiscountFilterOnly = filterPaymentMode === "discount";
    const includeInward = !isDiscountFilterOnly && (filterTransactionType === "all" || filterTransactionType === "inward");
    const includeExpense = !isDiscountFilterOnly && (filterTransactionType === "all" || filterTransactionType === "expense");
    const includeTransfer = !isDiscountFilterOnly && (filterTransactionType === "all" || filterTransactionType === "self");
    const includeBuyerTransfer = !isDiscountFilterOnly && (filterTransactionType === "all" || filterTransactionType === "buyerTransfer");
    const includeDiscount = isDiscountFilterOnly || filterTransactionType === "all" || filterTransactionType === "expense"; // Show discounts with expenses or when discount filter selected

    // Apply filters to buyer transfers
    let filteredBuyerTransfers = buyerTransfers;
    
    // Month filter for buyer transfers
    if (filterMonth) {
      filteredBuyerTransfers = filteredBuyerTransfers.filter(bt => {
        const date = new Date(bt.transferDate || bt.soldAt);
        return format(date, "yyyy-MM") === filterMonth;
      });
    }
    
    // Year filter for buyer transfers
    if (filterYear) {
      filteredBuyerTransfers = filteredBuyerTransfers.filter(bt => {
        const date = new Date(bt.transferDate || bt.soldAt);
        return format(date, "yyyy") === filterYear;
      });
    }
    
    // Remarks filter for buyer transfers
    if (filterRemarks) {
      const searchKey = filterRemarks.trim().toLowerCase();
      filteredBuyerTransfers = filteredBuyerTransfers.filter(bt => 
        bt.transferRemarks && bt.transferRemarks.toLowerCase().includes(searchKey)
      );
    }

    // Combine and sort descending (latest first)
    const getTimestamp = (dateStr: string | Date | null): number => {
      if (!dateStr) return 0;
      if (dateStr instanceof Date) return dateStr.getTime();
      const parsed = Date.parse(dateStr);
      return isNaN(parsed) ? new Date(dateStr).getTime() : parsed;
    };

    return [
      ...(includeInward ? filteredReceipts.map(r => ({ 
        type: "inflow" as const, 
        data: r, 
        timestamp: getTimestamp(r.receivedAt)
      })) : []),
      ...(includeExpense ? filteredExpenses.map(e => ({ 
        type: "outflow" as const, 
        data: e, 
        timestamp: getTimestamp(e.paidAt)
      })) : []),
      ...(includeTransfer ? filteredTransfers.map(t => ({ 
        type: "transfer" as const, 
        data: t, 
        timestamp: getTimestamp(t.transferredAt)
      })) : []),
      ...(includeBuyerTransfer ? filteredBuyerTransfers.map(bt => ({ 
        type: "buyerTransfer" as const, 
        data: bt, 
        timestamp: getTimestamp(bt.transferDate || bt.soldAt)
      })) : []),
      ...(includeDiscount ? discountsList.filter(d => {
        if (d.isReversed === 1) return false;
        // Apply month filter
        if (filterMonth) {
          const date = new Date(d.discountDate);
          if (format(date, "yyyy-MM") !== filterMonth) return false;
        }
        // Apply year filter
        if (filterYear) {
          const date = new Date(d.discountDate);
          if (format(date, "yyyy") !== filterYear) return false;
        }
        return true;
      }).map(d => ({ 
        type: "discount" as const, 
        data: d, 
        timestamp: getTimestamp(d.discountDate)
      })) : []),
    ].sort((a, b) => {
      // Sort by transactionId descending (CF + YYYYMMDD + natural number)
      // For items without transactionId (buyerTransfer), fallback to timestamp
      const getTransactionId = (item: TransactionItem): string | null => {
        if (item.type === "buyerTransfer") return null;
        if (item.type === "discount") return (item.data as Discount).transactionId || null;
        return (item.data as CashReceipt | Expense | CashTransfer).transactionId || null;
      };

      const aTransId = getTransactionId(a);
      const bTransId = getTransactionId(b);

      // If both have transactionId, compare them (descending)
      if (aTransId && bTransId) {
        // Extract date and counter parts for proper numeric comparison
        // Format: CF + YYYYMMDD + counter (e.g., CF2026012210)
        const parseTransactionId = (tid: string) => {
          const datePart = tid.slice(2, 10); // YYYYMMDD
          const counterPart = parseInt(tid.slice(10), 10) || 0;
          return { datePart, counterPart };
        };
        const aParsed = parseTransactionId(aTransId);
        const bParsed = parseTransactionId(bTransId);
        
        // Compare date part first
        if (bParsed.datePart !== aParsed.datePart) {
          return bParsed.datePart.localeCompare(aParsed.datePart);
        }
        // Same date, compare counter (descending)
        return bParsed.counterPart - aParsed.counterPart;
      }

      // If only one has transactionId, prioritize it
      if (aTransId && !bTransId) return -1;
      if (!aTransId && bTransId) return 1;

      // Fallback to timestamp comparison
      const timeDiff = b.timestamp - a.timestamp;
      if (timeDiff !== 0) return timeDiff;
      return String(b.data.id).localeCompare(String(a.data.id));
    });
  }, [receipts, expensesList, transfers, buyerTransfers, discountsList, filterTransactionType, filterPaymentMode, filterPayerType, filterBuyer, filterExpenseType, filterRemarks, filterMonth, filterYear]);

  const isLoading = loadingReceipts || loadingExpenses || loadingTransfers || loadingBuyerTransfers || loadingDiscounts;

  const uniqueBuyers = useMemo(() => {
    // Aggregate buyers case-insensitively with trimming
    const normalizedMap = new Map<string, string>(); // lowercase -> canonical display name
    receipts.forEach(r => {
      if (!r.buyerName) return;
      const trimmed = r.buyerName.trim();
      const key = trimmed.toLowerCase();
      if (!normalizedMap.has(key)) {
        normalizedMap.set(key, trimmed);
      }
    });
    return Array.from(normalizedMap.values()).sort((a, b) => 
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
  }, [receipts]);

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    receipts.forEach(r => {
      const date = new Date(r.receivedAt);
      months.add(format(date, "yyyy-MM"));
    });
    expensesList.forEach(e => {
      const date = new Date(e.paidAt);
      months.add(format(date, "yyyy-MM"));
    });
    return Array.from(months).sort().reverse();
  }, [receipts, expensesList]);

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    receipts.forEach(r => {
      const date = new Date(r.receivedAt);
      years.add(format(date, "yyyy"));
    });
    expensesList.forEach(e => {
      const date = new Date(e.paidAt);
      years.add(format(date, "yyyy"));
    });
    return Array.from(years).sort().reverse();
  }, [receipts, expensesList]);

  const hasActiveFilters = filterTransactionType !== "all" || filterPaymentMode || filterPayerType || filterBuyer || filterExpenseType || filterRemarks || filterMonth || filterYear;

  const clearFilters = () => {
    setFilterTransactionType("all");
    setFilterPaymentMode("");
    setFilterPayerType("");
    setFilterBuyer("");
    setFilterBuyerSearch("");
    setFilterExpenseType("");
    setFilterRemarks("");
    setFilterMonth("");
    setFilterYear("");
  };

  const filteredBuyerOptions = useMemo(() => {
    if (!filterBuyerSearch) return uniqueBuyers;
    const search = filterBuyerSearch.toLowerCase();
    return uniqueBuyers.filter(b => b.toLowerCase().includes(search));
  }, [uniqueBuyers, filterBuyerSearch]);

  const summary = useMemo(() => {
    const activeReceipts = receipts.filter(r => r.isReversed !== 1);
    const activeExpenses = expensesList.filter(e => e.isReversed !== 1);
    const activeTransfers = transfers.filter(t => t.isReversed !== 1);

    // Opening balances from start of year settings
    const openingCash = Number(currentYearOpeningBalance?.cashInHand) || 0;
    const openingLimit = Number(currentYearOpeningBalance?.limitBalance) || 0;
    const openingCurrent = Number(currentYearOpeningBalance?.currentBalance) || 0;

    const totalCashReceived = activeReceipts
      .filter(r => r.receiptType === "cash")
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    
    const totalAccountReceived = activeReceipts
      .filter(r => r.receiptType === "account")
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    
    const totalLimitReceived = activeReceipts
      .filter(r => r.receiptType === "account" && r.accountType === "limit")
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    
    const totalCurrentReceived = activeReceipts
      .filter(r => r.receiptType === "account" && r.accountType === "current")
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    
    const totalCashExpenses = activeExpenses
      .filter(e => e.paymentMode === "cash")
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    
    const totalAccountExpenses = activeExpenses
      .filter(e => e.paymentMode === "account")
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    
    const totalLimitExpenses = activeExpenses
      .filter(e => e.paymentMode === "account" && e.accountType === "limit")
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    
    const totalCurrentExpenses = activeExpenses
      .filter(e => e.paymentMode === "account" && e.accountType === "current")
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    
    // Calculate net transfer impact on each account type
    // Transfers TO an account add, transfers FROM an account subtract
    const cashTransferIn = activeTransfers
      .filter(t => t.toAccountType === "cash")
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const cashTransferOut = activeTransfers
      .filter(t => t.fromAccountType === "cash")
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const netCashTransfer = cashTransferIn - cashTransferOut;
    
    const limitTransferIn = activeTransfers
      .filter(t => t.toAccountType === "limit")
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const limitTransferOut = activeTransfers
      .filter(t => t.fromAccountType === "limit")
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const netLimitTransfer = limitTransferIn - limitTransferOut;
    
    const currentTransferIn = activeTransfers
      .filter(t => t.toAccountType === "current")
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const currentTransferOut = activeTransfers
      .filter(t => t.fromAccountType === "current")
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const netCurrentTransfer = currentTransferIn - currentTransferOut;
    
    // Include opening balances in final calculations
    const cashInHand = openingCash + totalCashReceived - totalCashExpenses + netCashTransfer;
    const limitBalance = openingLimit + totalLimitReceived - totalLimitExpenses + netLimitTransfer;
    const currentBalance = openingCurrent + totalCurrentReceived - totalCurrentExpenses + netCurrentTransfer;

    return {
      totalCashReceived,
      totalAccountReceived,
      cashInHand,
      totalAccountExpenses,
      totalCashExpenses,
      limitBalance,
      currentBalance,
      netCashTransfer,
      netLimitTransfer,
      netCurrentTransfer,
    };
  }, [receipts, expensesList, transfers, currentYearOpeningBalance]);

  const filteredSummary = useMemo(() => {
    let filteredReceipts = receipts.filter(r => r.isReversed !== 1);
    let filteredExpenses = expensesList.filter(e => e.isReversed !== 1);
    let filteredTransfers = transfers.filter(t => t.isReversed !== 1);

    // Apply same filters as allTransactions
    if (filterPaymentMode) {
      if (filterPaymentMode === "cash") {
        filteredReceipts = filteredReceipts.filter(r => r.receiptType === "cash");
        filteredExpenses = filteredExpenses.filter(e => e.paymentMode === "cash");
        filteredTransfers = filteredTransfers.filter(t => t.fromAccountType === "cash" || t.toAccountType === "cash");
      } else if (filterPaymentMode === "limit" || filterPaymentMode === "current") {
        filteredReceipts = filteredReceipts.filter(r => r.receiptType === "account" && r.accountType === filterPaymentMode);
        filteredExpenses = filteredExpenses.filter(e => e.paymentMode === "account" && e.accountType === filterPaymentMode);
        filteredTransfers = filteredTransfers.filter(t => t.fromAccountType === filterPaymentMode || t.toAccountType === filterPaymentMode);
      }
    }

    if (filterPayerType) {
      filteredReceipts = filteredReceipts.filter(r => r.payerType === filterPayerType);
    }

    if (filterBuyer) {
      const filterKey = filterBuyer.trim().toLowerCase();
      filteredReceipts = filteredReceipts.filter(r => r.buyerName && r.buyerName.trim().toLowerCase() === filterKey);
    }

    if (filterExpenseType) {
      filteredExpenses = filteredExpenses.filter(e => e.expenseType === filterExpenseType);
    }

    if (filterMonth) {
      filteredReceipts = filteredReceipts.filter(r => {
        const date = new Date(r.receivedAt);
        return format(date, "yyyy-MM") === filterMonth;
      });
      filteredExpenses = filteredExpenses.filter(e => {
        const date = new Date(e.paidAt);
        return format(date, "yyyy-MM") === filterMonth;
      });
      filteredTransfers = filteredTransfers.filter(t => {
        const date = new Date(t.transferredAt);
        return format(date, "yyyy-MM") === filterMonth;
      });
    }

    if (filterYear) {
      filteredReceipts = filteredReceipts.filter(r => {
        const date = new Date(r.receivedAt);
        return format(date, "yyyy") === filterYear;
      });
      filteredExpenses = filteredExpenses.filter(e => {
        const date = new Date(e.paidAt);
        return format(date, "yyyy") === filterYear;
      });
      filteredTransfers = filteredTransfers.filter(t => {
        const date = new Date(t.transferredAt);
        return format(date, "yyyy") === filterYear;
      });
    }

    if (filterRemarks) {
      const searchKey = filterRemarks.trim().toLowerCase();
      filteredReceipts = filteredReceipts.filter(r => r.notes && r.notes.toLowerCase().includes(searchKey));
      filteredExpenses = filteredExpenses.filter(e => e.remarks && e.remarks.toLowerCase().includes(searchKey));
      filteredTransfers = filteredTransfers.filter(t => t.remarks && t.remarks.toLowerCase().includes(searchKey));
    }

    // Apply transaction type filter
    const includeInward = filterTransactionType === "all" || filterTransactionType === "inward";
    const includeExpense = filterTransactionType === "all" || filterTransactionType === "expense";
    const includeTransfer = filterTransactionType === "all" || filterTransactionType === "self";

    const totalInward = includeInward ? filteredReceipts.reduce((sum, r) => sum + (Number(r.amount) || 0), 0) : 0;
    const totalExpense = includeExpense ? filteredExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0) : 0;
    const totalTransfer = includeTransfer ? filteredTransfers.reduce((sum, t) => sum + (Number(t.amount) || 0), 0) : 0;

    return {
      totalInward,
      totalExpense,
      totalTransfer,
    };
  }, [receipts, expensesList, transfers, filterTransactionType, filterPaymentMode, filterPayerType, filterBuyer, filterExpenseType, filterRemarks, filterMonth, filterYear]);

  return (
    <div className="container mx-auto p-4 max-w-4xl overflow-x-hidden">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Banknote className="h-6 w-6" />
          {t("cashManagement")}
        </h1>
        {canEdit && (
          <Button
            variant="outline"
            size="icon"
            onClick={() => setShowSettings(true)}
            data-testid="button-settings"
          >
            <Settings className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* Balance Cards - Row 1: Account Balances */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
        <Card data-testid="stat-cash-in-hand">
          <CardContent className="p-2">
            <div className="flex items-center gap-1 text-muted-foreground text-xs mb-0.5">
              <Wallet className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{t("cashInHand")}</span>
            </div>
            <div className={`text-sm font-bold ${summary.cashInHand >= 0 ? "text-blue-600" : "text-red-600"}`}>
              {isLoading ? "..." : `₹${summary.cashInHand.toLocaleString()}`}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="stat-limit-balance">
          <CardContent className="p-2">
            <div className="flex items-center gap-1 text-muted-foreground text-xs mb-0.5">
              <Building2 className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{t("limitAccount")}</span>
            </div>
            <div className={`text-sm font-bold ${summary.limitBalance >= 0 ? "text-blue-600" : "text-red-600"}`}>
              {isLoading ? "..." : `₹${summary.limitBalance.toLocaleString()}`}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="stat-current-balance">
          <CardContent className="p-2">
            <div className="flex items-center gap-1 text-muted-foreground text-xs mb-0.5">
              <CreditCard className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{t("currentAccount")}</span>
            </div>
            <div className={`text-sm font-bold ${summary.currentBalance >= 0 ? "text-blue-600" : "text-red-600"}`}>
              {isLoading ? "..." : `₹${summary.currentBalance.toLocaleString()}`}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Summary Cards - Row 2: Received & Expenses */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <Card data-testid="stat-total-cash-received">
          <CardContent className="p-2">
            <div className="flex items-center gap-1 text-muted-foreground text-xs mb-0.5">
              <Banknote className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{t("totalCashReceived")}</span>
            </div>
            <div className="text-sm font-bold text-green-600">
              {isLoading ? "..." : `₹${summary.totalCashReceived.toLocaleString()}`}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="stat-cash-expense">
          <CardContent className="p-2">
            <div className="flex items-center gap-1 text-muted-foreground text-xs mb-0.5">
              <ArrowUpRight className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{t("cashExpense")}</span>
            </div>
            <div className="text-sm font-bold text-red-600">
              {isLoading ? "..." : `₹${summary.totalCashExpenses.toLocaleString()}`}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="stat-total-account-received">
          <CardContent className="p-2">
            <div className="flex items-center gap-1 text-muted-foreground text-xs mb-0.5">
              <Building2 className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{t("totalAccountReceived")}</span>
            </div>
            <div className="text-sm font-bold text-green-600">
              {isLoading ? "..." : `₹${summary.totalAccountReceived.toLocaleString()}`}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="stat-expense-from-account">
          <CardContent className="p-2">
            <div className="flex items-center gap-1 text-muted-foreground text-xs mb-0.5">
              <CreditCard className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{t("totalExpenseFromAccount")}</span>
            </div>
            <div className="text-sm font-bold text-red-600">
              {isLoading ? "..." : `₹${summary.totalAccountExpenses.toLocaleString()}`}
            </div>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground mb-4 text-right">
        {t("asOf")}: {format(new Date(), "dd/MM/yyyy")}
      </p>

      <Card className="mb-6">
        <CardContent className="pt-3 pb-3 space-y-2">
          {/* Header row: Filter icon + label + clear button */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t("filters")}</span>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-6 text-xs px-2 ml-auto"
                data-testid="button-clear-filters"
              >
                <X className="h-3 w-3 mr-1" />
                {t("clearFilters")}
              </Button>
            )}
          </div>

          {/* Row 1: Transaction Type, Payment Mode, Month, Year */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("transactionType")}</Label>
              <Select value={filterTransactionType} onValueChange={(v) => setFilterTransactionType(v as "all" | "inward" | "expense" | "self" | "buyerTransfer")}>
                <SelectTrigger data-testid="select-filter-transaction-type" className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allTransactions")}</SelectItem>
                  <SelectItem value="inward">{t("inwardCash")}</SelectItem>
                  <SelectItem value="expense">{t("expense")}</SelectItem>
                  <SelectItem value="self">{t("selfTransfers")}</SelectItem>
                  <SelectItem value="buyerTransfer">{t("buyerToBuyer")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">{t("filterByPaymentMode")}</Label>
              <Select value={filterPaymentMode || "all"} onValueChange={(v) => setFilterPaymentMode(v === "all" ? "" : v)}>
                <SelectTrigger data-testid="select-filter-payment-mode" className="h-8 text-sm">
                  <SelectValue placeholder={t("allPaymentModes")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allPaymentModes")}</SelectItem>
                  <SelectItem value="cash">{t("cash")}</SelectItem>
                  <SelectItem value="limit">{t("limitAccount")}</SelectItem>
                  <SelectItem value="current">{t("currentAccount")}</SelectItem>
                  <SelectItem value="discount">{t("discount")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">{t("filterByMonth")}</Label>
              <Select value={filterMonth || "all"} onValueChange={(v) => setFilterMonth(v === "all" ? "" : v)}>
                <SelectTrigger data-testid="select-filter-month" className="h-8 text-sm">
                  <SelectValue placeholder={t("allMonths")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allMonths")}</SelectItem>
                  {availableMonths.map((month) => (
                    <SelectItem key={month} value={month}>
                      {format(new Date(month + "-01"), "MMM yyyy")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">{t("filterByYear")}</Label>
              <Select value={filterYear || "all"} onValueChange={(v) => setFilterYear(v === "all" ? "" : v)}>
                <SelectTrigger data-testid="select-filter-year" className="h-8 text-sm">
                  <SelectValue placeholder={t("allYears")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allYears")}</SelectItem>
                  {availableYears.map((year) => (
                    <SelectItem key={year} value={year}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 2: Payer Type (inward only), Buyer Name (cold_merchant only), Expense Type (expense only) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
            {(filterTransactionType === "all" || filterTransactionType === "inward") && (
              <div className="space-y-1">
                <Label className="text-xs">{t("filterByPayerType")}</Label>
                <Select value={filterPayerType || "all"} onValueChange={(v) => {
                  setFilterPayerType(v === "all" ? "" : v);
                  if (v !== "cold_merchant") {
                    setFilterBuyer("");
                    setFilterBuyerSearch("");
                  }
                }}>
                  <SelectTrigger data-testid="select-filter-payer-type" className="h-8 text-sm">
                    <SelectValue placeholder={t("allPayerTypes")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("allPayerTypes")}</SelectItem>
                    <SelectItem value="cold_merchant">{t("coldMerchant")}</SelectItem>
                    <SelectItem value="sales_goods">{t("salesGoods")}</SelectItem>
                    <SelectItem value="kata">{t("kata")}</SelectItem>
                    <SelectItem value="others">{t("others")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {(filterTransactionType === "all" || filterTransactionType === "inward") && (filterPayerType === "" || filterPayerType === "cold_merchant" || filterPayerType === "sales_goods") && (
              <div className="space-y-1">
                <Label className="text-xs">{t("filterByBuyer")}</Label>
                <div className="relative">
                  <Input
                    value={filterBuyerSearch}
                    onChange={(e) => {
                      setFilterBuyerSearch(e.target.value);
                      if (!e.target.value) setFilterBuyer("");
                      else if (uniqueBuyers.includes(e.target.value)) {
                        setFilterBuyer(e.target.value);
                      }
                    }}
                    onBlur={(e) => {
                      const val = e.target.value.trim();
                      if (val && uniqueBuyers.some(b => b.toLowerCase() === val.toLowerCase())) {
                        const match = uniqueBuyers.find(b => b.toLowerCase() === val.toLowerCase());
                        if (match) {
                          setFilterBuyer(match);
                          setFilterBuyerSearch(match);
                        }
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const val = filterBuyerSearch.trim();
                        if (val && uniqueBuyers.some(b => b.toLowerCase() === val.toLowerCase())) {
                          const match = uniqueBuyers.find(b => b.toLowerCase() === val.toLowerCase());
                          if (match) {
                            setFilterBuyer(match);
                            setFilterBuyerSearch(match);
                          }
                        }
                      }
                    }}
                    placeholder={t("searchBuyerName")}
                    className="h-8 text-sm"
                    data-testid="input-filter-buyer-search"
                    list="buyer-suggestions"
                  />
                  <datalist id="buyer-suggestions">
                    {filteredBuyerOptions.map((buyer) => (
                      <option key={buyer} value={buyer} />
                    ))}
                  </datalist>
                </div>
                {filterBuyerSearch.length >= 1 && filteredBuyerOptions.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {filteredBuyerOptions.slice(0, 3).map((buyer, idx) => (
                      <Badge
                        key={buyer}
                        variant={filterBuyer === buyer ? "default" : "outline"}
                        className="text-xs cursor-pointer"
                        data-testid={`badge-buyer-suggestion-${idx}`}
                        onClick={() => {
                          setFilterBuyer(buyer);
                          setFilterBuyerSearch(buyer);
                        }}
                      >
                        {buyer}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}

            {(filterTransactionType === "all" || filterTransactionType === "expense") && (
              <div className="space-y-1">
                <Label className="text-xs">{t("filterByExpenseType")}</Label>
                <Select value={filterExpenseType || "all"} onValueChange={(v) => setFilterExpenseType(v === "all" ? "" : v)}>
                  <SelectTrigger data-testid="select-filter-expense-type" className="h-8 text-sm">
                    <SelectValue placeholder={t("allExpenseTypes")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("allExpenseTypes")}</SelectItem>
                    <SelectItem value="salary">{t("salary")}</SelectItem>
                    <SelectItem value="hammali">{t("hammali")}</SelectItem>
                    <SelectItem value="grading_charges">{t("gradingCharges")}</SelectItem>
                    <SelectItem value="general_expenses">{t("generalExpenses")}</SelectItem>
                    <SelectItem value="cost_of_goods_sold">{t("costOfGoodsSold")}</SelectItem>
                    <SelectItem value="tds">{t("tds")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1 col-span-2 md:col-span-1">
              <Label className="text-xs">{t("filterByRemarks")}</Label>
              <Input
                value={filterRemarks}
                onChange={(e) => setFilterRemarks(e.target.value)}
                placeholder={t("searchRemarks")}
                className="h-8 text-sm"
                data-testid="input-filter-remarks"
              />
            </div>
          </div>

          {hasActiveFilters && (
            <div className="p-2 bg-muted rounded-lg">
              <div className="flex items-center justify-between text-sm">
                <div className="flex gap-4">
                  {(filterTransactionType === "all" || filterTransactionType === "inward") && (
                    <span>
                      <span className="text-muted-foreground">{t("inwardCash")}:</span>
                      <span className="ml-1 font-semibold text-green-600">₹{filteredSummary.totalInward.toLocaleString()}</span>
                    </span>
                  )}
                  {(filterTransactionType === "all" || filterTransactionType === "expense") && (
                    <span>
                      <span className="text-muted-foreground">{t("expense")}:</span>
                      <span className="ml-1 font-semibold text-red-600">₹{filteredSummary.totalExpense.toLocaleString()}</span>
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {allTransactions.length} {t("entries")}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2 items-stretch overflow-hidden">
        <Card className="flex flex-col overflow-hidden">
          <CardHeader className="pb-3">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "inward" | "expense" | "self")}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger 
                  value="inward" 
                  data-testid="tab-inward"
                  className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-xs sm:text-sm px-1 sm:px-3"
                >
                  <ArrowDownLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-0.5 sm:mr-1 flex-shrink-0" />
                  <span className="truncate">{t("inwardCash")}</span>
                </TabsTrigger>
                <TabsTrigger 
                  value="expense" 
                  data-testid="tab-expense"
                  className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-xs sm:text-sm px-1 sm:px-3"
                >
                  <ArrowUpRight className="h-3 w-3 sm:h-4 sm:w-4 mr-0.5 sm:mr-1 flex-shrink-0" />
                  <span className="truncate">{t("expense")}</span>
                </TabsTrigger>
                <TabsTrigger 
                  value="self" 
                  data-testid="tab-transfer"
                  className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-xs sm:text-sm px-1 sm:px-3"
                >
                  <ArrowLeftRight className="h-3 w-3 sm:h-4 sm:w-4 mr-0.5 sm:mr-1 flex-shrink-0" />
                  <span className="truncate">{t("transfer")}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeTab === "inward" ? (
              <>
                <div className="space-y-2">
                  <Label>{t("paymentMode")} *</Label>
                  <Select value={receiptType} onValueChange={(v) => setReceiptType(v as "cash" | "account")}>
                    <SelectTrigger data-testid="select-receipt-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">
                        <span className="flex items-center gap-2">
                          <Banknote className="h-4 w-4" />
                          {t("cashReceived")}
                        </span>
                      </SelectItem>
                      <SelectItem value="account">
                        <span className="flex items-center gap-2">
                          <CreditCard className="h-4 w-4" />
                          {t("accountReceived")}
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {receiptType === "account" && (
                  <div className="space-y-2">
                    <Label>{t("accountType")} *</Label>
                    <Select value={accountType} onValueChange={(v) => setAccountType(v as "limit" | "current")}>
                      <SelectTrigger data-testid="select-account-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="limit">
                          <span className="flex items-center gap-2">
                            <Building2 className="h-4 w-4" />
                            {t("limitAccount")}
                          </span>
                        </SelectItem>
                        <SelectItem value="current">
                          <span className="flex items-center gap-2">
                            <Wallet className="h-4 w-4" />
                            {t("currentAccount")}
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>{t("payerType")} *</Label>
                  <Select value={payerType} onValueChange={(v) => {
                    setPayerType(v as "cold_merchant" | "sales_goods" | "kata" | "others");
                    // Reset buyer name fields when changing payer type
                    setBuyerName("");
                    setCustomBuyerName("");
                    setSalesGoodsBuyerName("");
                  }}>
                    <SelectTrigger data-testid="select-payer-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cold_merchant">{t("coldMerchant")}</SelectItem>
                      <SelectItem value="sales_goods">{t("salesGoods")}</SelectItem>
                      <SelectItem value="kata">{t("kata")}</SelectItem>
                      <SelectItem value="others">{t("others")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {payerType === "cold_merchant" && (
                  <div className="space-y-2">
                    <Label>{t("buyerName")} *</Label>
                    {loadingBuyers ? (
                      <div className="text-sm text-muted-foreground">{t("loading")}</div>
                    ) : (
                      <Select value={buyerName} onValueChange={(value) => {
                        setBuyerName(value);
                        if (value !== "__other__") {
                          setCustomBuyerName("");
                        }
                      }}>
                        <SelectTrigger data-testid="select-buyer">
                          <SelectValue placeholder={t("selectBuyer")} />
                        </SelectTrigger>
                        <SelectContent>
                          {buyersWithDues.map((buyer) => (
                            <SelectItem key={buyer.buyerName} value={buyer.buyerName}>
                              <span className="flex items-center justify-between gap-4 w-full">
                                <span>{buyer.buyerName}</span>
                                <Badge variant="outline" className="text-xs">
                                  ₹{buyer.totalDue.toLocaleString()}
                                </Badge>
                              </span>
                            </SelectItem>
                          ))}
                          <SelectItem value="__other__">
                            <span className="text-muted-foreground italic">{t("other") || "Other"}</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    {buyerName === "__other__" && (
                      <Input
                        value={customBuyerName}
                        onChange={(e) => setCustomBuyerName(e.target.value)}
                        placeholder={t("enterBuyerName") || "Enter buyer name"}
                        data-testid="input-custom-buyer-name"
                      />
                    )}
                    {buyerName && buyerName !== "__other__" && selectedBuyerDue > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t("totalDue")}: ₹{selectedBuyerDue.toLocaleString()}
                      </p>
                    )}
                  </div>
                )}

                {payerType === "sales_goods" && (
                  <div className="space-y-2">
                    <Label>{t("buyerName")} *</Label>
                    <Input
                      value={salesGoodsBuyerName}
                      onChange={(e) => setSalesGoodsBuyerName(e.target.value)}
                      placeholder={t("enterBuyerName") || "Enter buyer name"}
                      list="sales-goods-buyers-list"
                      data-testid="input-sales-goods-buyer"
                    />
                    <datalist id="sales-goods-buyers-list">
                      {salesGoodsBuyers.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </div>
                )}

                {payerType === "others" && (
                  <div className="space-y-2">
                    <Label>{t("buyerName")} *</Label>
                    <Input
                      value={customBuyerName}
                      onChange={(e) => setCustomBuyerName(e.target.value)}
                      placeholder={t("enterBuyerName") || "Enter buyer name"}
                      data-testid="input-others-buyer"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label>{t("amount")} (₹) *</Label>
                  <Input
                    type="number"
                    value={inwardAmount}
                    onChange={(e) => setInwardAmount(e.target.value)}
                    placeholder="0"
                    min={1}
                    data-testid="input-inward-amount"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    {t("receivedOn")}
                  </Label>
                  <Input
                    type="date"
                    value={receivedDate}
                    onChange={(e) => setReceivedDate(e.target.value)}
                    data-testid="input-received-date"
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t("remarks")}</Label>
                  <Input
                    value={inwardRemarks}
                    onChange={(e) => setInwardRemarks(e.target.value)}
                    placeholder={t("remarks")}
                    data-testid="input-inward-remarks"
                  />
                </div>

                <Button
                  onClick={handleInwardSubmit}
                  disabled={
                    !canEdit || 
                    !inwardAmount || 
                    createReceiptMutation.isPending ||
                    (payerType === "cold_merchant" && (!buyerName || (buyerName === "__other__" && !customBuyerName.trim()))) ||
                    (payerType === "sales_goods" && !salesGoodsBuyerName.trim()) ||
                    (payerType === "others" && !customBuyerName.trim())
                  }
                  className="w-full"
                  data-testid="button-record-payment"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {createReceiptMutation.isPending ? t("saving") : t("recordPayment")}
                </Button>
                {!canEdit && (
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    {t("viewOnlyAccess") || "View-only access. Contact admin for edit permissions."}
                  </p>
                )}
              </>
            ) : activeTab === "expense" ? (
              <>
                <div className="space-y-2">
                  <Label>{t("paymentMode")} *</Label>
                  <Select value={expensePaymentMode} onValueChange={(v) => {
                    setExpensePaymentMode(v as "cash" | "account" | "discount");
                    if (v === "discount") {
                      setDiscountFarmerKey("");
                      setDiscountAmount("");
                      setDiscountBuyerAllocations([]);
                    }
                  }}>
                    <SelectTrigger data-testid="select-expense-payment-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">
                        <span className="flex items-center gap-2">
                          <Banknote className="h-4 w-4" />
                          {t("cash")}
                        </span>
                      </SelectItem>
                      <SelectItem value="account">
                        <span className="flex items-center gap-2">
                          <CreditCard className="h-4 w-4" />
                          {t("account")}
                        </span>
                      </SelectItem>
                      <SelectItem value="discount">
                        <span className="flex items-center gap-2">
                          <ArrowDownLeft className="h-4 w-4" />
                          Discount
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {expensePaymentMode === "discount" ? (
                  <>
                    {/* Discount Form */}
                    <div className="space-y-2">
                      <Label>Farmer *</Label>
                      <Select 
                        value={discountFarmerKey} 
                        onValueChange={(v) => {
                          setDiscountFarmerKey(v);
                          setDiscountBuyerAllocations([]);
                        }}
                      >
                        <SelectTrigger data-testid="select-discount-farmer">
                          <SelectValue placeholder="Select farmer..." />
                        </SelectTrigger>
                        <SelectContent>
                          {farmersWithDues.map((f) => (
                            <SelectItem 
                              key={`${f.farmerName}|${f.village}|${f.contactNumber}`}
                              value={`${f.farmerName}|${f.village}|${f.contactNumber}`}
                            >
                              <div className="flex flex-col">
                                <span className="font-medium">{f.farmerName}</span>
                                <span className="text-xs text-muted-foreground">
                                  {f.village} | {f.contactNumber} | Due: ₹{f.totalDue.toLocaleString()}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Discount Amount (₹) *</Label>
                      <Input
                        type="number"
                        value={discountAmount}
                        onChange={(e) => setDiscountAmount(e.target.value)}
                        placeholder="0"
                        min={1}
                        max={selectedFarmerDetails?.totalDue || undefined}
                        data-testid="input-discount-amount"
                      />
                      {selectedFarmerDetails && (
                        <p className="text-xs text-muted-foreground">
                          Max: ₹{selectedFarmerDetails.totalDue.toLocaleString()}
                        </p>
                      )}
                    </div>

                    {selectedFarmerDetails && buyerDuesForFarmer.length > 0 && (
                      <div className="space-y-2">
                        <Label>Allocate to Buyers *</Label>
                        <div className="border rounded-md p-3 space-y-3 max-h-60 overflow-y-auto">
                          {buyerDuesForFarmer.map((buyer, idx) => {
                            const allocationItem = discountBuyerAllocations.find(a => a.buyerName === buyer.buyerName);
                            return (
                              <div key={buyer.buyerName} className="flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-sm truncate">{buyer.buyerName}</p>
                                  <p className="text-xs text-muted-foreground">
                                    Due: ₹{buyer.totalDue.toLocaleString()}
                                  </p>
                                </div>
                                <Input
                                  type="number"
                                  className="w-28"
                                  placeholder="0"
                                  min={0}
                                  max={buyer.totalDue}
                                  value={allocationItem?.amount || ""}
                                  onChange={(e) => {
                                    const newAllocations = [...discountBuyerAllocations];
                                    const existingIdx = newAllocations.findIndex(a => a.buyerName === buyer.buyerName);
                                    if (existingIdx >= 0) {
                                      newAllocations[existingIdx] = { 
                                        buyerName: buyer.buyerName, 
                                        amount: e.target.value,
                                        maxAmount: buyer.totalDue
                                      };
                                    } else {
                                      newAllocations.push({ 
                                        buyerName: buyer.buyerName, 
                                        amount: e.target.value,
                                        maxAmount: buyer.totalDue
                                      });
                                    }
                                    setDiscountBuyerAllocations(newAllocations);
                                  }}
                                  data-testid={`input-allocation-${idx}`}
                                />
                              </div>
                            );
                          })}
                        </div>
                        {discountAmount && (
                          <p className={`text-xs ${
                            Math.abs(
                              discountBuyerAllocations.reduce((sum, a) => sum + parseFloat(a.amount || "0"), 0) - 
                              parseFloat(discountAmount || "0")
                            ) < 0.01 ? "text-green-600" : "text-amber-600"
                          }`}>
                            Allocated: ₹{discountBuyerAllocations.reduce((sum, a) => sum + parseFloat(a.amount || "0"), 0).toLocaleString()} 
                            / ₹{parseFloat(discountAmount || "0").toLocaleString()}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        Discount Date
                      </Label>
                      <Input
                        type="date"
                        value={discountDate}
                        onChange={(e) => setDiscountDate(e.target.value)}
                        data-testid="input-discount-date"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>{t("remarks")}</Label>
                      <Input
                        value={discountRemarks}
                        onChange={(e) => setDiscountRemarks(e.target.value)}
                        placeholder={t("remarks")}
                        data-testid="input-discount-remarks"
                      />
                    </div>

                    <Button
                      onClick={handleDiscountSubmit}
                      disabled={
                        !canEdit || 
                        !selectedFarmerDetails || 
                        !discountAmount || 
                        parseFloat(discountAmount) <= 0 ||
                        createDiscountMutation.isPending
                      }
                      className="w-full"
                      data-testid="button-record-discount"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {createDiscountMutation.isPending ? t("saving") : "Record Discount"}
                    </Button>
                  </>
                ) : (
                  <>
                    {expensePaymentMode === "account" && (
                      <div className="space-y-2">
                        <Label>{t("accountType")} *</Label>
                        <Select value={expenseAccountType} onValueChange={(v) => setExpenseAccountType(v as "limit" | "current")}>
                          <SelectTrigger data-testid="select-expense-account-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                          <SelectItem value="limit">
                            <span className="flex items-center gap-2">
                              <Building2 className="h-4 w-4" />
                              {t("limitAccount")}
                            </span>
                          </SelectItem>
                          <SelectItem value="current">
                            <span className="flex items-center gap-2">
                              <Wallet className="h-4 w-4" />
                              {t("currentAccount")}
                            </span>
                          </SelectItem>
                        </SelectContent>
                        </Select>
                      </div>
                    )}

                <div className="space-y-2">
                  <Label>{t("expenseType")} *</Label>
                  <Select value={expenseType} onValueChange={(v) => {
                    setExpenseType(v);
                    setExpenseReceiverName("");
                  }}>
                    <SelectTrigger data-testid="select-expense-type">
                      <SelectValue placeholder={t("selectExpenseType")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="salary">{t("salary")}</SelectItem>
                      <SelectItem value="hammali">
                        {t("hammali")} {paymentStats?.totalHammali ? `(₹${paymentStats.totalHammali.toLocaleString("en-IN")})` : ""}
                      </SelectItem>
                      <SelectItem value="grading_charges">
                        {t("gradingCharges")} {paymentStats?.totalGradingCharges ? `(₹${paymentStats.totalGradingCharges.toLocaleString("en-IN")})` : ""}
                      </SelectItem>
                      <SelectItem value="general_expenses">{t("generalExpenses")}</SelectItem>
                      <SelectItem value="cost_of_goods_sold">{t("costOfGoodsSold")}</SelectItem>
                      <SelectItem value="tds">{t("tds")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {expenseType && (
                  <div className="space-y-2 relative">
                    <Label>{t("receiverName")}</Label>
                    <Input
                      value={expenseReceiverName}
                      onChange={(e) => setExpenseReceiverName(e.target.value)}
                      onFocus={() => setShowReceiverSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowReceiverSuggestions(false), 150)}
                      placeholder={t("enterReceiverName") || "Enter receiver name"}
                      data-testid="input-expense-receiver"
                    />
                    {showReceiverSuggestions && receiverNames.length > 0 && (
                      <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md">
                        <ScrollArea className="max-h-[150px]">
                          {receiverNames
                            .filter(name => 
                              !expenseReceiverName || 
                              name.toLowerCase().includes(expenseReceiverName.toLowerCase())
                            )
                            .map((name) => (
                              <Button
                                key={name}
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  setExpenseReceiverName(name);
                                  setShowReceiverSuggestions(false);
                                }}
                                data-testid={`suggestion-receiver-${name}`}
                              >
                                {name}
                              </Button>
                            ))}
                        </ScrollArea>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label>{t("amount")} (₹) *</Label>
                  <Input
                    type="number"
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(e.target.value)}
                    placeholder="0"
                    min={1}
                    data-testid="input-expense-amount"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    {t("paidOn")}
                  </Label>
                  <Input
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    data-testid="input-expense-date"
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t("remarks")}</Label>
                  <Input
                    value={expenseRemarks}
                    onChange={(e) => setExpenseRemarks(e.target.value)}
                    placeholder={t("remarks")}
                    data-testid="input-expense-remarks"
                  />
                </div>

                <Button
                  onClick={handleExpenseSubmit}
                  disabled={!canEdit || !expenseType || !expenseAmount || createExpenseMutation.isPending}
                  className="w-full"
                  data-testid="button-record-expense"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {createExpenseMutation.isPending ? t("saving") : t("recordExpense")}
                </Button>
                {!canEdit && (
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    {t("viewOnlyAccess") || "View-only access. Contact admin for edit permissions."}
                  </p>
                )}
                  </>
                )}
              </>
            ) : activeTab === "self" ? (
              <>
                {/* Transfer Type Selection */}
                <div className="space-y-2">
                  <Label>{t("transferType")} *</Label>
                  <Select value={transferTypeMode} onValueChange={(v) => setTransferTypeMode(v as "internal" | "buyer")}>
                    <SelectTrigger data-testid="select-transfer-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="internal">{t("internalTransfer")}</SelectItem>
                      <SelectItem value="buyer">{t("buyerToBuyer")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {transferTypeMode === "internal" ? (
                  <>
                    <div className="space-y-2">
                      <Label>{t("fromAccount")} *</Label>
                      <Select value={transferFromAccount} onValueChange={(v) => setTransferFromAccount(v as "cash" | "limit" | "current")}>
                        <SelectTrigger data-testid="select-transfer-from">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash">
                            <span className="flex items-center gap-2">
                              <Banknote className="h-4 w-4" />
                              {t("cashInHand")}
                            </span>
                          </SelectItem>
                          <SelectItem value="limit">
                            <span className="flex items-center gap-2">
                              <Building2 className="h-4 w-4" />
                              {t("limitAccount")}
                            </span>
                          </SelectItem>
                          <SelectItem value="current">
                            <span className="flex items-center gap-2">
                              <Wallet className="h-4 w-4" />
                              {t("currentAccount")}
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>{t("toAccount")} *</Label>
                      <Select value={transferToAccount} onValueChange={(v) => setTransferToAccount(v as "cash" | "limit" | "current")}>
                        <SelectTrigger data-testid="select-transfer-to">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash">
                            <span className="flex items-center gap-2">
                              <Banknote className="h-4 w-4" />
                              {t("cashInHand")}
                            </span>
                          </SelectItem>
                          <SelectItem value="limit">
                            <span className="flex items-center gap-2">
                              <Building2 className="h-4 w-4" />
                              {t("limitAccount")}
                            </span>
                          </SelectItem>
                          <SelectItem value="current">
                            <span className="flex items-center gap-2">
                              <Wallet className="h-4 w-4" />
                              {t("currentAccount")}
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {transferFromAccount === transferToAccount && (
                      <p className="text-xs text-red-500">{t("sameAccountError")}</p>
                    )}

                    <div className="space-y-2">
                      <Label>{t("amount")} (₹) *</Label>
                      <Input
                        type="number"
                        value={transferAmount}
                        onChange={(e) => setTransferAmount(e.target.value)}
                        placeholder="0"
                        min={1}
                        data-testid="input-transfer-amount"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        {t("transferDate")}
                      </Label>
                      <Input
                        type="date"
                        value={transferDate}
                        onChange={(e) => setTransferDate(e.target.value)}
                        data-testid="input-transfer-date"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>{t("remarks")}</Label>
                      <Input
                        value={transferRemarks}
                        onChange={(e) => setTransferRemarks(e.target.value)}
                        placeholder={t("remarks")}
                        data-testid="input-transfer-remarks"
                      />
                    </div>

                    <Button
                      onClick={handleTransferSubmit}
                      disabled={!canEdit || !transferAmount || transferFromAccount === transferToAccount || createTransferMutation.isPending}
                      className="w-full bg-blue-600 hover:bg-blue-700"
                      data-testid="button-record-transfer"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {createTransferMutation.isPending ? t("saving") : t("recordTransfer")}
                    </Button>
                    {!canEdit && (
                      <p className="text-xs text-muted-foreground text-center mt-2">
                        {t("viewOnlyAccess") || "View-only access. Contact admin for edit permissions."}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    {/* Buyer-to-Buyer Transfer Form */}
                    <div className="space-y-2">
                      <Label>{t("fromBuyer")} *</Label>
                      <Select value={buyerTransferFrom} onValueChange={(v) => {
                        setBuyerTransferFrom(v);
                        setSelectedSaleId("");
                        setBuyerTransferAmount("");
                      }}>
                        <SelectTrigger data-testid="select-buyer-from">
                          <SelectValue placeholder={t("selectBuyer")} />
                        </SelectTrigger>
                        <SelectContent>
                          {buyersWithDues.filter(b => b.totalDue > 0).map((buyer) => (
                            <SelectItem key={buyer.buyerName} value={buyer.buyerName}>
                              {buyer.buyerName} (₹{buyer.totalDue.toLocaleString()})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {buyerTransferFrom && (
                      <div className="space-y-2">
                        <Label>{t("selectSale")} *</Label>
                        <Select value={selectedSaleId} onValueChange={(v) => {
                          setSelectedSaleId(v);
                          const sale = buyerSalesWithDues.find(s => s.id === v);
                          if (sale) {
                            setBuyerTransferAmount(sale.dueAmount?.toString() || "");
                          }
                        }}>
                          <SelectTrigger data-testid="select-sale">
                            <SelectValue placeholder={t("selectSale")} />
                          </SelectTrigger>
                          <SelectContent>
                            {buyerSalesWithDues.filter(s => (s.dueAmount || 0) > 0).map((sale) => (
                              <SelectItem key={sale.id} value={sale.id}>
                                {sale.farmerName} - {formatBagType(sale.bagType)}, {t("lot")} {sale.lotNo}, {sale.quantitySold} {t("bags")} (₹{sale.dueAmount?.toLocaleString()})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>{t("toBuyer")} *</Label>
                      <Select value={buyerTransferTo} onValueChange={setBuyerTransferTo}>
                        <SelectTrigger data-testid="select-buyer-to">
                          <SelectValue placeholder={t("selectBuyer")} />
                        </SelectTrigger>
                        <SelectContent>
                          {allBuyers.filter(b => b.buyerName !== buyerTransferFrom).map((buyer) => (
                            <SelectItem key={buyer.buyerName} value={buyer.buyerName}>
                              {buyer.buyerName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>{t("transferAmount")} (₹) *</Label>
                      <Input
                        type="number"
                        value={buyerTransferAmount}
                        readOnly
                        className="bg-muted cursor-not-allowed"
                        placeholder="0"
                        data-testid="input-buyer-transfer-amount"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        {t("transferDate")}
                      </Label>
                      <Input
                        type="date"
                        value={buyerTransferDate}
                        onChange={(e) => setBuyerTransferDate(e.target.value)}
                        data-testid="input-buyer-transfer-date"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>{t("remarks")}</Label>
                      <Input
                        value={buyerTransferRemarks}
                        onChange={(e) => setBuyerTransferRemarks(e.target.value)}
                        placeholder={t("remarks")}
                        data-testid="input-buyer-transfer-remarks"
                      />
                    </div>

                    <Button
                      onClick={handleBuyerTransferSubmit}
                      disabled={!canEdit || !buyerTransferFrom || !buyerTransferTo || !selectedSaleId || !buyerTransferAmount || createBuyerTransferMutation.isPending}
                      className="w-full bg-purple-600 hover:bg-purple-700"
                      data-testid="button-record-buyer-transfer"
                    >
                      <ArrowLeftRight className="h-4 w-4 mr-2" />
                      {createBuyerTransferMutation.isPending ? t("saving") : t("transferDebt")}
                    </Button>
                    {!canEdit && (
                      <p className="text-xs text-muted-foreground text-center mt-2">
                        {t("viewOnlyAccess") || "View-only access. Contact admin for edit permissions."}
                      </p>
                    )}
                  </>
                )}
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card className="flex flex-col overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-lg">{t("cashFlowHistory")}</CardTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleExportCashFlowCSV(allTransactions)}
              title={t("downloadCSV") || "Download CSV"}
              data-testid="button-download-cash-flow-csv"
            >
              <Download className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="p-0 overflow-hidden">
            {isLoading ? (
              <div className="text-sm text-muted-foreground p-4">{t("loading")}</div>
            ) : allTransactions.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8 px-4">{t("noTransactions")}</div>
            ) : (
              <div className="h-[520px] overflow-y-auto">
                <div className="space-y-2 px-4 py-2">
                  {allTransactions.map((transaction, index) => {
                    const isReversed = transaction.type !== "buyerTransfer" && (transaction.data as CashReceipt | Expense | CashTransfer).isReversed === 1;
                    return (
                      <div
                        key={`${transaction.type}-${transaction.data.id}`}
                        className={`p-2 rounded-lg cursor-pointer transition-all hover-elevate ${
                          isReversed
                            ? "bg-gray-100 dark:bg-gray-900/50 border border-gray-300 dark:border-gray-700 opacity-60"
                            : transaction.type === "inflow" 
                              ? "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900" 
                              : transaction.type === "outflow"
                                ? "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900"
                                : transaction.type === "buyerTransfer"
                                  ? "bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900"
                                  : transaction.type === "discount"
                                    ? "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900"
                                    : "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900"
                        }`}
                        onClick={() => setSelectedTransaction(transaction)}
                        data-testid={`transaction-${transaction.type}-${index}`}
                      >
                        {/* Row 1: Name/Type + Amount + Status */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {transaction.type === "inflow" ? (
                              <ArrowDownLeft className={`h-4 w-4 flex-shrink-0 ${isReversed ? "text-gray-400" : "text-green-600"}`} />
                            ) : transaction.type === "outflow" ? (
                              <ArrowUpRight className={`h-4 w-4 flex-shrink-0 ${isReversed ? "text-gray-400" : "text-red-600"}`} />
                            ) : transaction.type === "buyerTransfer" ? (
                              <ArrowLeftRight className={`h-4 w-4 flex-shrink-0 ${isReversed ? "text-gray-400" : "text-purple-600"}`} />
                            ) : transaction.type === "discount" ? (
                              <ArrowUpRight className={`h-4 w-4 flex-shrink-0 ${isReversed ? "text-gray-400" : "text-amber-600"}`} />
                            ) : (
                              <ArrowLeftRight className={`h-4 w-4 flex-shrink-0 ${isReversed ? "text-gray-400" : "text-blue-600"}`} />
                            )}
                            <span className={`text-sm font-medium truncate ${isReversed ? "line-through text-gray-500" : ""}`}>
                              {transaction.type === "inflow" 
                                ? ((transaction.data as CashReceipt).buyerName || getPayerTypeLabel((transaction.data as CashReceipt).payerType))
                                : transaction.type === "outflow"
                                  ? getExpenseTypeLabel((transaction.data as Expense).expenseType)
                                  : transaction.type === "buyerTransfer"
                                    ? `${(transaction.data as SalesHistory).buyerName} → ${(transaction.data as SalesHistory).transferToBuyerName}`
                                    : transaction.type === "discount"
                                      ? (transaction.data as Discount).farmerName
                                      : `${getAccountLabel((transaction.data as CashTransfer).fromAccountType)} → ${getAccountLabel((transaction.data as CashTransfer).toAccountType)}`
                              }
                            </span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 min-w-fit">
                            <span className={`font-semibold text-sm whitespace-nowrap ${
                              isReversed 
                                ? "text-gray-400" 
                                : transaction.type === "inflow" ? "text-green-600" 
                                : transaction.type === "outflow" ? "text-red-600" 
                                : transaction.type === "buyerTransfer" ? "text-purple-600" 
                                : transaction.type === "discount" ? "text-amber-600"
                                : "text-blue-600"
                            }`}>
                              {transaction.type === "inflow" ? "+" : transaction.type === "outflow" || transaction.type === "discount" ? "-" : ""}₹{
                                transaction.type === "buyerTransfer" 
                                  ? ((transaction.data as SalesHistory).dueAmount || 0).toLocaleString()
                                  : transaction.type === "discount"
                                  ? (transaction.data as Discount).totalAmount.toLocaleString()
                                  : (transaction.data as CashReceipt | Expense | CashTransfer).amount.toLocaleString()
                              }
                            </span>
                            {isReversed ? (
                              <Badge variant="secondary" className="text-xs">{t("reversed")}</Badge>
                            ) : (
                              <Badge 
                                variant={transaction.type === "inflow" ? "default" : transaction.type === "outflow" ? "destructive" : "outline"} 
                                className={`text-xs ${
                                  transaction.type === "transfer" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" 
                                  : transaction.type === "buyerTransfer" ? "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300" 
                                  : transaction.type === "discount" ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" 
                                  : ""
                                }`}
                              >
                                {transaction.type === "inflow" ? t("inflow") : transaction.type === "outflow" ? t("outflow") : transaction.type === "buyerTransfer" ? t("buyerToBuyer") : transaction.type === "discount" ? (t("discount") || "Discount") : t("transfer")}
                              </Badge>
                            )}
                          </div>
                        </div>
                        {/* Row 2: Date + Payment Mode */}
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <span>{format(new Date(transaction.timestamp), "dd/MM/yyyy")}</span>
                          {transaction.type !== "transfer" && transaction.type !== "buyerTransfer" && transaction.type !== "discount" && (
                            <Badge variant="outline" className="text-xs py-0 h-5">
                              {transaction.type === "inflow" 
                                ? ((transaction.data as CashReceipt).receiptType === "cash" 
                                    ? t("cash") 
                                    : `${t("account")} (${(transaction.data as CashReceipt).accountType === "limit" ? t("limitAccount") : t("currentAccount")})`)
                                : ((transaction.data as Expense).paymentMode === "cash" 
                                    ? t("cash") 
                                    : `${t("account")} (${(transaction.data as Expense).accountType === "limit" ? t("limitAccount") : t("currentAccount")})`)
                              }
                            </Badge>
                          )}
                          {transaction.type === "buyerTransfer" && (
                            <span className="text-purple-600">
                              {t("lot")} {(transaction.data as SalesHistory).lotNo}
                            </span>
                          )}
                          {transaction.type === "discount" && (
                            <span className="text-amber-600">
                              {(transaction.data as Discount).village}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Transaction Detail Dialog */}
      <Dialog open={!!selectedTransaction} onOpenChange={(open) => !open && setSelectedTransaction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedTransaction?.type === "inflow" ? (
                <>
                  <ArrowDownLeft className="h-5 w-5 text-green-600" />
                  {t("paymentDetails")}
                </>
              ) : selectedTransaction?.type === "outflow" ? (
                <>
                  <ArrowUpRight className="h-5 w-5 text-red-600" />
                  {t("expenseDetails")}
                </>
              ) : selectedTransaction?.type === "buyerTransfer" ? (
                <>
                  <ArrowLeftRight className="h-5 w-5 text-purple-600" />
                  {t("buyerToBuyer")}
                </>
              ) : selectedTransaction?.type === "discount" ? (
                <>
                  <ArrowUpRight className="h-5 w-5 text-amber-600" />
                  {t("discountDetails") || "Discount Details"}
                </>
              ) : (
                <>
                  <ArrowLeftRight className="h-5 w-5 text-blue-600" />
                  {t("transferDetails")}
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {t("transactionDetailsDescription")}
            </DialogDescription>
          </DialogHeader>
          
          {selectedTransaction && (
            <div className="space-y-4">
              {/* Status Badge */}
              <div className="flex flex-col items-center gap-1">
                {selectedTransaction.type !== "buyerTransfer" && selectedTransaction.type !== "discount" && (selectedTransaction.data as CashReceipt | Expense | CashTransfer).isReversed === 1 ? (
                  <>
                    <Badge variant="secondary" className="text-base px-4 py-1">
                      {t("reversed")}
                    </Badge>
                    {(selectedTransaction.data as CashReceipt | Expense).reversedAt && (
                      <span className="text-xs text-muted-foreground">
                        {format(new Date((selectedTransaction.data as CashReceipt | Expense).reversedAt!), "dd/MM/yyyy")}
                      </span>
                    )}
                  </>
                ) : (
                  <Badge 
                    variant={selectedTransaction.type === "inflow" ? "default" : selectedTransaction.type === "outflow" ? "destructive" : "outline"}
                    className={`text-base px-4 py-1 ${
                      selectedTransaction.type === "transfer" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" 
                      : selectedTransaction.type === "buyerTransfer" ? "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300" 
                      : selectedTransaction.type === "discount" ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" 
                      : ""
                    }`}
                  >
                    {t("active")}
                  </Badge>
                )}
              </div>

              {/* Transaction Details */}
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                {selectedTransaction.type === "inflow" ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("buyerName")}:</span>
                      <span className="font-medium">{(selectedTransaction.data as CashReceipt).buyerName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("amount")}:</span>
                      <span className="font-bold text-green-600">₹{selectedTransaction.data.amount.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("paymentMode")}:</span>
                      <Badge variant="outline">
                        {(selectedTransaction.data as CashReceipt).receiptType === "cash" ? t("cash") : t("account")}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Date:</span>
                      <span>{format(new Date(selectedTransaction.timestamp), "dd/MM/yyyy")}</span>
                    </div>
                    {(selectedTransaction.data as CashReceipt).notes && (
                      <div className="pt-2 border-t">
                        <span className="text-muted-foreground text-sm">{t("notes")}:</span>
                        <p className="text-sm mt-1">{(selectedTransaction.data as CashReceipt).notes}</p>
                      </div>
                    )}
                  </>
                ) : selectedTransaction.type === "outflow" ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("expenseType")}:</span>
                      <span className="font-medium">{getExpenseTypeLabel((selectedTransaction.data as Expense).expenseType)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("amount")}:</span>
                      <span className="font-bold text-red-600">₹{selectedTransaction.data.amount.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("paymentMode")}:</span>
                      <Badge variant="outline">
                        {(selectedTransaction.data as Expense).paymentMode === "cash" 
                          ? t("cash") 
                          : `${t("account")} (${(selectedTransaction.data as Expense).accountType === "limit" ? t("limitAccount") : t("currentAccount")})`}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Date:</span>
                      <span>{format(new Date(selectedTransaction.timestamp), "dd/MM/yyyy")}</span>
                    </div>
                    {(selectedTransaction.data as Expense).remarks && (
                      <div className="pt-2 border-t">
                        <span className="text-muted-foreground text-sm">{t("remarks")}:</span>
                        <p className="text-sm mt-1">{(selectedTransaction.data as Expense).remarks}</p>
                      </div>
                    )}
                  </>
                ) : selectedTransaction.type === "buyerTransfer" ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("fromBuyer")}:</span>
                      <span className="font-medium">{(selectedTransaction.data as SalesHistory).buyerName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("toBuyer")}:</span>
                      <span className="font-medium">{(selectedTransaction.data as SalesHistory).transferToBuyerName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("lotInfo")}:</span>
                      <span>
                        {formatBagType((selectedTransaction.data as SalesHistory).bagType)}, {t("lot")} {(selectedTransaction.data as SalesHistory).lotNo}, {(selectedTransaction.data as SalesHistory).quantitySold} {t("bags")}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("liabilityTransferred")}:</span>
                      <span className="font-bold text-purple-600">₹{((selectedTransaction.data as SalesHistory).dueAmount || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Date:</span>
                      <span>{format(new Date(selectedTransaction.timestamp), "dd/MM/yyyy")}</span>
                    </div>
                    {(selectedTransaction.data as SalesHistory).transferRemarks && (
                      <div className="pt-2 border-t">
                        <span className="text-muted-foreground text-sm">{t("remarks")}:</span>
                        <p className="text-sm mt-1">{(selectedTransaction.data as SalesHistory).transferRemarks}</p>
                      </div>
                    )}
                  </>
                ) : selectedTransaction.type === "discount" ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("farmerName")}:</span>
                      <span className="font-medium">{(selectedTransaction.data as Discount).farmerName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("village")}:</span>
                      <span className="font-medium">{(selectedTransaction.data as Discount).village}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("amount")}:</span>
                      <span className="font-bold text-amber-600">₹{(selectedTransaction.data as Discount).totalAmount.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("date")}:</span>
                      <span>{format(new Date(selectedTransaction.timestamp), "dd/MM/yyyy")}</span>
                    </div>
                    {/* Buyer Allocations */}
                    <div className="pt-2 border-t">
                      <span className="font-medium text-sm">{t("buyerAllocations")}:</span>
                      <div className="mt-2 space-y-2 bg-amber-50 dark:bg-amber-900/20 rounded-md p-2">
                        {(() => {
                          try {
                            const allocations = JSON.parse((selectedTransaction.data as Discount).buyerAllocations);
                            return allocations.map((alloc: { buyerName: string; amount: number }, idx: number) => (
                              <div key={idx} className="flex justify-between text-sm py-1 border-b border-amber-200 dark:border-amber-800 last:border-0">
                                <span className="font-medium">{alloc.buyerName}</span>
                                <span className="font-bold text-amber-700 dark:text-amber-400">₹{alloc.amount.toLocaleString()}</span>
                              </div>
                            ));
                          } catch {
                            return null;
                          }
                        })()}
                      </div>
                    </div>
                    {(selectedTransaction.data as Discount).remarks && (
                      <div className="pt-2 border-t">
                        <span className="text-muted-foreground text-sm">{t("remarks")}:</span>
                        <p className="text-sm mt-1">{(selectedTransaction.data as Discount).remarks}</p>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("fromAccount")}:</span>
                      <Badge variant="outline">
                        {getAccountLabel((selectedTransaction.data as CashTransfer).fromAccountType)}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("toAccount")}:</span>
                      <Badge variant="outline">
                        {getAccountLabel((selectedTransaction.data as CashTransfer).toAccountType)}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("amount")}:</span>
                      <span className="font-bold text-blue-600">₹{(selectedTransaction.data as CashTransfer).amount.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Date:</span>
                      <span>{format(new Date(selectedTransaction.timestamp), "dd/MM/yyyy")}</span>
                    </div>
                    {(selectedTransaction.data as CashTransfer).remarks && (
                      <div className="pt-2 border-t">
                        <span className="text-muted-foreground text-sm">{t("remarks")}:</span>
                        <p className="text-sm mt-1">{(selectedTransaction.data as CashTransfer).remarks}</p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Reverse Button */}
              {canEdit && selectedTransaction.type !== "buyerTransfer" && (selectedTransaction.data as CashReceipt | Expense | CashTransfer).isReversed !== 1 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" className="w-full" data-testid="button-reverse-from-dialog">
                      <RotateCcw className="h-4 w-4 mr-2" />
                      {t("reverseEntry")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("confirmReverse")}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("reverseWarning")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          if (selectedTransaction.type === "inflow") {
                            reverseReceiptMutation.mutate(selectedTransaction.data.id);
                          } else if (selectedTransaction.type === "outflow") {
                            reverseExpenseMutation.mutate(selectedTransaction.data.id);
                          } else if (selectedTransaction.type === "discount") {
                            reverseDiscountMutation.mutate(selectedTransaction.data.id);
                          } else {
                            reverseTransferMutation.mutate(selectedTransaction.data.id);
                          }
                          setSelectedTransaction(null);
                        }}
                        data-testid="button-confirm-reverse-dialog"
                      >
                        {t("reverse")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              {t("startOfYearSettings")}
            </DialogTitle>
            <DialogDescription>
              {t("configureOpeningBalances")}
            </DialogDescription>
          </DialogHeader>

          {/* Year Selector */}
          <div className="flex items-center gap-2 mb-4">
            <Label>{t("year")}:</Label>
            <Select value={settingsYear.toString()} onValueChange={(v) => setSettingsYear(parseInt(v))}>
              <SelectTrigger className="w-32" data-testid="select-settings-year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[currentYear, currentYear - 1, currentYear - 2].map((y) => (
                  <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Settings Tabs */}
          <Tabs value={settingsTab} onValueChange={(v) => setSettingsTab(v as "balances" | "receivables")} className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-blue-50 dark:bg-blue-900/20">
              <TabsTrigger value="balances" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white" data-testid="tab-opening-balances">
                {t("openingBalances")}
              </TabsTrigger>
              <TabsTrigger value="receivables" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white" data-testid="tab-receivables">
                {t("receivables")}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Opening Balances Tab Content */}
          {settingsTab === "balances" && (
            <div className="space-y-4 mt-4">
              <div className="grid gap-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label>{t("cashInHand")}</Label>
                    <Input
                      type="number"
                      value={openingCashInHand || (openingBalance?.cashInHand?.toString() ?? "")}
                      onChange={(e) => setOpeningCashInHand(e.target.value)}
                      placeholder="0"
                      data-testid="input-opening-cash"
                    />
                  </div>
                  <div>
                    <Label>{t("limitAccount")}</Label>
                    <Input
                      type="number"
                      value={openingLimitBalance || (openingBalance?.limitBalance?.toString() ?? "")}
                      onChange={(e) => setOpeningLimitBalance(e.target.value)}
                      placeholder="0"
                      data-testid="input-opening-limit"
                    />
                  </div>
                  <div>
                    <Label>{t("currentAccount")}</Label>
                    <Input
                      type="number"
                      value={openingCurrentBalance || (openingBalance?.currentBalance?.toString() ?? "")}
                      onChange={(e) => setOpeningCurrentBalance(e.target.value)}
                      placeholder="0"
                      data-testid="input-opening-current"
                    />
                  </div>
                </div>
                <Button
                  onClick={() => {
                    saveOpeningBalanceMutation.mutate({
                      year: settingsYear,
                      cashInHand: parseFloat(openingCashInHand || openingBalance?.cashInHand?.toString() || "0") || 0,
                      limitBalance: parseFloat(openingLimitBalance || openingBalance?.limitBalance?.toString() || "0") || 0,
                      currentBalance: parseFloat(openingCurrentBalance || openingBalance?.currentBalance?.toString() || "0") || 0,
                    });
                  }}
                  disabled={saveOpeningBalanceMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                  data-testid="button-save-opening-balances"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {saveOpeningBalanceMutation.isPending ? t("saving") : t("saveOpeningBalances")}
                </Button>
              </div>
            </div>
          )}

          {/* Receivables Tab Content */}
          {settingsTab === "receivables" && (
            <div className="space-y-4 mt-4">
              {/* Add new receivable form */}
              <Card>
                <CardHeader className="py-2">
                  <CardTitle className="text-sm">{t("addReceivable")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">{t("payerType")}</Label>
                      <Select value={newReceivablePayerType} onValueChange={(v) => {
                        setNewReceivablePayerType(v);
                        setShowBuyerSuggestions(false);
                      }}>
                        <SelectTrigger data-testid="select-receivable-payer-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cold_merchant">{t("coldMerchant")}</SelectItem>
                          <SelectItem value="sales_goods">{t("salesGoods")}</SelectItem>
                          <SelectItem value="kata">{t("kata")}</SelectItem>
                          <SelectItem value="others">{t("others")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="relative">
                      <Label className="text-xs">{t("buyerName")}</Label>
                      <Input
                        value={newReceivableBuyerName}
                        onChange={(e) => setNewReceivableBuyerName(e.target.value)}
                        onFocus={() => {
                          if (newReceivablePayerType !== "sales_goods") {
                            setShowBuyerSuggestions(true);
                          }
                        }}
                        onBlur={() => {
                          setTimeout(() => setShowBuyerSuggestions(false), 150);
                        }}
                        placeholder={newReceivablePayerType === "sales_goods" ? t("enterManually") : t("selectOrEnter")}
                        data-testid="input-receivable-buyer"
                      />
                      {showBuyerSuggestions && newReceivablePayerType !== "sales_goods" && (
                        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md">
                          <ScrollArea className="max-h-[200px]">
                            {buyersWithDues.filter(b => 
                              !newReceivableBuyerName || 
                              b.buyerName.toLowerCase().includes(newReceivableBuyerName.toLowerCase())
                            ).length === 0 ? (
                              <p className="text-sm text-muted-foreground p-2 text-center">{t("noResults")}</p>
                            ) : (
                              buyersWithDues
                                .filter(b => 
                                  !newReceivableBuyerName || 
                                  b.buyerName.toLowerCase().includes(newReceivableBuyerName.toLowerCase())
                                )
                                .map((b) => (
                                  <Button
                                    key={b.buyerName}
                                    variant="ghost"
                                    size="sm"
                                    className="w-full justify-start"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      setNewReceivableBuyerName(b.buyerName);
                                      setShowBuyerSuggestions(false);
                                    }}
                                    data-testid={`suggestion-buyer-${b.buyerName}`}
                                  >
                                    {b.buyerName}
                                  </Button>
                                ))
                            )}
                          </ScrollArea>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">{t("amount")}</Label>
                      <Input
                        type="number"
                        value={newReceivableAmount}
                        onChange={(e) => setNewReceivableAmount(e.target.value)}
                        placeholder="0"
                        data-testid="input-receivable-amount"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">{t("remarks")}</Label>
                      <Input
                        value={newReceivableRemarks}
                        onChange={(e) => setNewReceivableRemarks(e.target.value)}
                        placeholder={t("optional")}
                        data-testid="input-receivable-remarks"
                      />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      if (!newReceivableAmount || parseFloat(newReceivableAmount) <= 0) {
                        toast({ title: t("error"), description: t("amountRequired"), variant: "destructive" });
                        return;
                      }
                      createReceivableMutation.mutate({
                        year: settingsYear,
                        payerType: newReceivablePayerType,
                        buyerName: newReceivableBuyerName || undefined,
                        dueAmount: parseFloat(newReceivableAmount),
                        remarks: newReceivableRemarks || undefined,
                      });
                    }}
                    disabled={createReceivableMutation.isPending}
                    className="w-full bg-blue-600 hover:bg-blue-700"
                    data-testid="button-add-receivable"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    {createReceivableMutation.isPending ? t("adding") : t("add")}
                  </Button>
                </CardContent>
              </Card>

              {/* List of receivables */}
              <ScrollArea className="h-48">
                {openingReceivables.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">{t("noReceivables")}</p>
                ) : (
                  <div className="space-y-2">
                    {openingReceivables.map((r) => (
                      <div key={r.id} className="flex items-center justify-between p-2 bg-muted rounded-md">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">{t(r.payerType)}</Badge>
                            {r.buyerName && <span className="text-sm font-medium">{r.buyerName}</span>}
                          </div>
                          {r.remarks && <p className="text-xs text-muted-foreground">{r.remarks}</p>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-green-600">₹{r.dueAmount.toLocaleString()}</span>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteReceivableMutation.mutate(r.id)}
                            data-testid={`button-delete-receivable-${r.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          )}

        </DialogContent>
      </Dialog>
    </div>
  );
}
