import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Edit, Phone, MapPin, Package, Layers } from "lucide-react";
import type { Lot } from "@shared/schema";

interface LotCardProps {
  lot: Lot;
  chamberName: string;
  onEdit: (lot: Lot) => void;
  onPartialSale: (lot: Lot) => void;
}

export function LotCard({ lot, chamberName, onEdit, onPartialSale }: LotCardProps) {
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
            <div>
              <span className="text-muted-foreground">{t("originalSize")}: </span>
              <span className="font-medium">{lot.size} {t("bags")}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t("remaining")}: </span>
              <span className="font-bold text-chart-1">{lot.remainingSize} {t("bags")}</span>
            </div>
          </div>

          {lot.remarks && (
            <p className="mt-2 text-sm text-muted-foreground italic">
              "{lot.remarks}"
            </p>
          )}
        </div>

        <div className="flex sm:flex-col gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEdit(lot)}
            className="gap-2"
            data-testid={`button-edit-lot-${lot.id}`}
          >
            <Edit className="h-4 w-4" />
            {t("edit")}
          </Button>
          {lot.remainingSize > 0 && (
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
