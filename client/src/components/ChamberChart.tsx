import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface ChamberData {
  id: string;
  name: string;
  capacity: number;
  currentFill: number;
  fillPercentage: number;
}

interface ChamberChartProps {
  chambers: ChamberData[];
}

export function ChamberChart({ chambers }: ChamberChartProps) {
  const { t } = useI18n();

  const getProgressColor = (percentage: number) => {
    if (percentage < 50) return "bg-chart-3"; // Green
    if (percentage < 80) return "bg-chart-2"; // Yellow/Orange
    return "bg-destructive"; // Red
  };

  return (
    <Card className="p-4 sm:p-6">
      <h3 className="text-lg font-semibold mb-4">{t("chamberFillRates")}</h3>
      <div className="space-y-4">
        {chambers.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-4">No chambers found</p>
        ) : (
          chambers.map((chamber) => (
            <div key={chamber.id} className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium">{chamber.name}</span>
                <span className="text-muted-foreground">
                  {chamber.currentFill} / {chamber.capacity} ({chamber.fillPercentage}%)
                </span>
              </div>
              <div className="relative h-3 rounded-full bg-muted overflow-hidden">
                <div
                  className={`absolute left-0 top-0 h-full rounded-full transition-all duration-500 ${getProgressColor(chamber.fillPercentage)}`}
                  style={{ width: `${chamber.fillPercentage}%` }}
                  data-testid={`progress-chamber-${chamber.id}`}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
