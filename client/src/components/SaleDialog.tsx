import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, authFetch, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Lot, BuyerLedgerEntry } from "@shared/schema";

interface SaudaMarker {
  lotId: string;
  buyerLedgerId: string;
  quantity: number;
  buyerInitials: string | null;
}

interface SaleDialogProps {
  lot: Lot | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SaleDialog({ lot, open, onOpenChange }: SaleDialogProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [quantity, setQuantity] = useState("");
  const [buyerLedgerId, setBuyerLedgerId] = useState("");
  const [edited, setEdited] = useState(false);

  const { data: savedSaudas, isLoading: saudasLoading } = useQuery<SaudaMarker[]>({
    queryKey: ["/api/sauda"],
    enabled: open,
    staleTime: 0,
  });
  const { data: buyerLedgerData, isLoading: buyersLoading, isError: buyersError } = useQuery<{ buyers: BuyerLedgerEntry[] }>({
    queryKey: ["/api/buyer-ledger", { includeArchived: false }],
    queryFn: async () => {
      const response = await authFetch("/api/buyer-ledger?includeArchived=false");
      if (!response.ok) throw new Error("Could not load buyers");
      return response.json();
    },
    enabled: open,
  });
  const buyers = useMemo(
    () => (buyerLedgerData?.buyers ?? []).filter((buyer) => buyer && buyer.id).slice().sort((a, b) => a.buyerName.localeCompare(b.buyerName)),
    [buyerLedgerData],
  );
  const savedForLot = savedSaudas?.find((marker) => marker.lotId === lot?.id);

  // Initialize once when reopening or changing lots. A late marker response may
  // seed pristine fields, but never replaces anything the operator has edited.
  useEffect(() => {
    if (!open || !lot) return;
    setQuantity("");
    setBuyerLedgerId("");
    setEdited(false);
  }, [open, lot?.id]);
  useEffect(() => {
    if (!open || !lot || !savedForLot || edited) return;
    setQuantity(String(savedForLot.quantity));
    setBuyerLedgerId(savedForLot.buyerLedgerId);
  }, [open, lot?.id, savedForLot, edited]);

  const mutation = useMutation({
    mutationFn: async ({ lotId, quantity: count, buyerId }: { lotId: string; quantity: number; buyerId: string }) => {
      const response = await apiRequest("POST", `/api/lots/${encodeURIComponent(lotId)}/sauda`, {
        quantity: count,
        buyerLedgerId: buyerId,
      });
      return response.json() as Promise<SaudaMarker>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sauda"] });
      toast({ title: t("success"), description: "Sauda saved / सौदा सहेजा गया", variant: "success" });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: t("error"), description: error.message || "Could not save Sauda", variant: "destructive" });
    },
  });

  const maxQuantity = Math.max(0, Math.floor(lot?.remainingSize ?? 0));
  const parsedQuantity = Number(quantity);
  const quantityValid = Number.isInteger(parsedQuantity) && parsedQuantity > 0 && parsedQuantity <= maxQuantity;
  const canSubmit = !!lot && quantityValid && !!buyerLedgerId && !buyersLoading && !buyersError && !mutation.isPending;
  const handleSubmit = () => {
    if (!lot) return;
    if (!quantityValid) {
      toast({ title: t("error"), description: `Enter a whole number from 1 to ${maxQuantity} / 1 से ${maxQuantity} तक पूरी संख्या दर्ज करें`, variant: "destructive" });
      return;
    }
    if (!buyers.some((buyer) => buyer.id === buyerLedgerId)) {
      toast({ title: t("error"), description: "Select an existing buyer / मौजूदा खरीदार चुनें", variant: "destructive" });
      return;
    }
    mutation.mutate({ lotId: lot.id, quantity: parsedQuantity, buyerId: buyerLedgerId });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md [&>button.absolute]:hidden" onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Sauda (सौदा)</DialogTitle>
          <DialogDescription>
            {lot ? `${lot.farmerName} · ${lot.lotNo}` : ""}
            {lot && <span className="block mt-1">{t("remaining")}: <strong className="tabular-nums">{maxQuantity}</strong> {t("bags")}</span>}
          </DialogDescription>
        </DialogHeader>
        {!lot ? null : (
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label htmlFor="sauda-quantity">Bag Quantity / बैग मात्रा <span className="text-muted-foreground font-normal">(max {maxQuantity})</span></Label>
              <Input
                id="sauda-quantity"
                type="number"
                inputMode="numeric"
                min={1}
                max={maxQuantity}
                step={1}
                value={quantity}
                onChange={(event) => { setEdited(true); setQuantity(event.target.value); }}
                aria-invalid={quantity !== "" && !quantityValid}
                data-testid="input-sauda-quantity"
              />
              {quantity !== "" && !quantityValid && (
                <p className="text-sm text-destructive" role="alert">Enter a whole number from 1 to {maxQuantity}.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="sauda-buyer">Buyer Name / खरीदार का नाम</Label>
              {buyersLoading ? (
                <div className="h-10 rounded-md border bg-muted/40 animate-pulse" aria-label="Loading buyers" />
              ) : buyersError ? (
                <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 p-3 text-sm">
                  <span>Could not load Buyer Ledger / खरीदार सूची लोड नहीं हुई</span>
                </div>
              ) : buyers.length === 0 ? (
                <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">No existing buyers available / कोई मौजूदा खरीदार उपलब्ध नहीं</p>
              ) : (
                <Select value={buyerLedgerId} onValueChange={(value) => { setEdited(true); setBuyerLedgerId(value); }}>
                  <SelectTrigger id="sauda-buyer" data-testid="select-sauda-buyer">
                    <SelectValue placeholder="Select an existing buyer / मौजूदा खरीदार चुनें" />
                  </SelectTrigger>
                  <SelectContent>
                    {buyers.map((buyer) => <SelectItem key={buyer.id} value={buyer.id}>{buyer.buyerName}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {saudasLoading && <p className="text-xs text-muted-foreground">Loading saved Sauda… / सहेजा सौदा लोड हो रहा है…</p>}
            </div>
            {mutation.isPending && <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-1/2 animate-pulse bg-primary" /></div>}
          </div>
        )}
        <DialogFooter className="flex-row justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>{t("cancel")}</Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit} data-testid="button-submit-sauda">
            {mutation.isPending ? t("loading") : t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
