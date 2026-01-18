import { useState, useMemo } from "react";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Banknote, CreditCard, Calendar, Save, ArrowDownLeft, ArrowUpRight, Wallet, Building2, Filter, X, RotateCcw } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { format } from "date-fns";
import type { CashReceipt, Expense } from "@shared/schema";

interface BuyerWithDue {
  buyerName: string;
  totalDue: number;
}

type TransactionItem = 
  | { type: "inflow"; data: CashReceipt; timestamp: number }
  | { type: "outflow"; data: Expense; timestamp: number };

export default function CashManagement() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { canEdit } = useAuth();
  
  const [activeTab, setActiveTab] = useState<"inward" | "expense">("inward");
  
  const [payerType, setPayerType] = useState<"cold_merchant" | "sales_goods" | "kata" | "others">("cold_merchant");
  const [buyerName, setBuyerName] = useState("");
  const [customBuyerName, setCustomBuyerName] = useState("");
  const [salesGoodsBuyerName, setSalesGoodsBuyerName] = useState("");
  const [receiptType, setReceiptType] = useState<"cash" | "account">("cash");
  const [accountType, setAccountType] = useState<"limit" | "current">("limit");
  const [inwardAmount, setInwardAmount] = useState("");
  const [receivedDate, setReceivedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [inwardRemarks, setInwardRemarks] = useState("");

  const [expenseType, setExpenseType] = useState<string>("");
  const [expensePaymentMode, setExpensePaymentMode] = useState<"cash" | "account">("cash");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [expenseRemarks, setExpenseRemarks] = useState("");

  const [filterBuyer, setFilterBuyer] = useState<string>("");
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [filterMonth, setFilterMonth] = useState<string>("");
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionItem | null>(null);

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

  const createReceiptMutation = useMutation({
    mutationFn: async (data: { payerType: string; buyerName?: string; receiptType: string; accountType?: string; amount: number; receivedAt: string; notes?: string }) => {
      const response = await apiRequest("POST", "/api/cash-receipts", data);
      return response.json();
    },
    onSuccess: (result: { receipt: CashReceipt; salesUpdated: number }) => {
      toast({
        title: t("success"),
        description: `${t("paymentRecorded")} - ${result.salesUpdated} ${t("salesAdjusted")}`,
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
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts/buyers-with-dues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts/sales-goods-buyers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/quality"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/merchants"] });
    },
    onError: () => {
      toast({ title: t("error"), description: "Failed to record payment", variant: "destructive" });
    },
  });

  const createExpenseMutation = useMutation({
    mutationFn: async (data: { expenseType: string; paymentMode: string; amount: number; paidAt: string; remarks?: string }) => {
      const response = await apiRequest("POST", "/api/expenses", data);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: t("success"),
        description: t("expenseRecorded"),
      });
      setExpenseType("");
      setExpenseAmount("");
      setExpenseDate(format(new Date(), "yyyy-MM-dd"));
      setExpenseRemarks("");
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
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
      });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts/buyers-with-dues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
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
      paymentMode: expensePaymentMode,
      amount: parseFloat(expenseAmount),
      paidAt: new Date(expenseDate).toISOString(),
      remarks: expenseRemarks || undefined,
    });
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

  // Filter and sort transactions for display (latest first)
  const allTransactions: TransactionItem[] = useMemo(() => {
    // Apply filters to receipts
    let filteredReceipts = receipts;
    if (filterBuyer) {
      const filterKey = filterBuyer.trim().toLowerCase();
      filteredReceipts = filteredReceipts.filter(r => r.buyerName && r.buyerName.trim().toLowerCase() === filterKey);
    }
    if (filterMonth) {
      filteredReceipts = filteredReceipts.filter(r => {
        const date = new Date(r.receivedAt);
        return format(date, "yyyy-MM") === filterMonth;
      });
    }

    // Apply filters to expenses
    let filteredExpenses = expensesList;
    if (filterCategory) {
      filteredExpenses = filteredExpenses.filter(e => e.expenseType === filterCategory);
    }
    if (filterMonth) {
      filteredExpenses = filteredExpenses.filter(e => {
        const date = new Date(e.paidAt);
        return format(date, "yyyy-MM") === filterMonth;
      });
    }

    // Combine and sort descending (latest first)
    // Use timestamp in milliseconds for reliable sorting, with ID as secondary sort key
    const getTimestamp = (dateStr: string | Date): number => {
      if (dateStr instanceof Date) return dateStr.getTime();
      const parsed = Date.parse(dateStr);
      return isNaN(parsed) ? new Date(dateStr).getTime() : parsed;
    };

    return [
      ...filteredReceipts.map(r => ({ 
        type: "inflow" as const, 
        data: r, 
        timestamp: getTimestamp(r.receivedAt)
      })),
      ...filteredExpenses.map(e => ({ 
        type: "outflow" as const, 
        data: e, 
        timestamp: getTimestamp(e.paidAt)
      })),
    ].sort((a, b) => {
      // Primary sort by timestamp (newest first)
      const timeDiff = b.timestamp - a.timestamp;
      if (timeDiff !== 0) return timeDiff;
      // Secondary sort by ID (string comparison for UUIDs)
      return String(b.data.id).localeCompare(String(a.data.id));
    });
  }, [receipts, expensesList, filterBuyer, filterCategory, filterMonth]);

  const isLoading = loadingReceipts || loadingExpenses;

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

  const hasActiveFilters = filterBuyer || filterCategory || filterMonth;

  const clearFilters = () => {
    setFilterBuyer("");
    setFilterCategory("");
    setFilterMonth("");
  };

  const summary = useMemo(() => {
    const activeReceipts = receipts.filter(r => r.isReversed !== 1);
    const activeExpenses = expensesList.filter(e => e.isReversed !== 1);

    const totalCashReceived = activeReceipts
      .filter(r => r.receiptType === "cash")
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    
    const totalAccountReceived = activeReceipts
      .filter(r => r.receiptType === "account")
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    
    const totalCashExpenses = activeExpenses
      .filter(e => e.paymentMode === "cash")
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    
    const totalAccountExpenses = activeExpenses
      .filter(e => e.paymentMode === "account")
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    
    const cashInHand = totalCashReceived - totalCashExpenses;

    return {
      totalCashReceived,
      totalAccountReceived,
      cashInHand,
      totalAccountExpenses,
      totalCashExpenses,
    };
  }, [receipts, expensesList]);

  const filteredSummary = useMemo(() => {
    let filteredReceipts = receipts.filter(r => r.isReversed !== 1);
    let filteredExpenses = expensesList.filter(e => e.isReversed !== 1);

    if (filterBuyer) {
      const filterKey = filterBuyer.trim().toLowerCase();
      filteredReceipts = filteredReceipts.filter(r => r.buyerName && r.buyerName.trim().toLowerCase() === filterKey);
    }

    if (filterCategory) {
      filteredExpenses = filteredExpenses.filter(e => e.expenseType === filterCategory);
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
    }

    const buyerCashReceived = filteredReceipts
      .filter(r => r.receiptType === "cash")
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    
    const buyerAccountReceived = filteredReceipts
      .filter(r => r.receiptType === "account")
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

    const categoryExpenses = filteredExpenses
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    return {
      buyerCashReceived,
      buyerAccountReceived,
      categoryExpenses,
    };
  }, [receipts, expensesList, filterBuyer, filterCategory, filterMonth]);

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Banknote className="h-6 w-6" />
        {t("cashManagement")}
      </h1>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Card data-testid="stat-total-cash-received">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Banknote className="h-4 w-4" />
              {t("totalCashReceived")}
            </div>
            <div className="text-xl font-bold text-green-600">
              {isLoading ? "..." : `₹${summary.totalCashReceived.toLocaleString()}`}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="stat-cash-expense">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <ArrowUpRight className="h-4 w-4" />
              {t("cashExpense")}
            </div>
            <div className="text-xl font-bold text-red-600">
              {isLoading ? "..." : `₹${summary.totalCashExpenses.toLocaleString()}`}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="stat-cash-in-hand">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Wallet className="h-4 w-4" />
              {t("totalCashInHand")}
            </div>
            <div className={`text-xl font-bold ${summary.cashInHand >= 0 ? "text-blue-600" : "text-red-600"}`}>
              {isLoading ? "..." : `₹${summary.cashInHand.toLocaleString()}`}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="stat-total-account-received">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Building2 className="h-4 w-4" />
              {t("totalAccountReceived")}
            </div>
            <div className="text-xl font-bold text-green-600">
              {isLoading ? "..." : `₹${summary.totalAccountReceived.toLocaleString()}`}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="stat-expense-from-account">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <CreditCard className="h-4 w-4" />
              {t("totalExpenseFromAccount")}
            </div>
            <div className="text-xl font-bold text-red-600">
              {isLoading ? "..." : `₹${summary.totalAccountExpenses.toLocaleString()}`}
            </div>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground mb-4 text-right">
        {t("asOf")}: {format(new Date(), "dd/MM/yyyy")}
      </p>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            {t("filters")}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="ml-auto h-7 text-xs"
                data-testid="button-clear-filters"
              >
                <X className="h-3 w-3 mr-1" />
                {t("clearFilters")}
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">{t("filterByBuyer")}</Label>
              <Select value={filterBuyer || "all"} onValueChange={(v) => setFilterBuyer(v === "all" ? "" : v)}>
                <SelectTrigger data-testid="select-filter-buyer">
                  <SelectValue placeholder={t("allBuyers")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allBuyers")}</SelectItem>
                  {uniqueBuyers.map((buyer) => (
                    <SelectItem key={buyer} value={buyer}>{buyer}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">{t("filterByCategory")}</Label>
              <Select value={filterCategory || "all"} onValueChange={(v) => setFilterCategory(v === "all" ? "" : v)}>
                <SelectTrigger data-testid="select-filter-category">
                  <SelectValue placeholder={t("allCategories")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allCategories")}</SelectItem>
                  <SelectItem value="salary">{t("salary")}</SelectItem>
                  <SelectItem value="hammali">{t("hammali")}</SelectItem>
                  <SelectItem value="grading_charges">{t("gradingCharges")}</SelectItem>
                  <SelectItem value="general_expenses">{t("generalExpenses")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">{t("filterByMonth")}</Label>
              <Select value={filterMonth || "all"} onValueChange={(v) => setFilterMonth(v === "all" ? "" : v)}>
                <SelectTrigger data-testid="select-filter-month">
                  <SelectValue placeholder={t("allMonths")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allMonths")}</SelectItem>
                  {availableMonths.map((month) => (
                    <SelectItem key={month} value={month}>
                      {format(new Date(month + "-01"), "MMMM yyyy")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {hasActiveFilters && (
            <div className="mt-4 p-3 bg-muted rounded-lg">
              <p className="text-sm font-medium mb-2">{t("filteredResults")}:</p>
              <div className="grid grid-cols-3 gap-4 text-sm">
                {filterBuyer && (
                  <>
                    <div>
                      <span className="text-muted-foreground">{t("cash")}:</span>
                      <span className="ml-1 font-semibold text-green-600">₹{filteredSummary.buyerCashReceived.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t("account")}:</span>
                      <span className="ml-1 font-semibold text-green-600">₹{filteredSummary.buyerAccountReceived.toLocaleString()}</span>
                    </div>
                  </>
                )}
                {(filterCategory || filterMonth) && (
                  <div>
                    <span className="text-muted-foreground">{t("expense")}:</span>
                    <span className="ml-1 font-semibold text-red-600">₹{filteredSummary.categoryExpenses.toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "inward" | "expense")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="inward" data-testid="tab-inward">
                  <ArrowDownLeft className="h-4 w-4 mr-1" />
                  {t("inwardCash")}
                </TabsTrigger>
                <TabsTrigger value="expense" data-testid="tab-expense">
                  <ArrowUpRight className="h-4 w-4 mr-1" />
                  {t("expense")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeTab === "inward" ? (
              <>
                <div className="space-y-2">
                  <Label>{t("receiptType")} *</Label>
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
            ) : (
              <>
                <div className="space-y-2">
                  <Label>{t("expenseType")} *</Label>
                  <Select value={expenseType} onValueChange={setExpenseType}>
                    <SelectTrigger data-testid="select-expense-type">
                      <SelectValue placeholder={t("selectExpenseType")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="salary">{t("salary")}</SelectItem>
                      <SelectItem value="hammali">{t("hammali")}</SelectItem>
                      <SelectItem value="grading_charges">{t("gradingCharges")}</SelectItem>
                      <SelectItem value="general_expenses">{t("generalExpenses")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t("paymentMode")} *</Label>
                  <Select value={expensePaymentMode} onValueChange={(v) => setExpensePaymentMode(v as "cash" | "account")}>
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
                    </SelectContent>
                  </Select>
                </div>

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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("cashFlowHistory")}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-sm text-muted-foreground">{t("loading")}</div>
            ) : allTransactions.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">{t("noTransactions")}</div>
            ) : (
              <ScrollArea className="h-[450px]">
                <div className="space-y-2">
                  {allTransactions.map((transaction, index) => {
                    const isReversed = transaction.data.isReversed === 1;
                    return (
                      <div
                        key={`${transaction.type}-${transaction.data.id}`}
                        className={`p-2 rounded-lg cursor-pointer transition-all hover-elevate ${
                          isReversed
                            ? "bg-gray-100 dark:bg-gray-900/50 border border-gray-300 dark:border-gray-700 opacity-60"
                            : transaction.type === "inflow" 
                              ? "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900" 
                              : "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900"
                        }`}
                        onClick={() => setSelectedTransaction(transaction)}
                        data-testid={`transaction-${transaction.type}-${index}`}
                      >
                        {/* Row 1: Name/Type + Amount + Status */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {transaction.type === "inflow" ? (
                              <ArrowDownLeft className={`h-4 w-4 flex-shrink-0 ${isReversed ? "text-gray-400" : "text-green-600"}`} />
                            ) : (
                              <ArrowUpRight className={`h-4 w-4 flex-shrink-0 ${isReversed ? "text-gray-400" : "text-red-600"}`} />
                            )}
                            <span className={`font-medium truncate ${isReversed ? "line-through text-gray-500" : ""}`}>
                              {transaction.type === "inflow" 
                                ? (transaction.data as CashReceipt).buyerName
                                : getExpenseTypeLabel((transaction.data as Expense).expenseType)
                              }
                            </span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className={`font-bold text-base ${
                              isReversed 
                                ? "text-gray-400" 
                                : transaction.type === "inflow" ? "text-green-600" : "text-red-600"
                            }`}>
                              {transaction.type === "inflow" ? "+" : "-"}₹{transaction.data.amount.toLocaleString()}
                            </span>
                            {isReversed ? (
                              <Badge variant="secondary" className="text-xs">{t("reversed")}</Badge>
                            ) : (
                              <Badge 
                                variant={transaction.type === "inflow" ? "default" : "destructive"} 
                                className="text-xs"
                              >
                                {transaction.type === "inflow" ? t("inflow") : t("outflow")}
                              </Badge>
                            )}
                          </div>
                        </div>
                        {/* Row 2: Date + Payment Mode */}
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <span>{format(new Date(transaction.timestamp), "dd/MM/yyyy")}</span>
                          <Badge variant="outline" className="text-xs py-0 h-5">
                            {transaction.type === "inflow" 
                              ? ((transaction.data as CashReceipt).receiptType === "cash" ? t("cash") : t("account"))
                              : ((transaction.data as Expense).paymentMode === "cash" ? t("cash") : t("account"))
                            }
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
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
              ) : (
                <>
                  <ArrowUpRight className="h-5 w-5 text-red-600" />
                  {t("expenseDetails")}
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {t("transactionDetailsDescription") || "Complete details of this transaction"}
            </DialogDescription>
          </DialogHeader>
          
          {selectedTransaction && (
            <div className="space-y-4">
              {/* Status Badge */}
              <div className="flex flex-col items-center gap-1">
                {selectedTransaction.data.isReversed === 1 ? (
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
                    variant={selectedTransaction.type === "inflow" ? "default" : "destructive"}
                    className="text-base px-4 py-1"
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
                ) : (
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
                        {(selectedTransaction.data as Expense).paymentMode === "cash" ? t("cash") : t("account")}
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
                )}
              </div>

              {/* Reverse Button */}
              {canEdit && selectedTransaction.data.isReversed !== 1 && (
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
                          } else {
                            reverseExpenseMutation.mutate(selectedTransaction.data.id);
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
    </div>
  );
}
