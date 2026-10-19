import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import { SALE_REMARK_MAX_LENGTH, saleRemarkSchema } from "@shared/sale-remarks";

export function SaleRemarkInput({ id, value, onChange, disabled = false }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const invalid = !saleRemarkSchema.safeParse(value).success;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t("remarks")} ({t("optional")})</Label>
      <Input id={id} type="text" value={value} onChange={event => onChange(event.target.value)}
        maxLength={SALE_REMARK_MAX_LENGTH} disabled={disabled}
        placeholder={t("saleRemarkPlaceholder")} data-testid={id}
        aria-invalid={invalid} aria-describedby={invalid || disabled ? `${id}-help` : undefined} />
      {(invalid || disabled) && (
        <p id={`${id}-help`} className="text-xs text-muted-foreground" role={invalid ? "alert" : undefined}>
          {invalid ? t("saleRemarkInvalid") : t("saleEditBlockedByPayment")}
        </p>
      )}
    </div>
  );
}
