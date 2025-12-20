import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { AlertCircle, AlertTriangle, CheckCircle } from "lucide-react";

interface QualitySummaryCardsProps {
  poor: number;
  medium: number;
  good: number;
}

export function QualitySummaryCards({ poor, medium, good }: QualitySummaryCardsProps) {
  const { t } = useI18n();
  const total = poor + medium + good;

  const getPercentage = (value: number) => {
    if (total === 0) return 0;
    return Math.round((value / total) * 100);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Card className="p-4 sm:p-6 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-red-700 dark:text-red-400">{t("poor")}</p>
            <p className="text-3xl font-bold text-red-600 dark:text-red-500 mt-1" data-testid="text-poor-count">
              {poor}
            </p>
            <p className="text-xs text-red-600/70 dark:text-red-400/70 mt-1">
              {getPercentage(poor)}% {t("bags")}
            </p>
          </div>
          <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/50">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
          </div>
        </div>
      </Card>

      <Card className="p-4 sm:p-6 bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">{t("medium")}</p>
            <p className="text-3xl font-bold text-yellow-600 dark:text-yellow-500 mt-1" data-testid="text-medium-count">
              {medium}
            </p>
            <p className="text-xs text-yellow-600/70 dark:text-yellow-400/70 mt-1">
              {getPercentage(medium)}% {t("bags")}
            </p>
          </div>
          <div className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900/50">
            <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
          </div>
        </div>
      </Card>

      <Card className="p-4 sm:p-6 bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-green-700 dark:text-green-400">{t("good")}</p>
            <p className="text-3xl font-bold text-green-600 dark:text-green-500 mt-1" data-testid="text-good-count">
              {good}
            </p>
            <p className="text-xs text-green-600/70 dark:text-green-400/70 mt-1">
              {getPercentage(good)}% {t("bags")}
            </p>
          </div>
          <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/50">
            <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
        </div>
      </Card>
    </div>
  );
}
