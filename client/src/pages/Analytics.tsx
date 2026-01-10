import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QualityChart } from "@/components/QualityChart";
import { QualitySummaryCards } from "@/components/QualitySummaryCards";
import { ArrowLeft, BarChart3, Clock, IndianRupee, Calendar, Users, Package, Wallet } from "lucide-react";
import type { QualityStats, PaymentStats, MerchantStats } from "@shared/schema";

export default function Analytics() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
  const [selectedBuyer, setSelectedBuyer] = useState<string>("all");

  const { data: years = [] } = useQuery<number[]>({
    queryKey: ["/api/analytics/years"],
  });

  const { data: stats, isLoading } = useQuery<QualityStats>({
    queryKey: ["/api/analytics/quality", selectedYear],
    queryFn: async () => {
      const url = selectedYear && selectedYear !== "all" 
        ? `/api/analytics/quality?year=${selectedYear}` 
        : "/api/analytics/quality";
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch quality stats");
      return response.json();
    },
  });

  const { data: paymentStats } = useQuery<PaymentStats>({
    queryKey: ["/api/analytics/payments", selectedYear],
    queryFn: async () => {
      const url = selectedYear && selectedYear !== "all" 
        ? `/api/analytics/payments?year=${selectedYear}` 
        : "/api/analytics/payments";
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch payment stats");
      return response.json();
    },
  });

  const { data: merchantStats } = useQuery<MerchantStats>({
    queryKey: ["/api/analytics/merchants", selectedYear],
    queryFn: async () => {
      const url = selectedYear && selectedYear !== "all" 
        ? `/api/analytics/merchants?year=${selectedYear}` 
        : "/api/analytics/merchants";
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch merchant stats");
      return response.json();
    },
  });

  const selectedMerchantData = selectedBuyer === "all"
    ? merchantStats?.merchantData?.reduce((acc, m) => ({
        buyerName: "All Buyers",
        bagsPurchased: acc.bagsPurchased + m.bagsPurchased,
        totalValue: acc.totalValue + m.totalValue,
        totalChargePaid: acc.totalChargePaid + m.totalChargePaid,
        totalChargeDue: acc.totalChargeDue + m.totalChargeDue,
      }), { buyerName: "All Buyers", bagsPurchased: 0, totalValue: 0, totalChargePaid: 0, totalChargeDue: 0 })
    : merchantStats?.merchantData?.find(m => m.buyerName === selectedBuyer);

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">{t("analytics")}</h1>
            <p className="text-muted-foreground mt-1">
              Quality analysis and insights
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-32" data-testid="select-year">
              <SelectValue placeholder={t("allYears")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allYears")}</SelectItem>
              {years.map((year) => (
                <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/50">
              <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">{t("totalDue")}</p>
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400" data-testid="text-total-due">
                Rs. {(paymentStats?.totalDue || 0).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">
                {paymentStats?.dueCount || 0} lots
              </p>
            </div>
          </div>
        </Card>
        
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/50">
              <IndianRupee className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">{t("overallPayment")}</p>
              <p className="text-2xl font-bold" data-testid="text-overall-payment">
                Rs. {((paymentStats?.totalPaid || 0) + (paymentStats?.totalDue || 0)).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">
                {(paymentStats?.paidCount || 0) + (paymentStats?.dueCount || 0)} total sold lots
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Merchant Analysis Section */}
      <Card className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold">{t("merchantAnalysis")}</h3>
          </div>
          <Select value={selectedBuyer} onValueChange={setSelectedBuyer}>
            <SelectTrigger className="w-48" data-testid="select-buyer">
              <SelectValue placeholder={t("selectBuyer")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allBuyers")}</SelectItem>
              {merchantStats?.buyers?.map((buyer) => (
                <SelectItem key={buyer} value={buyer}>{buyer}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {merchantStats?.merchantData && merchantStats.merchantData.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4 bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/50">
                  <Package className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground">{t("bagsPurchased")}</p>
                  <p className="text-xl font-bold text-purple-600 dark:text-purple-400" data-testid="text-bags-purchased">
                    {(selectedMerchantData?.bagsPurchased || 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/50">
                  <IndianRupee className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground">{t("totalValueINR")}</p>
                  <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400" data-testid="text-total-value">
                    Rs. {(selectedMerchantData?.totalValue || 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/50">
                  <Wallet className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground">{t("totalChargesPaidMerchant")}</p>
                  <p className="text-xl font-bold text-green-600 dark:text-green-400" data-testid="text-merchant-paid">
                    Rs. {(selectedMerchantData?.totalChargePaid || 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/50">
                  <Clock className="h-5 w-5 text-red-600 dark:text-red-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground">{t("totalChargesDueMerchant")}</p>
                  <p className="text-xl font-bold text-red-600 dark:text-red-400" data-testid="text-merchant-due">
                    Rs. {(selectedMerchantData?.totalChargeDue || 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </Card>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            {t("noMerchantData")}
          </div>
        )}
      </Card>

      <QualitySummaryCards
        poor={stats?.totalPoorRemaining || 0}
        medium={stats?.totalMediumRemaining || 0}
        good={stats?.totalGoodRemaining || 0}
      />

      <QualityChart data={stats?.chamberQualityRemaining || []} />

      <Card className="p-4 sm:p-6">
        <div className="flex flex-col gap-1 mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-chart-4" />
            <h3 className="text-lg font-semibold">{t("qualityDistribution")}</h3>
          </div>
          <p className="text-sm text-muted-foreground ml-7">{t("initialDistribution")}</p>
        </div>

        {stats?.chamberQuality && stats.chamberQuality.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 font-medium">{t("chamber")}</th>
                  <th className="text-center py-3 px-2 font-medium text-red-600 dark:text-red-400">
                    {t("poor")}
                  </th>
                  <th className="text-center py-3 px-2 font-medium text-yellow-600 dark:text-yellow-400">
                    {t("medium")}
                  </th>
                  <th className="text-center py-3 px-2 font-medium text-green-600 dark:text-green-400">
                    {t("good")}
                  </th>
                  <th className="text-center py-3 px-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {stats.chamberQuality.map((chamber) => {
                  const total = chamber.poor + chamber.medium + chamber.good;
                  return (
                    <tr
                      key={chamber.chamberId}
                      className="border-b hover:bg-muted/50"
                      data-testid={`row-chamber-${chamber.chamberId}`}
                    >
                      <td className="py-3 px-2 font-medium">{chamber.chamberName}</td>
                      <td className="text-center py-3 px-2">
                        <span className="inline-flex items-center justify-center min-w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400 font-medium">
                          {chamber.poor}
                        </span>
                      </td>
                      <td className="text-center py-3 px-2">
                        <span className="inline-flex items-center justify-center min-w-8 h-8 rounded-full bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-400 font-medium">
                          {chamber.medium}
                        </span>
                      </td>
                      <td className="text-center py-3 px-2">
                        <span className="inline-flex items-center justify-center min-w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400 font-medium">
                          {chamber.good}
                        </span>
                      </td>
                      <td className="text-center py-3 px-2 font-bold">{total}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-muted/50 font-bold">
                  <td className="py-3 px-2">Total</td>
                  <td className="text-center py-3 px-2 text-red-600 dark:text-red-400">
                    {stats.totalPoor}
                  </td>
                  <td className="text-center py-3 px-2 text-yellow-600 dark:text-yellow-400">
                    {stats.totalMedium}
                  </td>
                  <td className="text-center py-3 px-2 text-green-600 dark:text-green-400">
                    {stats.totalGood}
                  </td>
                  <td className="text-center py-3 px-2">
                    {stats.totalPoor + stats.totalMedium + stats.totalGood}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No data available for analysis
          </div>
        )}
      </Card>
    </div>
  );
}
