import { IndianRupee } from "lucide-react";
import { cn } from "@/lib/utils";

interface CurrencyProps {
  amount: number | string;
  className?: string;
  iconClassName?: string;
  showIcon?: boolean;
}

export function Currency({ amount, className, iconClassName, showIcon = true }: CurrencyProps) {
  const formattedAmount = typeof amount === "number" 
    ? amount.toLocaleString("en-IN") 
    : amount;
  
  return (
    <span className={cn("inline-flex items-center", className)}>
      {showIcon && <IndianRupee className={cn("h-3 w-3", iconClassName)} />}
      {formattedAmount}
    </span>
  );
}

export function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-IN");
}
