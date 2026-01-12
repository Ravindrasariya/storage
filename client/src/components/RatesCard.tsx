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
    <Card className="p-3 sm:p-4">
      <h3 className="text-base font-semibold mb-3">{t("perBagRates")}</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-chart-1/10 text-center">
          <div className="flex items-center justify-center gap-1 text-chart-1">
            <IndianRupee className="h-4 w-4" />
            <span className="text-xl font-bold" data-testid="text-wafer-rate">
              {formatRate(waferColdCharge, waferHammali, waferRate)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{t("wafer")}/{t("ration")}</p>
          {hasSplitRates(waferColdCharge, waferHammali) && (
            <p className="text-xs text-muted-foreground mt-0.5">
              ({t("total")}: {waferRate})
            </p>
          )}
        </div>
        <div className="p-3 rounded-lg bg-chart-2/10 text-center">
          <div className="flex items-center justify-center gap-1 text-chart-2">
            <IndianRupee className="h-4 w-4" />
            <span className="text-xl font-bold" data-testid="text-seed-rate">
              {formatRate(seedColdCharge, seedHammali, seedRate)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{t("seed")}</p>
          {hasSplitRates(seedColdCharge, seedHammali) && (
            <p className="text-xs text-muted-foreground mt-0.5">
              ({t("total")}: {seedRate})
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
