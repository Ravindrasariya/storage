import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Download, FileSpreadsheet, AlertTriangle, Loader2 } from "lucide-react";
import { authFetch } from "@/lib/queryClient";

interface BalanceSheetData {
  financialYear: string;
  asOf: string;
  assets: {
    fixedAssets: {
      byCategory: Record<string, number>;
      total: number;
    };
  };
  liabilities: {
    longTerm: { items: { name: string; type: string; amount: number }[]; total: number };
    current: { items: { name: string; type: string; amount: number }[]; total: number };
    total: number;
  };
  ownersEquity: number;
  totalLiabilitiesAndEquity: number;
}

const CATEGORY_LABELS: Record<string, { en: string; hi: string }> = {
  building: { en: "Building", hi: "भवन" },
  plant_machinery: { en: "Plant & Machinery", hi: "संयंत्र और मशीनरी" },
  furniture: { en: "Furniture", hi: "फर्नीचर" },
  vehicles: { en: "Vehicles", hi: "वाहन" },
  computers: { en: "Computers", hi: "कंप्यूटर" },
  electrical_fittings: { en: "Electrical Fittings", hi: "विद्युत फिटिंग" },
  other: { en: "Other", hi: "अन्य" },
};

export default function BalanceSheet() {
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

  const { data, isLoading, error } = useQuery<BalanceSheetData>({
    queryKey: ["/api/reports/balance-sheet", selectedFY],
    queryFn: async () => {
      const res = await authFetch(`/api/reports/balance-sheet/${selectedFY}`);
      if (!res.ok) throw new Error("Failed to fetch balance sheet");
      return res.json();
    },
    enabled: !!selectedFY,
  });

  const formatCurrency = (amount: number) => {
    return `₹${Math.abs(amount).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  const getCategoryLabel = (cat: string) => {
    const labels = CATEGORY_LABELS[cat];
    if (labels) return language === "hi" ? labels.hi : labels.en;
    return cat;
  };

  const handleDownloadCSV = async () => {
    try {
      const res = await authFetch(`/api/reports/balance-sheet/${selectedFY}?format=csv`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `balance_sheet_${selectedFY}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };

  const totalAssets = data?.assets.fixedAssets.total || 0;
  const totalLiabilitiesAndEquity = data?.totalLiabilitiesAndEquity || 0;
  const isBalanced = Math.abs(totalAssets - totalLiabilitiesAndEquity) < 1;

  return (
    <div className="container mx-auto p-4 max-w-6xl space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-balance-sheet-title">
            <FileSpreadsheet className="h-6 w-6" />
            {t("balanceSheet")}
          </h1>
          {data && (
            <p className="text-sm text-muted-foreground mt-1" data-testid="text-balance-sheet-date">
              {t("asOfDate")} {data.asOf}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedFY} onValueChange={setSelectedFY}>
            <SelectTrigger className="w-[160px]" data-testid="select-balance-sheet-fy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fyOptions.map(fy => (
                <SelectItem key={fy} value={fy}>FY {fy}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleDownloadCSV} data-testid="btn-download-balance-sheet-csv">
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
            Failed to load balance sheet data
          </CardContent>
        </Card>
      )}

      {data && !isLoading && (
        <>
          {!isBalanced && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg" data-testid="warning-mismatch">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <span className="text-sm text-amber-700 dark:text-amber-300">{t("mismatchWarning")}</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card data-testid="card-assets-section">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg text-green-700 dark:text-green-400">{t("totalAssets")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="font-semibold text-sm text-muted-foreground mb-2">{t("fixedAssets")}</h3>
                  <div className="space-y-2">
                    {Object.entries(data.assets.fixedAssets.byCategory).map(([cat, value]) => (
                      <div key={cat} className="flex justify-between items-center py-1 px-2 rounded bg-muted/30" data-testid={`row-asset-${cat}`}>
                        <span className="text-sm">{getCategoryLabel(cat)}</span>
                        <span className="text-sm font-medium">{formatCurrency(value)}</span>
                      </div>
                    ))}
                    {Object.keys(data.assets.fixedAssets.byCategory).length === 0 && (
                      <p className="text-sm text-muted-foreground italic">No fixed assets</p>
                    )}
                  </div>
                  <div className="flex justify-between items-center mt-2 pt-2 border-t font-semibold">
                    <span className="text-sm">{t("fixedAssets")} {t("total") || "Total"}</span>
                    <span className="text-sm">{formatCurrency(data.assets.fixedAssets.total)}</span>
                  </div>
                </div>

                <Separator />

                <div className="flex justify-between items-center font-bold text-lg text-green-700 dark:text-green-400" data-testid="text-total-assets">
                  <span>{t("totalAssets")}</span>
                  <span>{formatCurrency(totalAssets)}</span>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-liabilities-section">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg text-red-700 dark:text-red-400">{t("totalLiabilitiesEquity")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="font-semibold text-sm text-muted-foreground mb-2">{t("longTermLiabilities")}</h3>
                  <div className="space-y-2">
                    {data.liabilities.longTerm.items.map((item, i) => (
                      <div key={i} className="flex justify-between items-center py-1 px-2 rounded bg-muted/30" data-testid={`row-lt-liability-${i}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{item.name}</span>
                          <Badge variant="outline" className="text-xs">{item.type}</Badge>
                        </div>
                        <span className="text-sm font-medium">{formatCurrency(item.amount)}</span>
                      </div>
                    ))}
                    {data.liabilities.longTerm.items.length === 0 && (
                      <p className="text-sm text-muted-foreground italic">None</p>
                    )}
                  </div>
                  <div className="flex justify-between items-center mt-2 pt-2 border-t">
                    <span className="text-sm font-semibold">{t("longTermLiabilities")} {t("total") || "Total"}</span>
                    <span className="text-sm font-semibold">{formatCurrency(data.liabilities.longTerm.total)}</span>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-sm text-muted-foreground mb-2">{t("currentLiabilities")}</h3>
                  <div className="space-y-2">
                    {data.liabilities.current.items.map((item, i) => (
                      <div key={i} className="flex justify-between items-center py-1 px-2 rounded bg-muted/30" data-testid={`row-cl-liability-${i}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{item.name}</span>
                          <Badge variant="outline" className="text-xs">{item.type}</Badge>
                        </div>
                        <span className="text-sm font-medium">{formatCurrency(item.amount)}</span>
                      </div>
                    ))}
                    {data.liabilities.current.items.length === 0 && (
                      <p className="text-sm text-muted-foreground italic">None</p>
                    )}
                  </div>
                  <div className="flex justify-between items-center mt-2 pt-2 border-t">
                    <span className="text-sm font-semibold">{t("currentLiabilities")} {t("total") || "Total"}</span>
                    <span className="text-sm font-semibold">{formatCurrency(data.liabilities.current.total)}</span>
                  </div>
                </div>

                <Separator />

                <div className="flex justify-between items-center py-1">
                  <span className="text-sm font-semibold">{t("ownersEquity")}</span>
                  <span className={`text-sm font-semibold ${data.ownersEquity >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {data.ownersEquity < 0 ? "-" : ""}{formatCurrency(data.ownersEquity)}
                  </span>
                </div>

                <Separator />

                <div className="flex justify-between items-center font-bold text-lg text-red-700 dark:text-red-400" data-testid="text-total-liabilities-equity">
                  <span>{t("totalLiabilitiesEquity")}</span>
                  <span>{formatCurrency(totalLiabilitiesAndEquity)}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}