import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface ChamberQuality {
  chamberId: string;
  chamberName: string;
  poor: number;
  medium: number;
  good: number;
}

interface QualityChartProps {
  data: ChamberQuality[];
}

export function QualityChart({ data }: QualityChartProps) {
  const { t } = useI18n();

  const chartData = data.map((item) => ({
    name: item.chamberName,
    [t("poor")]: item.poor,
    [t("medium")]: item.medium,
    [t("good")]: item.good,
  }));

  if (data.length === 0) {
    return (
      <Card className="p-4 sm:p-6">
        <h3 className="text-lg font-semibold mb-4">{t("chamberQualityAnalysis")}</h3>
        <div className="h-64 flex items-center justify-center text-muted-foreground">
          No data available
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 sm:p-6">
      <h3 className="text-lg font-semibold mb-4">{t("chamberQualityAnalysis")}</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
            <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
              }}
            />
            <Legend />
            <Bar dataKey={t("poor")} stackId="a" fill="hsl(0, 84%, 60%)" radius={[0, 0, 0, 0]} />
            <Bar dataKey={t("medium")} stackId="a" fill="hsl(43, 96%, 56%)" radius={[0, 0, 0, 0]} />
            <Bar dataKey={t("good")} stackId="a" fill="hsl(142, 76%, 46%)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
