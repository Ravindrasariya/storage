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

interface SaudaDialogProps {
  lot: Lot | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_SAUDA_QUANTITY = 2147483647;

export function SaudaDialog({ lot, open, onOpenChange }: SaudaDialogProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [quantity, setQuantity] = useState("");
  const [buyerLedgerId, setBuyerLedgerId] = useState("");

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

  useEffect(() => {
    if (!open) return;
    setQuantity("");
    setBuyerLedgerId("");
  }, [open, lot?.id]);

  const mutation = useMutation({
    mutationFn: async ({ lotId, count, buyerId }: { lotId: string; count: number; buyerId: string }) => {
      const response = await apiRequest("POST", `/api/lots/${encodeURIComponent(lotId)}/sauda`, {
        quantity: count,
        buyerLedgerId: buyerId,
      });
      return response.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/sauda"] });
      toast({ title: t("success"), description: "Sauda saved / सौदा सहेजा गया", variant: "success" });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: t("error"), description: error.message || "Could not save Sauda", variant: "destructive" });
    },
  });

  const parsedQuantity = Number(quantity);
  const quantityValid = Number.isInteger(parsedQuantity) && parsedQuantity > 0 && parsedQuantity <= MAX_SAUDA_QUANTITY;
  const canSubmit = !!lot && quantityValid && !!buyerLedgerId && buyers.some((buyer) => buyer.id === buyerLedgerId) && !buyersLoading && !buyersError && !mutation.isPending;
  const handleSubmit = () => {
    if (!lot || !canSubmit) return;
    mutation.mutate({ lotId: lot.id, count: parsedQuantity, buyerId: buyerLedgerId });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!mutation.isPending) onOpenChange(nextOpen); }}>
      <DialogContent className="sm:max-w-md [&>button.absolute]:hidden" onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Sauda (सौदा)</DialogTitle>
          <DialogDescription>{lot ? `${lot.farmerName} · ${lot.lotNo}` : ""}</DialogDescription>
        </DialogHeader>
        {!lot ? null : (
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label htmlFor="sauda-quantity">Bag Quantity / बैग मात्रा</Label>
              <Input id="sauda-quantity" type="number" inputMode="numeric" min={1} max={MAX_SAUDA_QUANTITY} step={1} value={quantity}
                onChange={(event) => setQuantity(event.target.value)} aria-invalid={quantity !== "" && !quantityValid} data-testid="input-sauda-quantity" />
              {quantity !== "" && !quantityValid && <p className="text-sm text-destructive" role="alert">Enter a whole number from 1 to {MAX_SAUDA_QUANTITY}.</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="sauda-buyer">Buyer Name / खरीदार का नाम</Label>
              {buyersLoading ? (
                <div className="h-10 rounded-md border bg-muted/40 animate-pulse" aria-label="Loading buyers" />
              ) : buyersError ? (
                <p className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 p-3 text-sm" role="alert">Could not load Buyer Ledger / खरीदार सूची लोड नहीं हुई</p>
              ) : buyers.length === 0 ? (
                <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">No existing buyers available / कोई मौजूदा खरीदार उपलब्ध नहीं</p>
              ) : (
                <Select value={buyerLedgerId} onValueChange={setBuyerLedgerId}>
                  <SelectTrigger id="sauda-buyer" data-testid="select-sauda-buyer"><SelectValue placeholder="Select an existing buyer / मौजूदा खरीदार चुनें" /></SelectTrigger>
                  <SelectContent>{buyers.map((buyer) => <SelectItem key={buyer.id} value={buyer.id}>{buyer.buyerName}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </div>
          </div>
        )}
        <DialogFooter className="flex-row justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>{t("cancel")}</Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit} data-testid="button-submit-sauda">{mutation.isPending ? t("loading") : t("submit")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
