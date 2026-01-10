import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { ChevronDown, ChevronUp } from "lucide-react";

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

type FloorCapacityData = Record<string, { floor: number; bags: number }[]>;

export function ChamberChart({ chambers }: ChamberChartProps) {
  const { t } = useI18n();
  const [expandedChambers, setExpandedChambers] = useState<Set<string>>(new Set());

  const { data: floorCapacity } = useQuery<FloorCapacityData>({
    queryKey: ["/api/chambers/floor-capacity"],
  });

  const getProgressColor = (percentage: number) => {
    if (percentage < 50) return "bg-chart-3";
    if (percentage < 80) return "bg-chart-2";
    return "bg-destructive";
  };

  const toggleExpand = (chamberId: string) => {
    setExpandedChambers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(chamberId)) {
        newSet.delete(chamberId);
      } else {
        newSet.add(chamberId);
      }
      return newSet;
    });
  };

  return (
    <Card className="p-4 sm:p-6">
      <h3 className="text-lg font-semibold mb-4">{t("chamberFillRates")}</h3>
      <div className="space-y-3">
        {chambers.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-4">No chambers found</p>
        ) : (
          chambers.map((chamber) => {
            const floors = floorCapacity?.[chamber.id] || [];
            const hasFloors = floors.length > 0;
            const isExpanded = expandedChambers.has(chamber.id);

            return (
              <div key={chamber.id} className="space-y-2">
                <div
                  className={`flex justify-between items-center text-sm ${hasFloors ? "cursor-pointer hover-elevate rounded-md p-2 -m-2" : ""}`}
                  onClick={() => hasFloors && toggleExpand(chamber.id)}
                  data-testid={`chamber-row-${chamber.id}`}
                >
                  <span className="font-medium flex items-center gap-2">
                    {chamber.name}
                    {hasFloors && (
                      isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {chamber.currentFill.toLocaleString()} / {chamber.capacity.toLocaleString()} ({chamber.fillPercentage}%)
                  </span>
                </div>
                <div className="relative h-3 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`absolute left-0 top-0 h-full rounded-full transition-all duration-500 ${getProgressColor(chamber.fillPercentage)}`}
                    style={{ width: `${chamber.fillPercentage}%` }}
                    data-testid={`progress-chamber-${chamber.id}`}
                  />
                </div>

                {isExpanded && hasFloors && (
                  <div className="ml-4 pl-4 border-l-2 border-muted space-y-2 mt-2">
                    {floors.map((floorData) => {
                      const floorPercentage = chamber.capacity > 0 
                        ? Math.round((floorData.bags / chamber.capacity) * 100) 
                        : 0;
                      return (
                        <div key={floorData.floor} className="text-sm">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-muted-foreground">
                              {t("floor")} {floorData.floor}
                            </span>
                            <span className="text-muted-foreground">
                              {floorData.bags.toLocaleString()} {t("bags")}
                            </span>
                          </div>
                          <div className="relative h-2 rounded-full bg-muted/50 overflow-hidden">
                            <div
                              className={`absolute left-0 top-0 h-full rounded-full transition-all duration-300 ${getProgressColor(floorPercentage)} opacity-70`}
                              style={{ width: `${Math.min(floorPercentage, 100)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
