import { IndianRupee } from "lucide-react";
import { cn } from "@/lib/utils";

interface CurrencyProps {
  amount: number | string;
  className?: string;
  iconClassName?: string;
  showIcon?: boolean;
}

function smartFormatNumber(num: number): string {
  if (Number.isInteger(num)) {
    return num.toLocaleString("en-IN");
  }
  const rounded = Math.round(num * 10) / 10;
  if (Number.isInteger(rounded)) {
    return rounded.toLocaleString("en-IN");
  }
  return rounded.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function Currency({ amount, className, iconClassName, showIcon = true }: CurrencyProps) {
  const formattedAmount = typeof amount === "number" 
    ? smartFormatNumber(amount) 
    : amount;
  
  return (
    <span className={cn("inline-flex items-center", className)}>
      {showIcon && <IndianRupee className={cn("h-3 w-3", iconClassName)} />}
      {formattedAmount}
    </span>
  );
}

export function formatCurrency(amount: number): string {
  return smartFormatNumber(amount);
}
