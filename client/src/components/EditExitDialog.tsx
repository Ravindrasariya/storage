import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, authFetch, invalidateSaleSideEffects } from "@/lib/queryClient";
import { Pencil, Save } from "lucide-react";
import type { ExitHistory } from "@shared/schema";

type SiblingRow = {
  exitId: string;
  exitDate: string;
  billNumber: number;
  bagsExited: number;
  isReversed: number;
  saleId: string;
  lotNo: string;
};

interface EditExitDialogProps {
  exit: ExitHistory | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Parent sale id for the currently-open ExitDialog — used to invalidate
  // its specific exits-by-sale query so the row refreshes immediately.
  parentSaleId?: string;
}

export function EditExitDialog({ exit, open, onOpenChange, parentSaleId }: EditExitDialogProps) {
  const { t } = useI18n();
  const { toast } = useToast();

  const [billNumberInput, setBillNumberInput] = useState<string>("");
  const [exitDateInput, setExitDateInput] = useState<string>("");
  const [billNumberError, setBillNumberError] = useState<string | null>(null);
  const [exitDateError, setExitDateError] = useState<string | null>(null);

  const originalBillNumber = exit?.billNumber ?? null;
  // Convert the stored exit date (UTC ISO from pg) into the IST calendar
  // day so the date input pre-fills with the day the operator actually
  // wrote on the slip — matches how the exit-history list displays it.
  const originalDate = exit
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(exit.exitDate))
    : "";

  useEffect(() => {
    if (open && exit) {
      setBillNumberInput(String(exit.billNumber || ""));
      setExitDateInput(originalDate);
      setBillNumberError(null);
      setExitDateError(null);
    }
    if (!open) {
      setBillNumberInput("");
      setExitDateInput("");
      setBillNumberError(null);
      setExitDateError(null);
    }
  }, [open, exit?.id]);

  // Pre-fetch siblings so we can show a "covers N lots" notice for
  // Master Nikasi entries. Same endpoint used by reprint-batch in
  // ExitDialog — kept thin so the dialog opens fast.
  const { data: siblingsData } = useQuery<{ exits: SiblingRow[] }>({
    queryKey: ["/api/exits/by-bill", originalBillNumber],
    queryFn: async () => {
      if (!originalBillNumber) return { exits: [] };
      const response = await authFetch(`/api/exits/by-bill/${originalBillNumber}`);
      return response.json();
    },
    enabled: open && !!originalBillNumber,
  });

  // Only non-reversed siblings are part of the edit transaction.
  const activeSiblings = (siblingsData?.exits || []).filter(s => s.isReversed === 0);
  const affectedLotNos = Array.from(new Set(activeSiblings.map(s => s.lotNo))).sort();
  const isCombined = activeSiblings.length >= 2;

  const updateMutation = useMutation({
    mutationFn: async (payload: { newBillNumber?: number; newExitDate?: string }) => {
      const response = await apiRequest(
        "PATCH",
        `/api/exits/by-bill/${originalBillNumber}`,
        payload,
      );
      return response.json() as Promise<{ updatedCount: number; effectiveBillNumber: number }>;
    },
    onSuccess: (data) => {
      toast({
        title: t("success"),
        description: t("exitUpdated"),
        variant: "success",
      });
      // The exit's bill # may have changed. Invalidate by-bill caches
      // for BOTH the old and the new number so reprint lookups don't
      // stale-resolve, plus the open-sale's exits list and the broad
      // sale side-effect bundle for downstream pages.
      queryClient.invalidateQueries({ queryKey: ["/api/exits/by-bill", originalBillNumber] });
      if (data.effectiveBillNumber !== originalBillNumber) {
        queryClient.invalidateQueries({ queryKey: ["/api/exits/by-bill", data.effectiveBillNumber] });
      }
      if (parentSaleId) {
        queryClient.invalidateQueries({ queryKey: ["/api/sales-history", parentSaleId, "exits"] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/cold-storage"] });
      invalidateSaleSideEffects(queryClient);
      onOpenChange(false);
    },
    onError: (error: Error & { body?: { field?: string; error?: string } }) => {
      const field = error.body?.field;
      const msg = error.body?.error || error.message || t("failedToUpdateExit");
      if (field === "newBillNumber") {
        setBillNumberError(msg);
      } else if (field === "newExitDate") {
        setExitDateError(msg);
      }
      toast({ title: t("error"), description: msg, variant: "destructive" });
    },
  });

  const handleSave = () => {
    setBillNumberError(null);
    setExitDateError(null);

    const trimmedBill = billNumberInput.trim();
    const trimmedDate = exitDateInput.trim();

    const parsedBill = trimmedBill === "" ? NaN : parseInt(trimmedBill, 10);
    if (trimmedBill === "" || !Number.isFinite(parsedBill) || parsedBill <= 0) {
      setBillNumberError("Exit bill number must be a positive integer");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
      setExitDateError("Exit date is required (YYYY-MM-DD)");
      return;
    }

    const payload: { newBillNumber?: number; newExitDate?: string } = {};
    if (parsedBill !== originalBillNumber) payload.newBillNumber = parsedBill;
    if (trimmedDate !== originalDate) payload.newExitDate = trimmedDate;

    if (payload.newBillNumber === undefined && payload.newExitDate === undefined) {
      toast({ title: t("error"), description: t("noChangesToSave"), variant: "destructive" });
      return;
    }

    updateMutation.mutate(payload);
  };

  if (!exit) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5" />
            {t("editExitTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {isCombined && (
            <div
              className="rounded-md border border-blue-300 dark:border-blue-700 bg-blue-50/60 dark:bg-blue-900/20 p-2 text-xs text-blue-900 dark:text-blue-100"
              data-testid="text-edit-exit-affected-lots"
            >
              <div>{t("combinedNikasiNotice").replace("{n}", String(activeSiblings.length))}</div>
              <div className="mt-1">
                <span className="font-medium">{t("affectedLots")}:</span>{" "}
                {affectedLotNos.join(", ")}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label htmlFor="edit-exit-bill-number" className="text-sm">
              {t("exitBillNumber")}
            </Label>
            <Input
              id="edit-exit-bill-number"
              type="number"
              min={1}
              value={billNumberInput}
              onChange={(e) => {
                setBillNumberInput(e.target.value);
                if (billNumberError) setBillNumberError(null);
              }}
              className={`h-9 ${billNumberError ? "border-red-500 focus-visible:ring-red-500" : ""}`}
              data-testid="input-edit-exit-bill-number"
              aria-invalid={!!billNumberError}
            />
            {billNumberError && (
              <span
                className="text-[11px] text-red-600 dark:text-red-400"
                data-testid="error-edit-exit-bill-number"
              >
                {billNumberError}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="edit-exit-date" className="text-sm">
              {t("date")}
            </Label>
            <Input
              id="edit-exit-date"
              type="date"
              value={exitDateInput}
              // Match the server's "≤ tomorrow" guard so the picker
              // can't surface 2127-style typos in the first place.
              max={new Intl.DateTimeFormat("en-CA", {
                timeZone: "Asia/Kolkata",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              }).format(new Date(Date.now() + 24 * 60 * 60 * 1000))}
              onChange={(e) => {
                setExitDateInput(e.target.value);
                if (exitDateError) setExitDateError(null);
              }}
              className={`h-9 ${exitDateError ? "border-red-500 focus-visible:ring-red-500" : ""}`}
              data-testid="input-edit-exit-date"
              aria-invalid={!!exitDateError}
            />
            {exitDateError && (
              <span
                className="text-[11px] text-red-600 dark:text-red-400"
                data-testid="error-edit-exit-date"
              >
                {exitDateError}
              </span>
            )}
          </div>
        </div>

        <DialogFooter className="flex gap-2 justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-edit-exit"
          >
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={updateMutation.isPending}
            data-testid="button-save-edit-exit"
          >
            <Save className="h-3 w-3 mr-1" />
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
