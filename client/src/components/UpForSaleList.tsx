import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ShoppingCart, Phone, MapPin, Package, Check } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SaleLotInfo } from "@shared/schema";

interface UpForSaleListProps {
  saleLots: SaleLotInfo[];
}

export function UpForSaleList({ saleLots }: UpForSaleListProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [selectedLot, setSelectedLot] = useState<SaleLotInfo | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "due">("paid");

  const finalizeSaleMutation = useMutation({
    mutationFn: async ({ lotId, paymentStatus }: { lotId: string; paymentStatus: "paid" | "due" }) => {
      return apiRequest("POST", `/api/lots/${lotId}/finalize-sale`, { paymentStatus });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
      toast({
        title: t("success"),
        description: "Lot marked as sold successfully",
      });
      setSelectedLot(null);
    },
    onError: () => {
      toast({
        title: t("error"),
        description: "Failed to mark lot as sold",
        variant: "destructive",
      });
    },
  });

  const handleConfirmSale = () => {
    if (selectedLot) {
      finalizeSaleMutation.mutate({
        lotId: selectedLot.id,
        paymentStatus,
      });
    }
  };

  const calculateCharge = (lot: SaleLotInfo) => {
    return lot.rate * lot.remainingSize;
  };

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
    <>
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
              className="p-4 rounded-lg border bg-card"
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
                  <div className="mt-2 text-sm">
                    <span className="text-muted-foreground">{t("storageCharge")}: </span>
                    <span className="font-medium text-chart-2">
                      Rs. {calculateCharge(lot).toLocaleString()}
                    </span>
                    <span className="text-muted-foreground text-xs ml-1">
                      ({lot.remainingSize} x Rs.{lot.rate})
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-1 text-chart-1 font-bold">
                    <Package className="h-4 w-4" />
                    <span data-testid={`sale-size-${lot.id}`}>{lot.remainingSize}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {lot.chamberName} | {lot.bagType} | {lot.type}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setSelectedLot(lot)}
                    data-testid={`button-sold-${lot.id}`}
                  >
                    <Check className="h-4 w-4 mr-1" />
                    {t("sold")}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Dialog open={!!selectedLot} onOpenChange={(open) => !open && setSelectedLot(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmSale")}</DialogTitle>
            <DialogDescription>
              {selectedLot && `${selectedLot.farmerName} - ${selectedLot.lotNo}`}
            </DialogDescription>
          </DialogHeader>
          
          {selectedLot && (
            <div className="space-y-4 py-4">
              <div className="p-4 rounded-lg bg-muted">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">{t("storageCharge")}:</span>
                  <span className="text-2xl font-bold text-chart-2">
                    Rs. {calculateCharge(selectedLot).toLocaleString()}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  {selectedLot.remainingSize} {t("bags")} x Rs.{selectedLot.rate} per bag
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("paymentStatus")}</Label>
                <RadioGroup
                  value={paymentStatus}
                  onValueChange={(value) => setPaymentStatus(value as "paid" | "due")}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="paid" id="paid" data-testid="radio-paid" />
                    <Label htmlFor="paid" className="text-green-600 font-medium">
                      {t("paid")}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="due" id="due" data-testid="radio-due" />
                    <Label htmlFor="due" className="text-amber-600 font-medium">
                      {t("due")}
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSelectedLot(null)}
              data-testid="button-cancel-sale"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleConfirmSale}
              disabled={finalizeSaleMutation.isPending}
              data-testid="button-confirm-sale"
            >
              {finalizeSaleMutation.isPending ? t("loading") : t("confirmSale")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
