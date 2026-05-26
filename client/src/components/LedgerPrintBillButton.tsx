import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Printer, Loader2 } from "lucide-react";
import { authFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { PrintBillDialog } from "@/components/PrintBillDialog";
import type { SalesHistoryWithLastPayment } from "@shared/schema";

interface LedgerPrintBillButtonProps {
  saleId: string;
  testId: string;
}

export function LedgerPrintBillButton({ saleId, testId }: LedgerPrintBillButtonProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [sale, setSale] = useState<SalesHistoryWithLastPayment | null>(null);
  const [open, setOpen] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (loading) return;
    setLoading(true);
    try {
      const res = await authFetch(`/api/sales-history/${saleId}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as SalesHistoryWithLastPayment;
      setSale(data);
      setOpen(true);
    } catch (err) {
      toast({
        title: t("error") || "Error",
        description: t("printBillFetchFailed") || "Could not load sale for printing",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={handleClick}
        disabled={loading}
        className="h-6 w-6 shrink-0"
        title={t("printColdStorageDeductionBill") || "Print Cold Storage Deduction Bill"}
        aria-label={t("printColdStorageDeductionBill") || "Print Cold Storage Deduction Bill"}
        data-testid={testId}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
      </Button>
      {sale && (
        <PrintBillDialog
          sale={sale}
          open={open}
          autoBillType="deduction"
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setSale(null);
          }}
        />
      )}
    </>
  );
}
