import { useI18n } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QualityChart } from "@/components/QualityChart";
import { QualitySummaryCards } from "@/components/QualitySummaryCards";
import { ArrowLeft, BarChart3 } from "lucide-react";
import type { QualityStats } from "@shared/schema";

export default function Analytics() {
  const { t } = useI18n();
  const [, navigate] = useLocation();

  const { data: stats, isLoading } = useQuery<QualityStats>({
    queryKey: ["/api/analytics/quality"],
  });

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

      <QualitySummaryCards
        poor={stats?.totalPoor || 0}
        medium={stats?.totalMedium || 0}
        good={stats?.totalGood || 0}
      />

      <QualityChart data={stats?.chamberQuality || []} />

      <Card className="p-4 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-5 w-5 text-chart-4" />
          <h3 className="text-lg font-semibold">{t("qualityDistribution")}</h3>
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
