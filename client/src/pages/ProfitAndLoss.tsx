import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Download, TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import { authFetch } from "@/lib/queryClient";

interface PnLData {
  financialYear: string;
  period: { from: string; to: string };
  income: {
    coldStorageCharges: number;
    merchantExtras: number;
    otherIncome: number;
    total: number;
  };
  expenses: {
    byType: Record<string, number>;
    totalRevenue: number;
    depreciation: number;
    interestOnLiabilities: number;
    total: number;
  };
  netProfitOrLoss: number;
}

const EXPENSE_TYPE_LABELS: Record<string, { en: string; hi: string }> = {
  general_expenses: { en: "General Expenses", hi: "सामान्य व्यय" },
  salary: { en: "Salary", hi: "वेतन" },
  hammali: { en: "Hammali", hi: "हम्माली" },
  grading_charges: { en: "Grading Charges", hi: "ग्रेडिंग शुल्क" },
  tds: { en: "TDS", hi: "टीडीएस" },
  cost_of_goods_sold: { en: "Cost of Goods Sold", hi: "बिक्री की लागत" },
};

export default function ProfitAndLoss() {
  const { t, language } = useI18n();
  const { coldStorage } = useAuth();

  const currentFY = useMemo(() => {
    const now = new Date();
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return `${year}-${String(year + 1).slice(2)}`;
  }, []);

  const [selectedFY, setSelectedFY] = useState(currentFY);

  const fyOptions = useMemo(() => {
    const options: string[] = [];
    const now = new Date();
    const currentYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    for (let y = currentYear; y >= currentYear - 5; y--) {
      options.push(`${y}-${String(y + 1).slice(2)}`);
    }
    return options;
  }, []);

  const { data, isLoading, error } = useQuery<PnLData>({
    queryKey: ["/api/reports/pnl", selectedFY],
    queryFn: async () => {
      const res = await authFetch(`/api/reports/pnl/${selectedFY}`);
      if (!res.ok) throw new Error("Failed to fetch P&L");
      return res.json();
    },
    enabled: !!selectedFY,
  });

  const formatCurrency = (amount: number) => {
    return `₹${Math.abs(amount).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  const getExpenseTypeLabel = (type: string) => {
    const labels = EXPENSE_TYPE_LABELS[type];
    if (labels) return language === "hi" ? labels.hi : labels.en;
    return type;
  };

  const handleDownloadCSV = async () => {
    try {
      const res = await authFetch(`/api/reports/pnl/${selectedFY}?format=csv`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pnl_${selectedFY}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };

  const isProfit = (data?.netProfitOrLoss || 0) >= 0;

  return (
    <div className="container mx-auto p-4 max-w-4xl space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-pnl-title">
            {isProfit ? <TrendingUp className="h-6 w-6 text-green-600" /> : <TrendingDown className="h-6 w-6 text-red-600" />}
            {t("profitAndLoss")}
          </h1>
          {data && (
            <p className="text-sm text-muted-foreground mt-1" data-testid="text-pnl-period">
              {t("forThePeriod")} {data.period.from} — {data.period.to}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedFY} onValueChange={setSelectedFY}>
            <SelectTrigger className="w-[160px]" data-testid="select-pnl-fy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fyOptions.map(fy => (
                <SelectItem key={fy} value={fy}>FY {fy}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleDownloadCSV} data-testid="btn-download-pnl-csv">
            <Download className="h-4 w-4 mr-1" />
            {t("downloadCSV")}
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="py-8 text-center text-destructive">
            Failed to load P&L data
          </CardContent>
        </Card>
      )}

      {data && !isLoading && (
        <div className="space-y-6">
          <Card data-testid="card-income-section">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg text-green-700 dark:text-green-400">{t("income")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between items-center py-2 px-3 rounded bg-muted/30" data-testid="row-income-cs-charges">
                <span className="text-sm">{t("coldStorageCharges")}</span>
                <span className="text-sm font-medium">{formatCurrency(data.income.coldStorageCharges)}</span>
              </div>
              {(data.income.merchantExtras || 0) > 0 && (
                <div className="flex justify-between items-center py-2 px-3 rounded bg-muted/30" data-testid="row-income-merchant-extras">
                  <span className="text-sm">{t("merchantExtrasIncome")}</span>
                  <span className="text-sm font-medium">{formatCurrency(data.income.merchantExtras)}</span>
                </div>
              )}
              <div className="flex justify-between items-center py-2 px-3 rounded bg-muted/30" data-testid="row-income-other">
                <span className="text-sm">{t("otherIncome")}</span>
                <span className="text-sm font-medium">{formatCurrency(data.income.otherIncome)}</span>
              </div>
              <Separator />
              <div className="flex justify-between items-center font-bold text-green-700 dark:text-green-400 pt-1" data-testid="text-total-income">
                <span>{t("totalIncome")}</span>
                <span>{formatCurrency(data.income.total)}</span>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-expense-section">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg text-red-700 dark:text-red-400">{t("expenses")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {Object.entries(data.expenses.byType).map(([type, amount]) => (
                <div key={type} className="flex justify-between items-center py-2 px-3 rounded bg-muted/30" data-testid={`row-expense-${type}`}>
                  <span className="text-sm">{getExpenseTypeLabel(type)}</span>
                  <span className="text-sm font-medium">{formatCurrency(amount)}</span>
                </div>
              ))}
              {data.expenses.depreciation > 0 && (
                <div className="flex justify-between items-center py-2 px-3 rounded bg-muted/30" data-testid="row-expense-depreciation">
                  <span className="text-sm">{t("depreciation")}</span>
                  <span className="text-sm font-medium">{formatCurrency(data.expenses.depreciation)}</span>
                </div>
              )}
              {data.expenses.interestOnLiabilities > 0 && (
                <div className="flex justify-between items-center py-2 px-3 rounded bg-muted/30" data-testid="row-expense-interest">
                  <span className="text-sm">{t("interestOnLiabilities")}</span>
                  <span className="text-sm font-medium">{formatCurrency(data.expenses.interestOnLiabilities)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between items-center font-bold text-red-700 dark:text-red-400 pt-1" data-testid="text-total-expenses">
                <span>{t("totalExpenses")}</span>
                <span>{formatCurrency(data.expenses.total)}</span>
              </div>
            </CardContent>
          </Card>

          <Card className={`border-2 ${isProfit ? "border-green-300 dark:border-green-700" : "border-red-300 dark:border-red-700"}`} data-testid="card-net-result">
            <CardContent className="py-6">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  {isProfit ? (
                    <TrendingUp className="h-8 w-8 text-green-600" />
                  ) : (
                    <TrendingDown className="h-8 w-8 text-red-600" />
                  )}
                  <span className={`text-xl font-bold ${isProfit ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                    {isProfit ? t("netProfit") : t("netLoss")}
                  </span>
                </div>
                <span className={`text-2xl font-bold ${isProfit ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`} data-testid="text-net-result-amount">
                  {formatCurrency(data.netProfitOrLoss)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}