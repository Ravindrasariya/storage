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
    <Card className={`p-3 sm:p-4 ${colorClass} border-0`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{title}</p>
          <p className="text-xl sm:text-2xl font-bold mt-1" data-testid={testId}>{value}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
        <div className="p-1.5 sm:p-2 rounded-lg bg-background/50 shrink-0">
          <Icon className="h-4 w-4 sm:h-5 sm:w-5 text-foreground" />
        </div>
      </div>
    </Card>
  );
}
