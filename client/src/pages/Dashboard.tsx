import { useI18n } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/StatCard";
import { ChamberChart } from "@/components/ChamberChart";
import { RatesCard } from "@/components/RatesCard";
import { UpForSaleList } from "@/components/UpForSaleList";
import { Warehouse, BarChart3, Users, Package, Boxes } from "lucide-react";
import { SettingsDialog } from "@/components/SettingsDialog";
import type { DashboardStats, ColdStorage } from "@shared/schema";

export default function Dashboard() {
  const { t } = useI18n();

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  const { data: coldStorage } = useQuery<ColdStorage>({
    queryKey: ["/api/cold-storage"],
  });

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-10 w-36" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold" data-testid="text-cold-storage-name">
            {coldStorage?.name || t("dashboard")}
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage your cold storage operations efficiently
          </p>
        </div>
        <SettingsDialog />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard
          title={t("overallCapacity")}
          value={stats?.totalCapacity.toLocaleString() || "0"}
          subtitle={t("bags")}
          icon={Warehouse}
          colorClass="bg-blue-50 dark:bg-blue-950/30"
          testId="text-total-capacity"
        />
        <StatCard
          title={t("capacityUsed")}
          value={`${stats?.peakUtilization?.toLocaleString() || 0} / ${stats?.currentUtilization?.toLocaleString() || 0}`}
          subtitle={`Peak / Current ${t("bags")}`}
          icon={BarChart3}
          colorClass="bg-emerald-50 dark:bg-emerald-950/30"
          testId="text-capacity-used"
        />
        <StatCard
          title={t("distinctFarmers")}
          value={stats?.totalFarmers || 0}
          icon={Users}
          colorClass="bg-purple-50 dark:bg-purple-950/30"
          testId="text-total-farmers"
        />
        <StatCard
          title={t("totalLots")}
          value={`${stats?.totalLots || 0} / ${stats?.remainingLots || 0}`}
          subtitle="Total / Remaining"
          icon={Package}
          colorClass="bg-orange-50 dark:bg-orange-950/30"
          testId="text-total-lots"
        />
        <StatCard
          title={t("wafer") + " " + t("bags")}
          value={`${stats?.totalWaferBags?.toLocaleString() || 0} / ${stats?.remainingWaferBags?.toLocaleString() || 0}`}
          subtitle="Total / Remaining"
          icon={Boxes}
          colorClass="bg-cyan-50 dark:bg-cyan-950/30"
          testId="text-wafer-bags"
        />
        <StatCard
          title={t("seed") + " " + t("bags")}
          value={`${stats?.totalSeedBags?.toLocaleString() || 0} / ${stats?.remainingSeedBags?.toLocaleString() || 0}`}
          subtitle="Total / Remaining"
          icon={Boxes}
          colorClass="bg-amber-50 dark:bg-amber-950/30"
          testId="text-seed-bags"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChamberChart chambers={stats?.chamberStats || []} />
        <RatesCard
          waferRate={stats?.waferRate || 0}
          seedRate={stats?.seedRate || 0}
        />
      </div>

      <UpForSaleList saleLots={stats?.saleLots || []} />
    </div>
  );
}
