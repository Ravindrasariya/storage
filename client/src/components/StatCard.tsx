import { Card } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  colorClass: string;
  testId: string;
}

export function StatCard({ title, value, subtitle, icon: Icon, colorClass, testId }: StatCardProps) {
  return (
    <Card className={`p-4 sm:p-6 ${colorClass} border-0`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-2xl sm:text-3xl font-bold mt-1" data-testid={testId}>{value}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
        <div className="p-2 sm:p-3 rounded-lg bg-background/50 shrink-0">
          <Icon className="h-5 w-5 sm:h-6 sm:w-6 text-foreground" />
        </div>
      </div>
    </Card>
  );
}
