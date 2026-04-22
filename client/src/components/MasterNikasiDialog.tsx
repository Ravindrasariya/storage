import { useState, useMemo, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, invalidateSaleSideEffects } from "@/lib/queryClient";
import { PackageMinus, Printer, Plus, Trash2, Loader2 } from "lucide-react";
import { format } from "date-fns";
import type { ColdStorage } from "@shared/schema";
import type { LotWithCharges } from "@/components/FarmerLotGroup";

// Sentinel value used as the SelectItem `value` for lots whose marka is
// blank/null. shadcn's SelectItem disallows empty-string values, so we
// translate "" <-> NO_MARKA at the UI boundary while keeping the DB
// canonical marka ("") inside lookup keys and the submit payload.
const NO_MARKA = "__no_marka__";
const canonMarka = (m: string) => (m === NO_MARKA ? "" : (m || "").trim());

interface MasterNikasiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  farmerName: string;
  village: string;
  contactNumber: string;
  farmerLedgerId: string | null;
  lots: LotWithCharges[];
}

interface RowState {
  rowKey: string;
  // The user-facing identity of a row is (lotNo, marka). The actual
  // database lot id is resolved from this pair at render/submit time.
  // Multiple lots can share the same lotNo when added separately via the
  // Lot Entry tab with different markas — that is the only legitimate
  // case where one Receipt # has more than one Marka option.
  lotNo: string;
  marka: string;
  exitBags: string;
  kataCharges: string;
  extraHammaliPerBag: string;
  gradingCharges: string;
}

interface MasterNikasiResult {
  sharedExitBillNumber: number;
  exitDate: string;
  sales: Array<{
    saleId: string;
    lotId: string;
    lotNo: string;
    marka: string | null;
    bagsExited: number;
    baseColdCharge: number;
    kataCharges: number;
    extraHammaliPerBag: number;
    extraHammali: number;
    gradingCharges: number;
    totalColdStorageCharge: number;
    coldStorageBillNumber: number | null;
    potatoType: string;
    bagType: string;
    chamberName: string;
    floor: number;
    position: string;
  }>;
  farmer: {
    farmerName: string;
    contactNumber: string;
    village: string;
    tehsil: string;
    district: string;
    state: string;
    entityType: string;
  };
}

const newRow = (lotNo = "", marka = ""): RowState => ({
  rowKey: `r${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  lotNo,
  marka,
  exitBags: "",
  kataCharges: "",
  extraHammaliPerBag: "",
  gradingCharges: "",
});

function fmt(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function MasterNikasiDialog({
  open,
  onOpenChange,
  farmerName,
  village,
  contactNumber,
  farmerLedgerId,
  lots,
}: MasterNikasiDialogProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  const { data: coldStorage } = useQuery<ColdStorage>({
    queryKey: ["/api/cold-storage"],
  });

  const { data: farmerLedgerData } = useQuery<{ farmers: Array<{ id: string; entityType: string; customColdChargeRate: number | null; customHammaliRate: number | null }> }>({
    queryKey: ["/api/farmer-ledger"],
  });
  const farmerEntry = farmerLedgerData?.farmers?.find(f => f.id === farmerLedgerId);
  const isCompany = farmerEntry?.entityType === "company";
  const partyRowLabel = isCompany ? "कंपनी / Company" : "किसान / Farmer";

  const todayIso = new Date().toISOString().slice(0, 10);
  const [exitDate, setExitDate] = useState(todayIso);
  const [rows, setRows] = useState<RowState[]>(() => [newRow()]);
  const [result, setResult] = useState<MasterNikasiResult | null>(null);

  // Reset state whenever dialog opens
  useEffect(() => {
    if (open) {
      setExitDate(new Date().toISOString().slice(0, 10));
      // If exactly one lot is available, pre-select it.
      const only = lots.length === 1 ? lots[0].lot : null;
      const onlyMarka = (only?.marka || "").trim();
      // Use the NO_MARKA sentinel when the single lot has a blank marka,
      // so the row is immediately resolvable (resolveLot/canSubmit
      // require a non-empty marka value in state).
      const onlyMarkaState = only ? (onlyMarka === "" ? NO_MARKA : onlyMarka) : "";
      setRows([newRow(only?.lotNo || "", onlyMarkaState)]);
      setResult(null);
    }
  }, [open, lots]);

  // Index lots by (lotNo, marka) so a row can resolve its database lot id
  // from the user-facing identity. Per the operator workflow, the same
  // (lotNo, marka) pair must never appear on more than one lot — if it
  // does, that is a data error and we expose it instead of silently
  // resolving to a random lot.
  const { lotByKey, duplicateKey } = useMemo(() => {
    const map = new Map<string, LotWithCharges>();
    let dupe: string | null = null;
    for (const l of lots) {
      const key = `${l.lot.lotNo}::${(l.lot.marka || "").trim()}`;
      if (map.has(key)) dupe = key;
      else map.set(key, l);
    }
    return { lotByKey: map, duplicateKey: dupe };
  }, [lots]);

  // Map of lotNo -> sorted distinct markas attached to that lotNo. We
  // intentionally include the blank marka ("") as a real option so lots
  // entered without a marka remain selectable.
  const markasByLotNo = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of lots) {
      const arr = m.get(l.lot.lotNo) ?? [];
      const mk = (l.lot.marka || "").trim();
      if (!arr.includes(mk)) arr.push(mk);
      m.set(l.lot.lotNo, arr);
    }
    m.forEach((arr, k) => m.set(k, arr.sort()));
    return m;
  }, [lots]);

  // Distinct lotNos (Receipt # options) for this farmer/company.
  const allLotNos = useMemo(() => {
    return Array.from(new Set(lots.map(l => l.lot.lotNo))).sort();
  }, [lots]);

  // Helper: resolve a row's lot id from (lotNo, marka).
  const resolveLot = (lotNo: string, marka: string): LotWithCharges | undefined => {
    if (!lotNo || !marka) return undefined;
    return lotByKey.get(`${lotNo}::${canonMarka(marka)}`);
  };

  // Used (lotNo, marka) pairs across rows, so duplicates are blocked.
  const usedKeys = useMemo(
    () => new Set(rows.filter(r => r.lotNo && r.marka).map(r => `${r.lotNo}::${canonMarka(r.marka)}`)),
    [rows],
  );

  // Per-row live computation of base cold charge (mirrors server logic).
  const calcBaseCharge = (lwc: LotWithCharges | undefined, exitBags: number): number => {
    if (!coldStorage || !lwc) return 0;
    const lot = lwc.lot;
    if (lot.baseColdChargesBilled === 1) return 0;
    if (!exitBags || exitBags <= 0) return 0;
    const useWafer = lot.bagType === "wafer";
    const gCold = useWafer ? (coldStorage.waferColdCharge || 0) : (coldStorage.seedColdCharge || 0);
    const gHam = useWafer ? (coldStorage.waferHammali || 0) : (coldStorage.seedHammali || 0);
    const cRate = farmerEntry?.customColdChargeRate ?? gCold;
    const hRate = farmerEntry?.customHammaliRate ?? gHam;
    const effUnit = isCompany ? "quintal" : (coldStorage.chargeUnit || "bag");
    if (effUnit === "quintal") {
      const cQuintal = (lot.netWeight && lot.size > 0)
        ? (lot.netWeight * exitBags * cRate) / (lot.size * 100)
        : 0;
      return cQuintal + hRate * exitBags;
    }
    return exitBags * (cRate + hRate);
  };

  const rowTotals = rows.map((r) => {
    const exitBags = Number(r.exitBags) || 0;
    const lwc = resolveLot(r.lotNo, r.marka);
    const base = calcBaseCharge(lwc, exitBags);
    const kata = Number(r.kataCharges) || 0;
    const extraPerBag = Number(r.extraHammaliPerBag) || 0;
    const extra = extraPerBag * exitBags;
    const grading = Number(r.gradingCharges) || 0;
    return { base, kata, extra, extraPerBag, grading, total: base + kata + extra + grading, exitBags };
  });
  const grandTotal = rowTotals.reduce((s, r) => s + r.total, 0);
  const totalBags = rowTotals.reduce((s, r) => s + r.exitBags, 0);

  const updateRow = (key: string, patch: Partial<RowState>) => {
    setRows(prev => prev.map(r => (r.rowKey === key ? { ...r, ...patch } : r)));
  };

  const removeRow = (key: string) => {
    setRows(prev => (prev.length === 1 ? prev : prev.filter(r => r.rowKey !== key)));
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!farmerLedgerId) throw new Error("Missing farmer ledger");
      const cleaned: Array<{
        lotId: string;
        exitBags: number;
        kataCharges: number;
        extraHammaliPerBag: number;
        gradingCharges: number;
      }> = [];
      const seenKey = new Set<string>();
      for (const r of rows) {
        const bags = Number(r.exitBags);
        if (!r.lotNo || !r.marka || !Number.isFinite(bags) || bags <= 0) continue;
        const lwc = resolveLot(r.lotNo, r.marka);
        if (!lwc) throw new Error(`No lot matches Receipt ${r.lotNo} / Marka ${r.marka}`);
        if (bags > lwc.lot.remainingSize) {
          throw new Error(`Lot ${lwc.lot.lotNo}: only ${lwc.lot.remainingSize} bag(s) remaining`);
        }
        const key = `${r.lotNo}::${canonMarka(r.marka)}`;
        if (seenKey.has(key)) throw new Error(t("duplicateReceipt"));
        seenKey.add(key);
        cleaned.push({
          lotId: lwc.lot.id,
          exitBags: bags,
          kataCharges: Number(r.kataCharges) || 0,
          extraHammaliPerBag: Number(r.extraHammaliPerBag) || 0,
          gradingCharges: Number(r.gradingCharges) || 0,
        });
      }
      if (cleaned.length === 0) throw new Error("Add at least one valid row.");
      const res = await apiRequest("POST", "/api/farmers/master-nikasi", {
        farmerLedgerId,
        exitDate: new Date(exitDate + "T00:00:00").toISOString(),
        rows: cleaned,
      });
      return (await res.json()) as MasterNikasiResult;
    },
    onSuccess: (data) => {
      setResult(data);
      invalidateSaleSideEffects(queryClient);
      queryClient.invalidateQueries({ queryKey: ["/api/farmers"] });
      toast({ title: t("masterNikasi"), description: `${t("exitBillNumber")} ${data.sharedExitBillNumber}` });
      // Auto-print after a short delay so DOM renders the print block.
      setTimeout(() => {
        handlePrint();
      }, 250);
    },
    onError: (err: Error) => {
      toast({ title: t("error") || "Error", description: err.message, variant: "destructive" });
    },
  });

  const handlePrint = () => {
    if (!printRef.current) return;
    const printContent = printRef.current.innerHTML;
    const printStyles = `
      @page { size: A4; margin: 8mm; }
      body { font-family: 'Noto Sans Devanagari', Arial, sans-serif; padding: 0; margin: 0; font-size: 13px; }
      .copies-container { display: flex; flex-direction: column; height: 100vh; }
      .copy { flex: 1; padding: 10px 18px; border-bottom: 2px dashed #000; page-break-inside: avoid; }
      .copy:last-child { border-bottom: none; }
      .copy-label { text-align: right; font-size: 11px; font-weight: bold; color: #666; margin-bottom: 6px; }
      .header { text-align: center; margin-bottom: 8px; }
      .header h1 { font-size: 18px; margin: 0 0 4px; }
      .header h2 { font-size: 14px; margin: 0; font-weight: normal; border: 1px solid #000; padding: 3px 10px; display: inline-block; }
      .header h3 { font-size: 14px; margin: 6px 0 0; }
      .meta { display: flex; justify-content: space-between; font-size: 12px; margin: 6px 0; }
      .party { font-size: 13px; margin-bottom: 6px; }
      table.nik { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 4px; }
      table.nik th, table.nik td { border: 1px solid #000; padding: 3px 4px; text-align: right; }
      table.nik th { background: #f3f3f3; text-align: center; }
      table.nik td.lft { text-align: left; }
      table.nik tr.tot td { font-weight: bold; background: #f8f8f8; }
      .signature { margin-top: 14px; text-align: right; font-size: 12px; }
      .signature-line { border-top: 1px solid #000; width: 200px; margin-left: auto; padding-top: 4px; }
      .footer { text-align: center; margin-top: 8px; font-size: 10px; color: #666; }
    `;
    const htmlContent = `<!DOCTYPE html><html><head><title>${t("masterNikasi")}</title><style>${printStyles}</style></head><body><div class="copies-container"><div class="copy"><div class="copy-label">OFFICE COPY / कार्यालय प्रति</div>${printContent}</div><div class="copy"><div class="copy-label">CUSTOMER COPY / ग्राहक प्रति</div>${printContent}</div></div></body></html>`;
    const printWindow = window.open("", "_blank", "width=595,height=842");
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
    } else {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = "position:absolute;width:0;height:0;border:none;left:-9999px;";
      document.body.appendChild(iframe);
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.open(); doc.write(htmlContent); doc.close();
        setTimeout(() => {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          setTimeout(() => document.body.removeChild(iframe), 1000);
        }, 250);
      }
    }
  };

  const validRowCount = rows.filter(r => {
    if (!r.lotNo || !r.marka) return false;
    const bags = Number(r.exitBags);
    if (!Number.isFinite(bags) || bags <= 0) return false;
    const lwc = resolveLot(r.lotNo, r.marka);
    if (!lwc) return false;
    return bags <= lwc.lot.remainingSize;
  }).length;
  const canSubmit = !!farmerLedgerId && validRowCount > 0 && !duplicateKey && !submitMutation.isPending && !result;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageMinus className="h-5 w-5" />
            {t("masterNikasiTitle")}
          </DialogTitle>
          <DialogDescription>{t("masterNikasiDesc")}</DialogDescription>
        </DialogHeader>

        {/* Party + exit date strip */}
        <div className="flex flex-wrap items-end gap-4 bg-muted/40 p-3 rounded-md text-sm">
          <div>
            <div className="text-xs text-muted-foreground">{partyRowLabel}</div>
            <div className="font-semibold" data-testid="text-mn-farmer-name">{farmerName}</div>
            <div className="text-xs text-muted-foreground">{village} · <span className="font-mono">{contactNumber}</span></div>
          </div>
          <div className="ml-auto flex items-end gap-3">
            <div>
              <Label htmlFor="mn-exit-date" className="text-xs">{t("exitDate")}</Label>
              <Input
                id="mn-exit-date"
                type="date"
                value={exitDate}
                onChange={(e) => setExitDate(e.target.value)}
                disabled={!!result}
                className="w-40"
                data-testid="input-mn-exit-date"
              />
            </div>
            {result && (
              <div className="text-right">
                <div className="text-xs text-muted-foreground">{t("exitBillNumber")}</div>
                <div className="text-lg font-bold text-amber-600" data-testid="text-mn-bill">#{result.sharedExitBillNumber}</div>
              </div>
            )}
          </div>
        </div>

        {/* Grid */}
        {lots.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{t("noLotsAvailable")}</p>
        ) : duplicateKey ? (
          <p className="text-sm text-destructive py-6 text-center" data-testid="text-mn-duplicate-error">
            {t("duplicateLotData")} "{duplicateKey.replace("::", " / ")}". {t("fixDuplicateLot")}
          </p>
        ) : (
          <div className="overflow-x-auto border border-blue-700 rounded-md">
            <table className="w-full text-xs min-w-[1200px] border-collapse [&_th]:border [&_th]:border-blue-700 [&_td]:border [&_td]:border-border">
              <thead className="bg-blue-700 text-white">
                <tr>
                  <th className="p-2 text-left">{t("receiptNo")}</th>
                  <th className="p-2 text-left">{t("marka") || "Marka"}</th>
                  <th className="p-2 text-right">{t("remainingBagsShort")}</th>
                  <th className="p-2 text-right">{t("exitBags")}</th>
                  <th className="p-2 text-right">{t("soldBags") || "Sold Bags"}</th>
                  <th className="p-2 text-right">{t("baseColdCharge")}</th>
                  <th className="p-2 text-right">{t("kataChargesShort")}</th>
                  <th className="p-2 text-right">{t("extraHammaliPerBagShort") || `${t("extraHammaliShort")}/Bag`}</th>
                  <th className="p-2 text-right">{t("gradingChargesShort")}</th>
                  <th className="p-2 text-right">{t("totalChargesShort")}</th>
                  <th className="p-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const lwc = resolveLot(r.lotNo, r.marka);
                  const remaining = lwc?.lot.remainingSize ?? 0;
                  const totals = rowTotals[idx];
                  const exceeds = lwc && totals.exitBags > remaining;

                  // Receipt # options: distinct lotNos. If a marka is already
                  // chosen but no Receipt yet, narrow to lotNos that have that
                  // marka. Disable any (lotNo, marka) pair already used in
                  // another row.
                  const rowMarkaCanon = canonMarka(r.marka);
                  const lotNoOptions = r.marka
                    ? allLotNos.filter(n => (markasByLotNo.get(n) || []).includes(rowMarkaCanon))
                    : allLotNos;

                  // Marka options: when a Receipt # is chosen, derive strictly
                  // from that lotNo's markas (typically 1, occasionally more
                  // when duplicates were entered via Lot Entry). Otherwise
                  // expose every distinct marka across the farmer's lots so
                  // marka-first picking still works. Blank ("") markas are
                  // legitimate and surface here too.
                  const markaOptionsForRow = r.lotNo
                    ? (markasByLotNo.get(r.lotNo) || [])
                    : Array.from(new Set(lots.map(l => (l.lot.marka || "").trim()))).sort();

                  return (
                    <tr key={r.rowKey} data-testid={`row-mn-${idx}`}>
                      <td className="p-2 min-w-[180px]">
                        <Select
                          value={r.lotNo || undefined}
                          onValueChange={(newLotNo) => {
                            const markas = markasByLotNo.get(newLotNo) || [];
                            const toSel = (m: string) => (m === "" ? NO_MARKA : m);
                            // If the chosen Receipt # has only one marka,
                            // auto-fill it (including the blank/no-marka
                            // case via the sentinel). Otherwise keep the
                            // existing marka if it still belongs to the new
                            // Receipt #, else clear it so the operator must
                            // pick.
                            let nextMarka = r.marka;
                            if (markas.length === 1) {
                              nextMarka = toSel(markas[0]);
                            } else if (!markas.includes(canonMarka(r.marka))) {
                              nextMarka = "";
                            }
                            updateRow(r.rowKey, { lotNo: newLotNo, marka: nextMarka });
                          }}
                          disabled={!!result}
                        >
                          <SelectTrigger className="h-8" data-testid={`select-mn-lot-${idx}`}>
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                          <SelectContent>
                            {lotNoOptions.map(n => {
                              // A receipt# is "fully used" only when every one
                              // of its (lotNo, marka) pairs is already chosen
                              // in another row. We still allow re-selecting
                              // the same Receipt# for *this* row when there
                              // are multiple markas under it.
                              const markasHere = markasByLotNo.get(n) || [];
                              const allUsed = markasHere.length > 0 &&
                                markasHere.every(m => {
                                  const k = `${n}::${m}`;
                                  return usedKeys.has(k) && !(r.lotNo === n && rowMarkaCanon === m);
                                });
                              return (
                                <SelectItem key={n} value={n} disabled={allUsed}>
                                  {n}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2 min-w-[120px]">
                        <Select
                          value={r.marka || undefined}
                          onValueChange={(newMarkaSel) => {
                            // newMarkaSel may be the NO_MARKA sentinel when
                            // the operator picks the blank-marka option. If
                            // the resulting canonical marka doesn't belong
                            // to the currently picked Receipt #, clear the
                            // Receipt # so the operator picks again from
                            // the narrowed list.
                            const newMarkaCanon = canonMarka(newMarkaSel);
                            const markasForLot = r.lotNo ? (markasByLotNo.get(r.lotNo) || []) : [];
                            const stillValid = !r.lotNo || markasForLot.includes(newMarkaCanon);
                            updateRow(r.rowKey, {
                              marka: newMarkaSel,
                              lotNo: stillValid ? r.lotNo : "",
                            });
                          }}
                          disabled={!!result || markaOptionsForRow.length === 0}
                        >
                          <SelectTrigger className="h-8" data-testid={`select-mn-marka-${idx}`}>
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                          <SelectContent>
                            {markaOptionsForRow.map(m => {
                              // Disable a marka if (currentLotNo, marka) is
                              // already taken by another row. SelectItem
                              // can't accept "" as a value, so blank markas
                              // ride on the NO_MARKA sentinel.
                              const sel = m === "" ? NO_MARKA : m;
                              const k = r.lotNo ? `${r.lotNo}::${m}` : "";
                              const taken = !!k && usedKeys.has(k) && !(rowMarkaCanon === m);
                              return (
                                <SelectItem key={sel} value={sel} disabled={taken}>
                                  {m === "" ? "—" : m}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2 text-right font-mono">{remaining || "-"}</td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={1}
                          max={remaining || undefined}
                          value={r.exitBags}
                          onChange={(e) => updateRow(r.rowKey, { exitBags: e.target.value })}
                          disabled={!!result || !r.lotNo || !r.marka}
                          className={`h-8 w-20 text-right ${exceeds ? "border-destructive" : ""}`}
                          data-testid={`input-mn-bags-${idx}`}
                        />
                      </td>
                      <td className="p-2 text-right font-mono" data-testid={`text-mn-sold-${idx}`}>
                        {totals.exitBags || "-"}
                      </td>
                      <td className="p-2 text-right font-mono" data-testid={`text-mn-base-${idx}`}>{fmt(totals.base)}</td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={0}
                          value={r.kataCharges}
                          onChange={(e) => updateRow(r.rowKey, { kataCharges: e.target.value })}
                          disabled={!!result || !r.lotNo || !r.marka}
                          className="h-8 w-20 text-right"
                          data-testid={`input-mn-kata-${idx}`}
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={0}
                          value={r.extraHammaliPerBag}
                          onChange={(e) => updateRow(r.rowKey, { extraHammaliPerBag: e.target.value })}
                          disabled={!!result || !r.lotNo || !r.marka}
                          className="h-8 w-24 text-right"
                          data-testid={`input-mn-extra-${idx}`}
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={0}
                          value={r.gradingCharges}
                          onChange={(e) => updateRow(r.rowKey, { gradingCharges: e.target.value })}
                          disabled={!!result || !r.lotNo || !r.marka}
                          className="h-8 w-20 text-right"
                          data-testid={`input-mn-grading-${idx}`}
                        />
                      </td>
                      <td className="p-2 text-right font-mono font-semibold" data-testid={`text-mn-total-${idx}`}>{fmt(totals.total)}</td>
                      <td className="p-2 text-center">
                        {!result && rows.length > 1 && (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive"
                            onClick={() => removeRow(r.rowKey)}
                            data-testid={`button-mn-remove-${idx}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-muted/30 font-semibold">
                  <td className="p-2" colSpan={3}>{t("total") || "Total"}</td>
                  <td className="p-2 text-right font-mono" data-testid="text-mn-total-bags">{totalBags}</td>
                  <td className="p-2 text-right font-mono" data-testid="text-mn-total-sold">{totalBags}</td>
                  <td className="p-2" colSpan={4}></td>
                  <td className="p-2 text-right font-mono" data-testid="text-mn-grand-total">{fmt(grandTotal)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {!result && (
          <div className="flex">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setRows(prev => [...prev, newRow()])}
              disabled={lots.length === 0 || rows.length >= lots.length}
              data-testid="button-mn-add-row"
            >
              <Plus className="h-4 w-4 mr-1" />
              {t("addRow")}
            </Button>
          </div>
        )}

        {/* Hidden printable content (rendered after submit) */}
        {result && (
          <div className="hidden">
            <div ref={printRef}>
              <div className="header">
                <h1>{coldStorage?.name || "Cold Storage"}</h1>
                {(() => {
                  const a = [coldStorage?.address, coldStorage?.tehsil, coldStorage?.district, coldStorage?.state, coldStorage?.pincode].filter(Boolean).join(", ");
                  return a ? <div style={{ fontSize: 11 }}>{a}</div> : null;
                })()}
                <h2>{t("masterNikasi")} / Master Nikasi</h2>
                <h3>{t("exitBillNumber")} #{result.sharedExitBillNumber}</h3>
              </div>
              <div className="meta">
                <span><strong>{t("exitDate")}:</strong> {format(new Date(result.exitDate), "dd/MM/yyyy")}</span>
                <span><strong>{t("printedOn") || "Printed"}:</strong> {format(new Date(), "dd/MM/yyyy HH:mm")}</span>
              </div>
              <div className="party">
                <strong>{partyRowLabel}:</strong> {result.farmer.farmerName} &nbsp;|&nbsp;
                <strong>{t("village")}:</strong> {result.farmer.village} &nbsp;|&nbsp;
                <strong>{t("phone") || "Phone"}:</strong> {result.farmer.contactNumber}
              </div>
              <table className="nik">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t("receiptNo")}</th>
                    <th>{t("marka") || "Marka"}</th>
                    <th>{t("chamber") || "Ch"}/{t("floor") || "Fl"}/{t("position") || "Pos"}</th>
                    <th>{t("type") || "Type"}</th>
                    <th>{t("exitBags")}</th>
                    <th>{t("soldBags") || "Sold Bags"}</th>
                    <th>{t("baseColdCharge")}</th>
                    <th>{t("kataChargesShort")}</th>
                    <th>{t("extraHammaliShort")}</th>
                    <th>{t("gradingChargesShort")}</th>
                    <th>{t("totalChargesShort")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.sales.map((s, i) => (
                    <tr key={s.saleId}>
                      <td>{i + 1}</td>
                      <td className="lft">{s.lotNo}</td>
                      <td className="lft">{s.marka || "-"}</td>
                      <td className="lft">{s.chamberName}/{s.floor}/{s.position}</td>
                      <td className="lft">{s.bagType === "wafer" ? "W" : "S"}-{s.potatoType}</td>
                      <td>{s.bagsExited}</td>
                      <td>{s.bagsExited}</td>
                      <td>{fmt(s.baseColdCharge)}</td>
                      <td>{fmt(s.kataCharges)}</td>
                      <td>{fmt(s.extraHammali)}</td>
                      <td>{fmt(s.gradingCharges)}</td>
                      <td>{fmt(s.totalColdStorageCharge)}</td>
                    </tr>
                  ))}
                  <tr className="tot">
                    <td colSpan={5} className="lft">{t("total") || "Total"}</td>
                    <td>{result.sales.reduce((s, r) => s + r.bagsExited, 0)}</td>
                    <td>{result.sales.reduce((s, r) => s + r.bagsExited, 0)}</td>
                    <td>{fmt(result.sales.reduce((s, r) => s + r.baseColdCharge, 0))}</td>
                    <td>{fmt(result.sales.reduce((s, r) => s + r.kataCharges, 0))}</td>
                    <td>{fmt(result.sales.reduce((s, r) => s + r.extraHammali, 0))}</td>
                    <td>{fmt(result.sales.reduce((s, r) => s + r.gradingCharges, 0))}</td>
                    <td>{fmt(result.sales.reduce((s, r) => s + r.totalColdStorageCharge, 0))}</td>
                  </tr>
                </tbody>
              </table>
              <div className="signature">
                <div className="signature-line">{t("authorisedSignatory") || "Authorised Signatory"}</div>
              </div>
              <div className="footer">{t("paymentStatus") || "Payment"}: {t("due")} (Self-Sale)</div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-mn-close"
          >
            {result ? (t("close") || "Close") : (t("cancel") || "Cancel")}
          </Button>
          {result ? (
            <Button onClick={handlePrint} data-testid="button-mn-reprint">
              <Printer className="h-4 w-4 mr-1" />
              {t("printNikasiBill")}
            </Button>
          ) : (
            <Button
              onClick={() => submitMutation.mutate()}
              disabled={!canSubmit}
              data-testid="button-mn-submit"
            >
              {submitMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Printer className="h-4 w-4 mr-1" />
              )}
              {t("submitMasterNikasi")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
