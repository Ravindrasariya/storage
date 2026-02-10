import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Edit, Phone, MapPin, Package, Layers, ShoppingCart, CheckCircle, Clock, Receipt, Printer } from "lucide-react";
import type { Lot } from "@shared/schema";
import { Currency } from "@/components/Currency";

interface LotCardProps {
  lot: Lot;
  chamberName: string;
  onEdit: (lot: Lot) => void;
  onPartialSale?: (lot: Lot) => void;
  onToggleSale?: (lot: Lot, upForSale: boolean) => void;
  onPrintReceipt?: (lot: Lot) => void;
  calculatedPaidCharge?: number;
  calculatedDueCharge?: number;
  expectedColdCharge?: number;
  canEdit?: boolean;
}

export function LotCard({ lot, chamberName, onEdit, onPartialSale, onToggleSale, onPrintReceipt, calculatedPaidCharge, calculatedDueCharge, expectedColdCharge, canEdit = true }: LotCardProps) {
  // Use calculated values if provided, otherwise fall back to stored lot values
  const paidCharge = calculatedPaidCharge ?? lot.totalPaidCharge ?? 0;
  const dueCharge = calculatedDueCharge ?? lot.totalDueCharge ?? 0;
  const { t } = useI18n();

  const getQualityColor = (quality: string) => {
    switch (quality) {
      case "poor":
        return "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400";
      case "medium":
        return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-400";
      case "good":
        return "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getBagTypeColor = (bagType: string) => {
    return bagType === "wafer"
      ? "bg-chart-1/10 text-chart-1"
      : "bg-chart-2/10 text-chart-2";
  };

  return (
    <Card className="p-4 hover-elevate" data-testid={`card-lot-${lot.id}`}>
      {lot.entryBillNumber && (
        <div className="flex justify-end mb-1">
          <Badge variant="secondary" className="text-xs font-mono" data-testid={`badge-receipt-${lot.id}`}>
            <Receipt className="h-3 w-3 mr-1" />
            Receipt #{lot.entryBillNumber}
          </Badge>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h3 className="text-lg font-semibold truncate">{lot.farmerName}</h3>
            <Badge variant="outline" className={getQualityColor(lot.quality)}>
              {t(lot.quality)}
            </Badge>
            <Badge variant="outline" className={getBagTypeColor(lot.bagType)}>
              {t(lot.bagType)}
            </Badge>
            <Badge variant="outline" className="bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400 capitalize">
              {lot.potatoSize}
            </Badge>
            {lot.saleStatus === "sold" && (
              <Badge 
                variant="outline" 
                className="bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-400"
                data-testid={`badge-sold-${lot.id}`}
              >
                <CheckCircle className="h-3 w-3 mr-1" />
                {t("sold")}
              </Badge>
            )}
            {(paidCharge > 0 || dueCharge > 0) && (
              <Badge 
                variant="outline" 
                className={(paidCharge > 0 && dueCharge === 0)
                  ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400"
                }
                data-testid={`badge-payment-${lot.id}`}
              >
                {(paidCharge > 0 && dueCharge === 0) ? (
                  <><CheckCircle className="h-3 w-3 mr-1" />{t("paid")}</>
                ) : (
                  <><Clock className="h-3 w-3 mr-1" />{t("due")}</>
                )}
              </Badge>
            )}
            {lot.baseColdChargesBilled === 1 && (
              <Badge 
                variant="outline" 
                className="bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-400"
                data-testid={`badge-base-charges-paid-${lot.id}`}
              >
                <CheckCircle className="h-3 w-3 mr-1" />
                {t("baseColdChargesBilled")}
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 shrink-0" />
              <span>
                {t("lotNo")}: <span className="font-mono font-medium text-foreground">{lot.lotNo}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 shrink-0" />
              <span className="font-mono">{lot.contactNumber}</span>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0" />
              <span className="truncate">
                {lot.village}, {lot.tehsil}, {lot.district}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 shrink-0" />
              <span>
                {chamberName} - {t("floor")} {lot.floor}, Pos {lot.position}
              </span>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">{t("type")}: </span>
              <span className="font-medium">{lot.type}</span>
            </div>
            {lot.bagTypeLabel && (
              <div>
                <span className="text-muted-foreground">{t("bagTypeLabel") || "Bag type"}: </span>
                <span className="font-medium">{lot.bagTypeLabel}</span>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">{t("originalSize")}: </span>
              <span className="font-medium">{lot.size} {t("bags")}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t("remaining")}: </span>
              <span className="font-bold text-chart-1">{lot.remainingSize} {t("bags")}</span>
            </div>
            {expectedColdCharge !== undefined && expectedColdCharge > 0 && (
              <div>
                <span className="text-muted-foreground">{t("expectedColdCharges")}: </span>
                <span className="font-bold text-blue-600 dark:text-blue-400">
                  <Currency amount={expectedColdCharge} />
                </span>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">{t("coldChargesPaid")}: </span>
              <span className="font-bold text-green-600 dark:text-green-400">
                <Currency amount={paidCharge} />
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">{t("coldChargesDue")}: </span>
              <span className="font-bold text-amber-600 dark:text-amber-400">
                <Currency amount={dueCharge} />
              </span>
            </div>
          </div>

          {lot.remarks && (
            <p className="mt-2 text-sm text-muted-foreground italic">
              "{lot.remarks}"
            </p>
          )}
        </div>

        <div className="flex sm:flex-col gap-2 shrink-0">
          {lot.saleStatus !== "sold" && lot.remainingSize > 0 && onToggleSale && canEdit && (
            <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
              <Switch
                id={`sale-toggle-${lot.id}`}
                checked={lot.upForSale === 1}
                onCheckedChange={(checked) => onToggleSale(lot, checked)}
                data-testid={`switch-sale-${lot.id}`}
              />
              <Label htmlFor={`sale-toggle-${lot.id}`} className="text-xs flex items-center gap-1 cursor-pointer">
                <ShoppingCart className="h-3 w-3" />
                {t("upForSale")}
              </Label>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEdit(lot)}
            className="gap-2"
            data-testid={`button-edit-lot-${lot.id}`}
          >
            <Edit className="h-4 w-4" />
            {canEdit ? t("edit") : t("view") || "View"}
          </Button>
          {lot.entrySequence && onPrintReceipt && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPrintReceipt(lot)}
              className="gap-2"
              data-testid={`button-print-lot-${lot.id}`}
            >
              <Printer className="h-4 w-4" />
              {t("print")}
            </Button>
          )}
          {lot.saleStatus !== "sold" && lot.remainingSize > 0 && onPartialSale && canEdit && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onPartialSale(lot)}
              className="gap-2"
              data-testid={`button-partial-sale-${lot.id}`}
            >
              {t("partialSale")}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
