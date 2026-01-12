import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Banknote, CreditCard, Calendar, Save, ArrowDownLeft, ArrowUpRight, Wallet, Building2, Filter, X, RotateCcw } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
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
  
  const [activeTab, setActiveTab] = useState<"inward" | "expense">("inward");
  
  const [buyerName, setBuyerName] = useState("");
  const [customBuyerName, setCustomBuyerName] = useState("");
  const [receiptType, setReceiptType] = useState<"cash" | "account">("cash");
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

  const { data: buyersWithDues = [], isLoading: loadingBuyers } = useQuery<BuyerWithDue[]>({
    queryKey: ["/api/cash-receipts/buyers-with-dues"],
  });

  const { data: receipts = [], isLoading: loadingReceipts } = useQuery<CashReceipt[]>({
    queryKey: ["/api/cash-receipts"],
  });

  const { data: expensesList = [], isLoading: loadingExpenses } = useQuery<Expense[]>({
    queryKey: ["/api/expenses"],
  });

  const createReceiptMutation = useMutation({
    mutationFn: async (data: { buyerName: string; receiptType: string; amount: number; receivedAt: string; notes?: string }) => {
      const response = await apiRequest("POST", "/api/cash-receipts", data);
      return response.json();
    },
    onSuccess: (result: { receipt: CashReceipt; salesUpdated: number }) => {
      toast({
        title: t("success"),
        description: `${t("paymentRecorded")} - ${result.salesUpdated} ${t("salesAdjusted")}`,
      });
      setBuyerName("");
      setCustomBuyerName("");
      setInwardAmount("");
      setReceivedDate(format(new Date(), "yyyy-MM-dd"));
      setInwardRemarks("");
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts/buyers-with-dues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
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
    },
    onError: () => {
      toast({ title: t("error"), description: t("reversalFailed"), variant: "destructive" });
    },
  });

  const handleInwardSubmit = () => {
    const finalBuyerName = buyerName === "__other__" ? customBuyerName.trim() : buyerName;
    
    if (!finalBuyerName || !inwardAmount || parseFloat(inwardAmount) <= 0) {
      toast({ title: t("error"), description: "Please fill all required fields", variant: "destructive" });
      return;
    }

    createReceiptMutation.mutate({
      buyerName: finalBuyerName,
      receiptType,
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

  const selectedBuyerDue = buyersWithDues.find(b => b.buyerName === buyerName)?.totalDue || 0;

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
      filteredReceipts = filteredReceipts.filter(r => r.buyerName === filterBuyer);
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
      // Secondary sort by ID (highest ID = most recent entry)
      return b.data.id - a.data.id;
    });
  }, [receipts, expensesList, filterBuyer, filterCategory, filterMonth]);

  const isLoading = loadingReceipts || loadingExpenses;

  const uniqueBuyers = useMemo(() => {
    const buyers = new Set(receipts.map(r => r.buyerName));
    return Array.from(buyers).sort();
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
      filteredReceipts = filteredReceipts.filter(r => r.buyerName === filterBuyer);
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
                  <Textarea
                    value={inwardRemarks}
                    onChange={(e) => setInwardRemarks(e.target.value)}
                    placeholder={t("remarks")}
                    className="resize-none"
                    rows={2}
                    data-testid="input-inward-remarks"
                  />
                </div>

                <Button
                  onClick={handleInwardSubmit}
                  disabled={!buyerName || (buyerName === "__other__" && !customBuyerName.trim()) || !inwardAmount || createReceiptMutation.isPending}
                  className="w-full"
                  data-testid="button-record-payment"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {createReceiptMutation.isPending ? t("saving") : t("recordPayment")}
                </Button>
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
                  <Textarea
                    value={expenseRemarks}
                    onChange={(e) => setExpenseRemarks(e.target.value)}
                    placeholder={t("remarks")}
                    className="resize-none"
                    rows={2}
                    data-testid="input-expense-remarks"
                  />
                </div>

                <Button
                  onClick={handleExpenseSubmit}
                  disabled={!expenseType || !expenseAmount || createExpenseMutation.isPending}
                  className="w-full"
                  data-testid="button-record-expense"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {createExpenseMutation.isPending ? t("saving") : t("recordExpense")}
                </Button>
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
                <div className="space-y-3">
                  {allTransactions.map((transaction, index) => {
                    const isReversed = transaction.data.isReversed === 1;
                    return (
                      <div
                        key={`${transaction.type}-${transaction.data.id}`}
                        className={`p-3 rounded-lg space-y-2 ${
                          isReversed
                            ? "bg-gray-100 dark:bg-gray-900/50 border border-gray-300 dark:border-gray-700 opacity-60"
                            : transaction.type === "inflow" 
                              ? "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900" 
                              : "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900"
                        }`}
                        data-testid={`transaction-${transaction.type}-${index}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`font-medium flex items-center gap-2 ${isReversed ? "line-through" : ""}`}>
                            {transaction.type === "inflow" ? (
                              <>
                                <ArrowDownLeft className={`h-4 w-4 ${isReversed ? "text-gray-400" : "text-green-600"}`} />
                                {(transaction.data as CashReceipt).buyerName}
                              </>
                            ) : (
                              <>
                                <ArrowUpRight className={`h-4 w-4 ${isReversed ? "text-gray-400" : "text-red-600"}`} />
                                {getExpenseTypeLabel((transaction.data as Expense).expenseType)}
                              </>
                            )}
                          </span>
                          <div className="flex items-center gap-2">
                            {isReversed ? (
                              <Badge variant="secondary">{t("reversed")}</Badge>
                            ) : (
                              <>
                                <Badge variant={transaction.type === "inflow" ? "default" : "destructive"}>
                                  {transaction.type === "inflow" ? t("inflow") : t("outflow")}
                                </Badge>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7"
                                      data-testid={`button-reverse-${transaction.type}-${index}`}
                                    >
                                      <RotateCcw className="h-4 w-4" />
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
                                          if (transaction.type === "inflow") {
                                            reverseReceiptMutation.mutate(transaction.data.id);
                                          } else {
                                            reverseExpenseMutation.mutate(transaction.data.id);
                                          }
                                        }}
                                        data-testid={`button-confirm-reverse-${index}`}
                                      >
                                        {t("reverse")}
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">
                            {format(new Date(transaction.timestamp), "dd/MM/yyyy")}
                          </span>
                          <span className={`font-semibold ${
                            isReversed 
                              ? "text-gray-400" 
                              : transaction.type === "inflow" ? "text-green-600" : "text-red-600"
                          }`}>
                            {transaction.type === "inflow" ? "+" : "-"}₹{transaction.data.amount.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <Badge variant="outline" className="text-xs">
                            {transaction.type === "inflow" 
                              ? ((transaction.data as CashReceipt).receiptType === "cash" ? t("cash") : t("account"))
                              : ((transaction.data as Expense).paymentMode === "cash" ? t("cash") : t("account"))
                            }
                          </Badge>
                          {transaction.type === "outflow" && (transaction.data as Expense).remarks && (
                            <span className="text-muted-foreground truncate">
                              {(transaction.data as Expense).remarks}
                            </span>
                          )}
                          {transaction.type === "inflow" && (transaction.data as CashReceipt).notes && (
                            <span className="text-muted-foreground truncate">
                              {(transaction.data as CashReceipt).notes}
                            </span>
                          )}
                          {transaction.type === "inflow" && !isReversed && (
                            <span className="text-green-600">
                              {t("appliedAmount")}: ₹{((transaction.data as CashReceipt).appliedAmount || 0).toLocaleString()}
                            </span>
                          )}
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
    </div>
  );
}
