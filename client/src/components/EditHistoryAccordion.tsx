import { useI18n } from "@/lib/i18n";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Currency } from "@/components/Currency";
import { format } from "date-fns";
import { Undo2, ArrowRight } from "lucide-react";
import type { LotEditHistory } from "@shared/schema";

interface EditHistoryAccordionProps {
  history: LotEditHistory[];
  onReverse?: () => void;
}

const fieldLabels: Record<string, string> = {
  remainingSize: "Remaining Bags",
  size: "Total Bags",
  chamberId: "Chamber",
  chamberName: "Chamber",
  floor: "Floor",
  position: "Position",
  quality: "Quality",
  potatoSize: "Potato Size",
  bagType: "Bag Type",
  type: "Variety",
  farmerName: "Farmer Name",
  village: "Village",
  tehsil: "Tehsil",
  district: "District",
  state: "State",
  contactNumber: "Contact Number",
  status: "Status",
  remarks: "Remarks",
};

function getFieldLabel(field: string): string {
  return fieldLabels[field] || field.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" || trimmed === "-";
  }
  return false;
}

function getChangedFields(previousData: string, newData: string): { field: string; oldValue: unknown; newValue: unknown }[] {
  try {
    const prev = JSON.parse(previousData);
    const next = JSON.parse(newData);
    const changes: { field: string; oldValue: unknown; newValue: unknown }[] = [];
    
    const allKeys = Array.from(new Set([...Object.keys(prev), ...Object.keys(next)]));
    for (const key of allKeys) {
      const oldVal = prev[key];
      const newVal = next[key];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        if (isEmpty(oldVal) && isEmpty(newVal)) continue;
        if (!isEmpty(oldVal)) {
          changes.push({ field: key, oldValue: oldVal, newValue: newVal });
        }
      }
    }
    return changes;
  } catch {
    return [];
  }
}

export function EditHistoryAccordion({ history, onReverse }: EditHistoryAccordionProps) {
  const { t } = useI18n();

  if (history.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-4">
        No edit history available
      </div>
    );
  }

  return (
    <Accordion type="single" collapsible className="w-full">
      {history.map((entry, index) => (
        <AccordionItem key={entry.id} value={entry.id}>
          <AccordionTrigger className="text-sm">
            <div className="flex items-center gap-3 flex-1">
              <Badge
                variant={entry.changeType === "partial_sale" || entry.changeType === "final_sale" ? "default" : "secondary"}
              >
                {entry.changeType === "partial_sale" ? t("partialSale") : entry.changeType === "final_sale" ? t("sold") : t("edit")}
              </Badge>
              <span className="text-muted-foreground">
                {format(new Date(entry.changedAt), "PPp")}
              </span>
              {entry.soldQuantity && (
                <span className="font-medium">
                  -{entry.soldQuantity} {t("bags")}
                </span>
              )}
              {index === 0 && entry.changeType === "edit" && onReverse && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto mr-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReverse();
                  }}
                  data-testid="button-reverse-edit"
                >
                  <Undo2 className="h-3 w-3 mr-1" />
                  {t("reverse")}
                </Button>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="bg-muted/50 rounded-lg p-4 space-y-3 text-sm">
              {(entry.changeType === "partial_sale" || entry.changeType === "final_sale") && entry.soldQuantity && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div>
                      <p className="text-muted-foreground">{t("quantitySold")}</p>
                      <p className="font-medium">{entry.soldQuantity} {t("bags")}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t("pricePerBag")}</p>
                      <p className="font-medium"><Currency amount={entry.pricePerBag || 0} /></p>
                      {entry.coldCharge != null && entry.hammali != null && (
                        <p className="text-xs text-muted-foreground">
                          <Currency amount={entry.coldCharge} /> ({t("coldStorageCharge")}) + <Currency amount={entry.hammali} /> ({t("hammali")})
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t("totalPrice")}</p>
                      <p className="font-medium text-chart-3"><Currency amount={entry.totalPrice || 0} /></p>
                    </div>
                    {entry.buyerName && (
                      <div>
                        <p className="text-muted-foreground">{t("buyerName")}</p>
                        <p className="font-medium">{entry.buyerName}</p>
                      </div>
                    )}
                    {entry.pricePerKg && (
                      <div>
                        <p className="text-muted-foreground">{t("pricePerKg")}</p>
                        <p className="font-medium"><Currency amount={entry.pricePerKg} />/kg</p>
                      </div>
                    )}
                    {entry.salePaymentStatus && (
                      <div>
                        <p className="text-muted-foreground">{t("paymentStatus")}</p>
                        <p className={`font-medium ${entry.salePaymentStatus === "paid" ? "text-green-600" : "text-amber-600"}`}>
                          {t(entry.salePaymentStatus)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {(() => {
                const changes = getChangedFields(entry.previousData, entry.newData);
                if (changes.length === 0) return null;
                return (
                  <div className="space-y-2">
                    <p className="text-muted-foreground text-xs font-medium">{t("changes") || "Changes"}:</p>
                    <div className="space-y-1.5">
                      {changes.map(({ field, oldValue, newValue }) => (
                        <div key={field} className="flex items-center gap-2 text-sm bg-background rounded px-3 py-2">
                          <span className="font-medium text-muted-foreground min-w-[100px]">{getFieldLabel(field)}:</span>
                          <span className="text-destructive line-through">{formatValue(oldValue)}</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="text-green-600 dark:text-green-400 font-medium">{formatValue(newValue)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
