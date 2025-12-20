import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

interface CapacityGaugeProps {
  totalCapacity: number;
  usedCapacity: number;
}

export function CapacityGauge({ totalCapacity, usedCapacity }: CapacityGaugeProps) {
  const { t } = useI18n();

  const usedPercentage = totalCapacity > 0 ? Math.round((usedCapacity / totalCapacity) * 100) : 0;
  const freeCapacity = totalCapacity - usedCapacity;

  const data = [
    { name: t("capacityUsed"), value: usedCapacity, color: "hsl(var(--chart-1))" },
    { name: t("freeCapacity") || "Free", value: freeCapacity, color: "hsl(var(--muted))" },
  ];

  if (totalCapacity === 0) {
    return (
      <Card className="p-4 sm:p-6">
        <h3 className="text-lg font-semibold mb-4">{t("overallCapacity")}</h3>
        <div className="h-48 flex items-center justify-center text-muted-foreground">
          No capacity configured
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 sm:p-6">
      <h3 className="text-lg font-semibold mb-4">{t("overallCapacity")}</h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              startAngle={180}
              endAngle={0}
              paddingAngle={2}
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
              }}
              formatter={(value: number) => [value.toLocaleString() + " " + t("bags"), ""]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-col items-center -mt-16">
        <p className="text-4xl font-bold text-chart-1" data-testid="text-capacity-percentage">
          {usedPercentage}%
        </p>
        <p className="text-sm text-muted-foreground">
          {usedCapacity.toLocaleString()} / {totalCapacity.toLocaleString()} {t("bags")}
        </p>
      </div>
    </Card>
  );
}
