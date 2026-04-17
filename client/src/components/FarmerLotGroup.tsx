import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  ChevronRight,
  ChevronDown,
  Edit,
  Phone,
  MapPin,
  ShoppingCart,
  CheckCircle,
  Clock,
  Printer,
  Truck,
} from "lucide-react";
import type { Lot } from "@shared/schema";
import { Currency } from "@/components/Currency";

export interface LotWithCharges {
  lot: Lot;
  lotPaidCharge: number;
  lotDueCharge: number;
  expectedColdCharge: number;
}

interface FarmerLotGroupProps {
  farmerName: string;
  village: string;
  tehsil?: string;
  district?: string;
  contactNumber: string;
  lots: LotWithCharges[];
  chamberMap: Record<string, string>;
  onEdit: (lot: Lot) => void;
  onToggleSale?: (lot: Lot, upForSale: boolean) => void;
  onPrintReceipt?: (lot: Lot) => void;
  onSale?: (lot: Lot) => void;
  canEdit?: boolean;
  chargeUnit?: "bag" | "quintal";
}

const ROW_GRID =
  "grid grid-cols-[24px_minmax(70px,0.9fr)_minmax(70px,0.9fr)_minmax(70px,0.8fr)_minmax(70px,0.9fr)_minmax(140px,1.6fr)_minmax(70px,0.7fr)_minmax(80px,0.8fr)] gap-x-2 items-center";

function getQualityColor(quality: string) {
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
}

function getBagTypeColor(bagType: string) {
  return bagType === "wafer" ? "bg-chart-1/10 text-chart-1" : "bg-chart-2/10 text-chart-2";
}

export function FarmerLotGroup({
  farmerName,
  village,
  tehsil,
  district,
  contactNumber,
  lots,
  chamberMap,
  onEdit,
  onToggleSale,
  onPrintReceipt,
  onSale,
  canEdit = true,
  chargeUnit,
}: FarmerLotGroupProps) {
  const { t } = useI18n();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (lotId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(lotId)) next.delete(lotId);
      else next.add(lotId);
      return next;
    });
  };

  const totalBags = lots.reduce((s, l) => s + (l.lot.size || 0), 0);
  const remainingBags = lots.reduce((s, l) => s + (l.lot.remainingSize || 0), 0);
  const totalExpected = lots.reduce((s, l) => s + (l.expectedColdCharge || 0), 0);
  const totalPaid = lots.reduce((s, l) => s + (l.lotPaidCharge || 0), 0);
  const totalDue = lots.reduce((s, l) => s + (l.lotDueCharge || 0), 0);
  const farmerKey = `${contactNumber}-${farmerName}`.replace(/\s+/g, "_");
  const addressLine = [village, tehsil, district].filter(Boolean).join(", ");

  return (
    <Card className="p-4" data-testid={`card-farmer-group-${farmerKey}`}>
      {/* Farmer header */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-3 pb-3 border-b">
        <h3 className="text-lg font-semibold" data-testid={`text-farmer-name-${farmerKey}`}>
          {farmerName}
        </h3>
        {addressLine && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4 shrink-0" />
            <span data-testid={`text-farmer-address-${farmerKey}`}>{addressLine}</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Phone className="h-4 w-4 shrink-0" />
          <span className="font-mono" data-testid={`text-farmer-phone-${farmerKey}`}>
            {contactNumber}
          </span>
        </div>
        <div className="text-xs text-muted-foreground ml-auto" data-testid={`text-farmer-summary-${farmerKey}`}>
          {lots.length} {lots.length === 1 ? t("lot") : t("lots")} · {remainingBags}/{totalBags} {t("bags") || "bags"}
        </div>
      </div>

      {/* Aggregated charges across all of this farmer's lots */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm mb-3 pb-3 border-b">
        {totalExpected > 0 && (
          <div>
            <span className="text-muted-foreground">{t("expectedColdCharges")}: </span>
            <span
              className="font-bold text-blue-600 dark:text-blue-400"
              data-testid={`text-farmer-expected-${farmerKey}`}
            >
              <Currency amount={totalExpected} />
            </span>
          </div>
        )}
        <div>
          <span className="text-muted-foreground">{t("coldChargesPaid")}: </span>
          <span
            className="font-bold text-green-600 dark:text-green-400"
            data-testid={`text-farmer-paid-${farmerKey}`}
          >
            <Currency amount={totalPaid} />
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">{t("coldChargesDue")}: </span>
          <span
            className="font-bold text-amber-600 dark:text-amber-400"
            data-testid={`text-farmer-due-${farmerKey}`}
          >
            <Currency amount={totalDue} />
          </span>
        </div>
      </div>

      {/* Lot table — compact rows fill the LEFT HALF on desktop; expanded
          detail panels span the FULL width so dense action UI is not crowded. */}
      <div className="overflow-x-auto">
        {/* Column headers */}
        <div className={`${ROW_GRID} md:max-w-[50%] px-2 py-2 text-xs font-medium text-muted-foreground border-b min-w-[600px] md:min-w-0`}>
          <span></span>
          <span>{t("lotNo")}</span>
          <span>{t("marka") || "Marka"}</span>
          <span>{t("potatoType") || "Potato Type"}</span>
          <span>{t("potatoVariety") || "Variety"}</span>
          <span>{t("location") || "Location"}</span>
          <span className="text-right">{t("originalSize") || "Original"}</span>
          <span className="text-right">{t("remaining") || "Remaining"}</span>
        </div>

        {/* Lot rows */}
        <div className="divide-y">
          {lots.map(({ lot, lotPaidCharge, lotDueCharge, expectedColdCharge }) => {
            const isExpanded = expandedIds.has(lot.id);
            const paidCharge = lotPaidCharge;
            const dueCharge = lotDueCharge;
            const chamberName = chamberMap[lot.chamberId] || "Unknown";
            const chamberAbbrev = /chamber/i.test(chamberName)
              ? chamberName.replace(/chamber\s*/i, "Ch-")
              : `Ch-${chamberName}`;
            const locationStr = `${chamberAbbrev}, FL-${lot.floor}, ${lot.position}`;

            return (
              <div key={lot.id}>
                {/* Compact row */}
                <button
                  type="button"
                  onClick={() => toggleExpand(lot.id)}
                  className={`${ROW_GRID} md:max-w-[50%] w-full px-2 py-2 text-sm hover-elevate text-left min-w-[600px] md:min-w-0 ${
                    isExpanded ? "bg-muted/40" : ""
                  }`}
                  data-testid={`row-lot-${lot.id}`}
                  aria-expanded={isExpanded}
                >
                  <span className="flex justify-center text-muted-foreground">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </span>
                  <span className="font-mono truncate" data-testid={`cell-receipt-${lot.id}`}>
                    {lot.lotNo || "-"}
                  </span>
                  <span className="truncate" data-testid={`cell-marka-${lot.id}`}>
                    {lot.marka || "-"}
                  </span>
                  <span className="truncate" data-testid={`cell-bagtype-${lot.id}`}>
                    <Badge variant="outline" className={`${getBagTypeColor(lot.bagType)} text-xs`}>
                      {t(lot.bagType) || lot.bagType}
                    </Badge>
                  </span>
                  <span className="truncate" data-testid={`cell-variety-${lot.id}`}>
                    {lot.type}
                  </span>
                  <span className="whitespace-nowrap" data-testid={`cell-location-${lot.id}`}>
                    {locationStr}
                  </span>
                  <span className="text-right" data-testid={`cell-originalsize-${lot.id}`}>
                    {lot.size}
                  </span>
                  <span className="text-right font-bold text-chart-1" data-testid={`cell-remaining-${lot.id}`}>
                    {lot.remainingSize}
                  </span>
                </button>

                {/* Expanded details — ALWAYS rendered for searchability; hidden via CSS when collapsed.
                    Spans the FULL row width (compact rows above are constrained to the left half). */}
                <div
                  className={`w-full bg-muted/20 border-l-2 border-primary/30 transition-all overflow-hidden ${
                    isExpanded ? "max-h-[1000px] py-3 px-3" : "max-h-0 py-0 px-3 opacity-0"
                  }`}
                  aria-hidden={!isExpanded}
                  data-testid={`expanded-lot-${lot.id}`}
                >
                  <div className="space-y-3">
                    <div className="min-w-0 space-y-3">
                      {/* Status badges + inline action buttons */}
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={getQualityColor(lot.quality)}>
                          {t(lot.quality)}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400 capitalize"
                          data-testid={`badge-potato-size-${lot.id}`}
                        >
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
                            className={
                              paidCharge > 0 && dueCharge === 0
                                ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400"
                            }
                            data-testid={`badge-payment-${lot.id}`}
                          >
                            {paidCharge > 0 && dueCharge === 0 ? (
                              <>
                                <CheckCircle className="h-3 w-3 mr-1" />
                                {t("paid")}
                              </>
                            ) : (
                              <>
                                <Clock className="h-3 w-3 mr-1" />
                                {t("due")}
                              </>
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

                        {/* Inline action buttons pushed to the right */}
                        <div className="flex flex-wrap items-center gap-2 ml-auto">
                          {lot.saleStatus !== "sold" && lot.remainingSize > 0 && onToggleSale && canEdit && (
                            <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                              <Switch
                                id={`sale-toggle-${lot.id}`}
                                checked={lot.upForSale === 1}
                                onCheckedChange={(checked) => onToggleSale(lot, checked)}
                                data-testid={`switch-sale-${lot.id}`}
                              />
                              <Label
                                htmlFor={`sale-toggle-${lot.id}`}
                                className="text-xs flex items-center gap-1 cursor-pointer"
                              >
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
                          {lot.saleStatus !== "sold" && lot.remainingSize > 0 && onSale && canEdit && (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => onSale(lot)}
                              className="gap-2"
                              data-testid={`button-sale-lot-${lot.id}`}
                            >
                              <ShoppingCart className="h-4 w-4" />
                              {t("sale")}
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Lot meta */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        {lot.rstNo && (
                          <span>
                            {t("rstNo")}: <span className="font-medium text-foreground">{lot.rstNo}</span>
                          </span>
                        )}
                        {lot.vehicle && (
                          <span className="flex items-center gap-1">
                            <Truck className="h-3 w-3 shrink-0" />
                            <span className="font-medium text-foreground">{lot.vehicle}</span>
                          </span>
                        )}
                        {lot.bagTypeLabel && (
                          <span>
                            {t("bagTypeLabel") || "Bag type"}:{" "}
                            <span className="font-medium text-foreground">{lot.bagTypeLabel}</span>
                          </span>
                        )}
                        {chargeUnit === "quintal" && lot.netWeight && lot.netWeight > 0 && (
                          <span>
                            {t("netWeightQtl")}:{" "}
                            <span className="font-medium text-foreground">
                              {lot.netWeight} {t("kg")}
                            </span>
                          </span>
                        )}
                      </div>

                      {lot.remarks && (
                        <p className="text-sm text-muted-foreground italic">"{lot.remarks}"</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
