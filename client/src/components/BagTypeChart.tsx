import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

interface BagTypeChartProps {
  waferBags: number;
  seedBags: number;
}

export function BagTypeChart({ waferBags, seedBags }: BagTypeChartProps) {
  const { t } = useI18n();

  const data = [
    { name: t("wafer"), value: waferBags, color: "hsl(var(--chart-1))" },
    { name: t("seed"), value: seedBags, color: "hsl(var(--chart-2))" },
  ];

  const total = waferBags + seedBags;

  if (total === 0) {
    return (
      <Card className="p-4 sm:p-6">
        <h3 className="text-lg font-semibold mb-4">{t("totalBags")}</h3>
        <div className="h-48 flex items-center justify-center text-muted-foreground">
          No bags recorded
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 sm:p-6">
      <h3 className="text-lg font-semibold mb-4">{t("totalBags")}</h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={70}
              paddingAngle={5}
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
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-center gap-8 mt-2">
        <div className="text-center">
          <p className="text-2xl font-bold text-chart-1" data-testid="text-wafer-count">{waferBags}</p>
          <p className="text-xs text-muted-foreground">{t("wafer")}</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-chart-2" data-testid="text-seed-count">{seedBags}</p>
          <p className="text-xs text-muted-foreground">{t("seed")}</p>
        </div>
      </div>
    </Card>
  );
}
