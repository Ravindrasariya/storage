import { useI18n } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/StatCard";
import { ChamberChart } from "@/components/ChamberChart";
import { BagTypeChart } from "@/components/BagTypeChart";
import { RatesCard } from "@/components/RatesCard";
import { Plus, Warehouse, BarChart3, Users, Package, Boxes, Phone } from "lucide-react";
import type { DashboardStats } from "@shared/schema";

export default function Dashboard() {
  const { t } = useI18n();

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
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

  const usedPercentage = stats
    ? Math.round((stats.usedCapacity / stats.totalCapacity) * 100)
    : 0;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">{t("dashboard")}</h1>
          <p className="text-muted-foreground mt-1">
            Manage your cold storage operations efficiently
          </p>
          <a 
            href="tel:8882589392" 
            className="inline-flex items-center gap-2 mt-2 text-sm text-chart-1 hover:underline"
            data-testid="link-help-contact"
          >
            <Phone className="h-4 w-4" />
            {t("needHelp")}: 8882589392
          </a>
        </div>
        <Link href="/new-lot">
          <Button size="lg" className="gap-2 w-full sm:w-auto" data-testid="button-add-lot">
            <Plus className="h-5 w-5" />
            {t("addNewLot")}
          </Button>
        </Link>
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
          value={`${usedPercentage}%`}
          subtitle={`${stats?.usedCapacity.toLocaleString() || 0} ${t("bags")}`}
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
          value={stats?.totalLots || 0}
          icon={Package}
          colorClass="bg-orange-50 dark:bg-orange-950/30"
          testId="text-total-lots"
        />
        <StatCard
          title={t("wafer") + " " + t("bags")}
          value={stats?.totalWaferBags.toLocaleString() || 0}
          icon={Boxes}
          colorClass="bg-cyan-50 dark:bg-cyan-950/30"
          testId="text-wafer-bags"
        />
        <StatCard
          title={t("seed") + " " + t("bags")}
          value={stats?.totalSeedBags.toLocaleString() || 0}
          icon={Boxes}
          colorClass="bg-amber-50 dark:bg-amber-950/30"
          testId="text-seed-bags"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChamberChart chambers={stats?.chamberStats || []} />
        <div className="space-y-6">
          <BagTypeChart
            waferBags={stats?.totalWaferBags || 0}
            seedBags={stats?.totalSeedBags || 0}
          />
          <RatesCard
            waferRate={stats?.waferRate || 0}
            seedRate={stats?.seedRate || 0}
          />
        </div>
      </div>

      <div className="flex justify-center pt-4">
        <Link href="/new-lot">
          <Button
            size="lg"
            className="gap-2 text-lg px-8 py-6 shadow-lg"
            data-testid="button-add-lot-large"
          >
            <Plus className="h-6 w-6" />
            {t("addNewLot")}
          </Button>
        </Link>
      </div>
    </div>
  );
}
