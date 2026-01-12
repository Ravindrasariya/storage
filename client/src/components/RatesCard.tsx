import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { IndianRupee } from "lucide-react";

interface RatesCardProps {
  waferRate: number;
  seedRate: number;
  waferColdCharge?: number;
  waferHammali?: number;
  seedColdCharge?: number;
  seedHammali?: number;
}

export function RatesCard({ 
  waferRate, 
  seedRate, 
  waferColdCharge,
  waferHammali,
  seedColdCharge,
  seedHammali
}: RatesCardProps) {
  const { t } = useI18n();

  const formatRate = (coldCharge?: number, hammali?: number, total?: number) => {
    if (coldCharge != null && hammali != null) {
      return `${coldCharge}/${hammali}`;
    }
    return total?.toString() || "0";
  };
  
  const hasSplitRates = (coldCharge?: number, hammali?: number) => {
    return coldCharge != null && hammali != null;
  };

  return (
    <Card className="p-4 sm:p-6">
      <h3 className="text-lg font-semibold mb-4">{t("perBagRates")}</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 rounded-lg bg-chart-1/10 text-center">
          <div className="flex items-center justify-center gap-1 text-chart-1">
            <IndianRupee className="h-5 w-5" />
            <span className="text-2xl font-bold" data-testid="text-wafer-rate">
              {formatRate(waferColdCharge, waferHammali, waferRate)}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{t("wafer")}/{t("ration")}</p>
          {hasSplitRates(waferColdCharge, waferHammali) && (
            <p className="text-xs text-muted-foreground mt-1">
              ({t("total")}: {waferRate})
            </p>
          )}
        </div>
        <div className="p-4 rounded-lg bg-chart-2/10 text-center">
          <div className="flex items-center justify-center gap-1 text-chart-2">
            <IndianRupee className="h-5 w-5" />
            <span className="text-2xl font-bold" data-testid="text-seed-rate">
              {formatRate(seedColdCharge, seedHammali, seedRate)}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{t("seed")}</p>
          {hasSplitRates(seedColdCharge, seedHammali) && (
            <p className="text-xs text-muted-foreground mt-1">
              ({t("total")}: {seedRate})
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
