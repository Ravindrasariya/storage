import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Phone, MapPin, Package } from "lucide-react";
import type { SaleLotInfo } from "@shared/schema";

interface UpForSaleListProps {
  saleLots: SaleLotInfo[];
}

export function UpForSaleList({ saleLots }: UpForSaleListProps) {
  const { t } = useI18n();

  if (saleLots.length === 0) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <ShoppingCart className="h-5 w-5 text-chart-3" />
          <h3 className="text-lg font-semibold">{t("upForSale") || "Up for Sale"}</h3>
        </div>
        <div className="text-center py-8 text-muted-foreground">
          No lots are currently marked for sale
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <ShoppingCart className="h-5 w-5 text-chart-3" />
        <h3 className="text-lg font-semibold">{t("upForSale") || "Up for Sale"}</h3>
        <Badge variant="secondary" className="ml-auto">{saleLots.length}</Badge>
      </div>
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {saleLots.map((lot) => (
          <div
            key={lot.id}
            className="p-4 rounded-lg border bg-card hover-elevate"
            data-testid={`sale-lot-${lot.id}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-base" data-testid={`sale-farmer-${lot.id}`}>
                    {lot.farmerName}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {lot.lotNo}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    {lot.contactNumber}
                  </span>
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {lot.village}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-1 text-chart-1 font-bold">
                  <Package className="h-4 w-4" />
                  <span data-testid={`sale-size-${lot.id}`}>{lot.remainingSize}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {lot.chamberName} | {lot.bagType} | {lot.type}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
