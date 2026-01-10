import { useI18n } from "@/lib/i18n";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Undo2 } from "lucide-react";
import type { LotEditHistory } from "@shared/schema";

interface EditHistoryAccordionProps {
  history: LotEditHistory[];
  onReverse?: () => void;
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
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-muted-foreground">{t("quantitySold")}</p>
                    <p className="font-medium">{entry.soldQuantity} {t("bags")}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("pricePerBag")}</p>
                    <p className="font-medium">Rs. {entry.pricePerBag}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("totalPrice")}</p>
                    <p className="font-medium text-chart-3">Rs. {entry.totalPrice?.toLocaleString()}</p>
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
                      <p className="font-medium">Rs. {entry.pricePerKg}/kg</p>
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
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-muted-foreground mb-1">Previous Data</p>
                  <pre className="text-xs bg-background rounded p-2 overflow-x-auto">
                    {JSON.stringify(JSON.parse(entry.previousData), null, 2)}
                  </pre>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">New Data</p>
                  <pre className="text-xs bg-background rounded p-2 overflow-x-auto">
                    {JSON.stringify(JSON.parse(entry.newData), null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
