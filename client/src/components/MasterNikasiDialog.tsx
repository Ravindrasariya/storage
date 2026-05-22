import { useState, useMemo, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, authFetch, invalidateSaleSideEffects } from "@/lib/queryClient";
import { PackageMinus, Printer, Plus, Trash2, Loader2, Check, ChevronsUpDown, IndianRupee, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import type { ColdStorage, BuyerLedgerEntry, BankAccount } from "@shared/schema";
import type { LotWithCharges } from "@/components/FarmerLotGroup";
import { NikasiPrintable, printNikasiReceipt } from "@/components/NikasiPrintable";

// Special sentinel for the "Self" option in the buyer picker. Selecting it
// (or leaving the field empty) keeps the legacy self-sale behavior — due
// tracked under the farmer, no buyer ledger entry created/touched.
const SELF_BUYER = "__self__";

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
  onSaleSuccess?: () => void;
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
  // Physical bags leaving the chamber on this nikasi.
  exitBags: string;
  // Commercial bags being sold on this row. Defaults to exitBags but may
  // be raised up to the lot's remainingSize (sold > exited means the
  // unexited-but-sold portion stays in the chamber and can be physically
  // exited later via the per-sale Exit dialog). Charges (base cold,
  // hammali, extra hammali) are computed on soldBags — unless the row
  // picks "totalRemaining" charge basis, in which case base cold +
  // hammali bill against the lot's full remainingSize.
  soldBags: string;
  // Mirrors the partial-sale dialog: "actual" (default) bills base on
  // soldBags, "totalRemaining" bills base on lot.remainingSize and
  // flips the lot's baseColdChargesBilled flag on submit.
  chargeBasis: "actual" | "totalRemaining";
  kataCharges: string;
  extraHammaliPerBag: string;
  gradingCharges: string;
}

interface MasterNikasiResult {
  sharedExitBillNumber: number;
  // Server returns null when every selected lot was already
  // base-billed AND the operator left the shared CS Bill # blank
  // (Task #256 — auto-skip path). Non-null otherwise.
  sharedColdStorageBillNumber: number | null;
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
  buyer: {
    buyerLedgerId: string;
    buyerId: string | null;
    buyerName: string;
  } | null;
  // Receipts created for the inline payment (Task #294). Empty array
  // when no payment was attached.
  paymentReceipts?: Array<{
    receiptId: string;
    saleId: string;
    amount: number;
    roundOff: number;
  }>;
}

const newRow = (lotNo = "", marka = ""): RowState => ({
  rowKey: `r${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  lotNo,
  marka,
  exitBags: "",
  soldBags: "",
  chargeBasis: "actual",
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
  onSaleSuccess,
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

  // Active (non-archived) buyers — used to fill the optional "Buyer Name"
  // picker. Default selection is Self, which preserves the legacy
  // self-sale path (no buyer touched).
  const { data: buyerLedgerData } = useQuery<{ buyers: BuyerLedgerEntry[] }>({
    queryKey: ["/api/buyer-ledger", { includeArchived: false }],
    queryFn: () => authFetch(`/api/buyer-ledger?includeArchived=false`).then(res => res.json()),
  });
  const buyers = useMemo(
    () => (buyerLedgerData?.buyers ?? []).slice().sort((a, b) => a.buyerName.localeCompare(b.buyerName)),
    [buyerLedgerData],
  );

  // Use Asia/Kolkata-based formatting (en-CA gives YYYY-MM-DD) so the
  // default exit date is the operator's local IST calendar day. Plain
  // toISOString().slice(0,10) is UTC-based and would shift to the prior
  // day during IST early hours (before 05:30), which breaks the CS bill
  // # year-bucket on Jan-1 mornings.
  const todayIst = (): string =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [exitDate, setExitDate] = useState<string>(todayIst);

  // Year used for the live next-CS-bill # preview. Server-side
  // createMasterNikasi scopes the CS bill # year to the picked
  // exitDate's calendar year (not the row's soldAt, which is "now"), so
  // the hint must follow the same rule. A new exitDate input ⇒ new
  // previewYear ⇒ new query key ⇒ refreshed hint.
  const previewYear = useMemo(() => {
    if (exitDate && /^\d{4}-\d{2}-\d{2}$/.test(exitDate)) {
      const y = parseInt(exitDate.slice(0, 4), 10);
      if (Number.isFinite(y) && y > 1900 && y < 3000) return y;
    }
    return new Date().getFullYear();
  }, [exitDate]);

  // Live preview of the next CS bill # the server would auto-assign.
  // Best-effort hint only — the server recomputes at submit time. Key
  // shape matches the spec ['/api/cold-storages', coldStorageId,
  // 'next-cs-bill', year] and the URL uses year as a query param.
  const { data: nextCsBillData, isFetching: nextCsBillFetching } = useQuery<{ nextBillNumber: number }>({
    queryKey: ["/api/cold-storages", coldStorage?.id, "next-cs-bill", previewYear],
    enabled: open && !!coldStorage?.id,
    queryFn: async () => {
      const res = await authFetch(`/api/cold-storages/${coldStorage!.id}/next-cs-bill?year=${previewYear}`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const [rows, setRows] = useState<RowState[]>(() => [newRow()]);
  const [result, setResult] = useState<MasterNikasiResult | null>(null);
  // SELF_BUYER (default) keeps the legacy self-sale path; selecting a real
  // buyer ledger id routes the whole nikasi to that buyer (regular sale).
  const [targetBuyerSel, setTargetBuyerSel] = useState<string>(SELF_BUYER);
  const [buyerComboboxOpen, setBuyerComboboxOpen] = useState(false);
  const [buyerSearchQuery, setBuyerSearchQuery] = useState("");
  // Set when the server rejects with field=buyerLedgerId so we can
  // outline the picker and surface an inline message.
  const [buyerError, setBuyerError] = useState<string | null>(null);
  // Shared exit bill # for the whole nikasi batch. Pre-filled from the
  // running counter; user may override to match a manual receipt book.
  const [sharedExitBillInput, setSharedExitBillInput] = useState<string>("");
  const [sharedExitBillEdited, setSharedExitBillEdited] = useState(false);
  // Shared Cold Storage bill # for the whole nikasi batch — mirrors the
  // shared exit bill #. Pre-filled from the live MAX+1 preview hint; the
  // operator may override. Server writes the same value to every
  // sales_history row in the batch, which is what enables the collective
  // CS deduction-bill print view.
  const [sharedColdStorageBillInput, setSharedColdStorageBillInput] = useState<string>("");
  const [sharedColdStorageBillEdited, setSharedColdStorageBillEdited] = useState(false);
  // Inline error displayed under the shared bill # inputs so the
  // operator can correct duplicates without losing the toast. The
  // matching field is detected via substring on the message.
  const [billNumberError, setBillNumberError] = useState<string | null>(null);

  // ---- Task #294: Inline payment ---------------------------------------
  // When set, the MN submit payload includes a `payment` block. The server
  // allocates `amount + roundOff` top-to-bottom across the freshly-created
  // sales (one cashReceipts row per touched sale, FIFO-excluded). Round-off
  // lands on the LAST touched receipt only. Payment lands atomically inside
  // the same db.transaction as the sales.
  const [attachedPayment, setAttachedPayment] = useState<{
    receiptType: "cash" | "account";
    accountId: string | null;
    amount: number;
    roundOff: number;
    receivedAt: string;
    notes: string;
  } | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  // Server-side payment errors (field paths like "payment.amount") render
  // by re-opening the sub-dialog with the message highlighted.
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Reset state whenever dialog opens. The shared exit bill # is still
  // pre-filled from the cold-storage running counter (out of scope for
  // #230). The first row's cold-storage bill # starts empty and is
  // populated by the follow-up effect below once nextCsBillData arrives.
  useEffect(() => {
    if (open) {
      setExitDate(todayIst());
      const only = lots.length === 1 ? lots[0].lot : null;
      const onlyMarka = (only?.marka || "").trim();
      const onlyMarkaState = only ? (onlyMarka === "" ? NO_MARKA : onlyMarka) : "";
      setRows([newRow(only?.lotNo || "", onlyMarkaState)]);
      setSharedExitBillInput(coldStorage?.nextExitBillNumber ? String(coldStorage.nextExitBillNumber) : "");
      setSharedExitBillEdited(false);
      // Shared CS bill # is autofilled by the follow-up effect below
      // once nextCsBillData lands; reset to blank/non-edited here.
      setSharedColdStorageBillInput("");
      setSharedColdStorageBillEdited(false);
      setBillNumberError(null);
      setResult(null);
      setTargetBuyerSel(SELF_BUYER);
      setBuyerComboboxOpen(false);
      setBuyerSearchQuery("");
      setBuyerError(null);
      setAttachedPayment(null);
      setPaymentDialogOpen(false);
      setPaymentError(null);
    }
  }, [open, lots, coldStorage?.nextExitBillNumber]);

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

  // Task #256 — when EVERY selected (resolved) row points at a lot whose
  // base cold-storage charges were already billed, autofill is suppressed
  // and the input stays blank. The matching server path then writes
  // NULL to coldStorageBillNumber for every sale in this MN batch (the
  // sales remain bill-less, which is the correct outcome for already-
  // billed lots). If the operator wants a bill # anyway, typing one
  // flips sharedColdStorageBillEdited and we honour the override. We
  // recompute "all rows base-billed" from the live rows + lotByKey so
  // the suppression updates as rows are added / lot selections change.
  const allSelectedRowsBaseBilled = useMemo(() => {
    const resolved = rows
      .filter(r => r.lotNo && r.marka)
      .map(r => lotByKey.get(`${r.lotNo}::${canonMarka(r.marka)}`))
      .filter((l): l is LotWithCharges => !!l);
    if (resolved.length === 0) return false;
    return resolved.every(l => l.lot.baseColdChargesBilled === 1);
  }, [rows, lotByKey]);

  // Keep the shared CS bill # input in sync with the live MAX+1
  // preview while the operator hasn't manually edited it. Mirrors the
  // shared-exit-bill autofill semantics:
  //   • opening the dialog → input blank → preview lands → input fills;
  //   • a sale recorded elsewhere → preview re-fetches via
  //     invalidateSaleSideEffects → still-non-edited input re-fills
  //     from the new base.
  // Once the operator types into the input, `sharedColdStorageBillEdited`
  // flips true and we stop overwriting their value.
  useEffect(() => {
    if (!open) return;
    if (sharedColdStorageBillEdited) return;
    if (allSelectedRowsBaseBilled) {
      // All rows refer to already-billed lots → no auto-bill #. Force
      // the input blank so the submit path sends nothing and the server
      // writes NULL across every sibling row.
      setSharedColdStorageBillInput(prev => (prev === "" ? prev : ""));
      return;
    }
    // Gate on isFetching so we never display a stale cached number
    // during a year change or post-sale invalidation: clear the input
    // to empty until the fresh hint lands.
    if (nextCsBillFetching || !nextCsBillData?.nextBillNumber) {
      setSharedColdStorageBillInput(prev => (prev === "" ? prev : ""));
      return;
    }
    const nextStr = String(nextCsBillData.nextBillNumber);
    setSharedColdStorageBillInput(prev => (prev === nextStr ? prev : nextStr));
  }, [open, nextCsBillData?.nextBillNumber, nextCsBillFetching, sharedColdStorageBillEdited, allSelectedRowsBaseBilled]);

  // Used (lotNo, marka) pairs across rows, so duplicates are blocked.
  const usedKeys = useMemo(
    () => new Set(rows.filter(r => r.lotNo && r.marka).map(r => `${r.lotNo}::${canonMarka(r.marka)}`)),
    [rows],
  );

  // Per-row live computation of base cold charge (mirrors server logic).
  // `bags` is the *commercial* quantity (soldBags) used when basis is
  // "actual"; when basis is "totalRemaining" we substitute the lot's
  // full remainingSize so the operator sees the same bhada the server
  // will bill. Lot-level baseColdChargesBilled === 1 always wins and
  // zeroes the charge regardless of basis.
  const calcBaseCharge = (
    lwc: LotWithCharges | undefined,
    bags: number,
    basis: "actual" | "totalRemaining" = "actual",
  ): number => {
    if (!coldStorage || !lwc) return 0;
    const lot = lwc.lot;
    if (lot.baseColdChargesBilled === 1) return 0;
    const chargeBags = basis === "totalRemaining" ? lot.remainingSize : bags;
    if (!chargeBags || chargeBags <= 0) return 0;
    const useWafer = lot.bagType === "wafer";
    const gCold = useWafer ? (coldStorage.waferColdCharge || 0) : (coldStorage.seedColdCharge || 0);
    const gHam = useWafer ? (coldStorage.waferHammali || 0) : (coldStorage.seedHammali || 0);
    const cRate = farmerEntry?.customColdChargeRate ?? gCold;
    const hRate = farmerEntry?.customHammaliRate ?? gHam;
    const effUnit = isCompany ? "quintal" : (coldStorage.chargeUnit || "bag");
    if (effUnit === "quintal") {
      const cQuintal = (lot.netWeight && lot.size > 0)
        ? (lot.netWeight * chargeBags * cRate) / (lot.size * 100)
        : 0;
      return cQuintal + hRate * chargeBags;
    }
    return chargeBags * (cRate + hRate);
  };

  const rowTotals = rows.map((r) => {
    const exitBags = Number(r.exitBags) || 0;
    // soldBags defaults to exitBags ONLY when the cell is truly blank
    // or unparseable, so an operator who only fills "Exit Bags" still
    // sees correct charges before any keystroke in the sold cell. An
    // explicit non-positive entry (0, -1) is invalid: we surface it by
    // billing on 0 here, and the row is also flagged red and rejected
    // by `validRowCount` / submit. Do NOT silently coerce 0/-1 → exit.
    const soldStr = r.soldBags;
    const soldBagsRaw = Number(soldStr);
    const soldBags = soldStr === "" || !Number.isFinite(soldBagsRaw)
      ? exitBags
      : (soldBagsRaw > 0 ? soldBagsRaw : 0);
    const lwc = resolveLot(r.lotNo, r.marka);
    const base = calcBaseCharge(lwc, soldBags, r.chargeBasis);
    const kata = Number(r.kataCharges) || 0;
    const extraPerBag = Number(r.extraHammaliPerBag) || 0;
    const extra = extraPerBag * soldBags;
    const grading = Number(r.gradingCharges) || 0;
    return { base, kata, extra, extraPerBag, grading, total: base + kata + extra + grading, exitBags, soldBags };
  });
  const grandTotal = rowTotals.reduce((s, r) => s + r.total, 0);
  const totalExitBags = rowTotals.reduce((s, r) => s + r.exitBags, 0);
  const totalSoldBags = rowTotals.reduce((s, r) => s + r.soldBags, 0);

  const updateRow = (key: string, patch: Partial<RowState>) => {
    setRows(prev => prev.map(r => (r.rowKey === key ? { ...r, ...patch } : r)));
  };

  // When the operator types or changes Exit Bags on a row, default the
  // Sold Bags column to match: empty Sold or Sold strictly less than
  // the new Exit gets bumped up. Once the operator manually raises Sold
  // above Exit, further Exit edits leave Sold alone (Sold stays >= Exit
  // because we only auto-bump *up*, never down).
  const updateExitBags = (key: string, newExitStr: string) => {
    setRows(prev => prev.map(r => {
      if (r.rowKey !== key) return r;
      const newExit = Number(newExitStr);
      const currentSold = Number(r.soldBags);
      const soldIsBlank = r.soldBags === "" || !Number.isFinite(currentSold);
      const shouldBump = Number.isFinite(newExit) && newExit > 0 && (soldIsBlank || currentSold < newExit);
      return {
        ...r,
        exitBags: newExitStr,
        soldBags: shouldBump ? newExitStr : r.soldBags,
      };
    }));
  };

  const removeRow = (key: string) => {
    setRows(prev => (prev.length === 1 ? prev : prev.filter(r => r.rowKey !== key)));
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      setBuyerError(null);
      if (!farmerLedgerId) throw new Error("Missing farmer ledger");
      const cleaned: Array<{
        lotId: string;
        exitBags: number;
        soldBags: number;
        chargeBasis: "actual" | "totalRemaining";
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

        // Sold defaults to exit ONLY when the cell is truly blank (the
        // auto-bump in updateExitBags normally keeps it populated, but
        // a row whose exit was filled before this code path was
        // deployed could still be blank). An explicit non-positive
        // entry (0, -1) is invalid and must be rejected here, NOT
        // silently coerced to exitBags.
        const soldStr = r.soldBags;
        let sold: number;
        if (soldStr === "") {
          sold = bags;
        } else {
          const soldNum = Number(soldStr);
          if (!Number.isFinite(soldNum) || soldNum <= 0) {
            throw new Error(`Lot ${lwc.lot.lotNo}: sold bags must be a positive integer`);
          }
          sold = soldNum;
        }
        if (sold < bags) {
          throw new Error(`Lot ${lwc.lot.lotNo}: sold bags (${sold}) cannot be less than exit bags (${bags})`);
        }
        if (sold > lwc.lot.remainingSize) {
          throw new Error(`Lot ${lwc.lot.lotNo}: only ${lwc.lot.remainingSize} bag(s) remaining`);
        }
        const key = `${r.lotNo}::${canonMarka(r.marka)}`;
        if (seenKey.has(key)) throw new Error(t("duplicateReceipt"));
        seenKey.add(key);

        cleaned.push({
          lotId: lwc.lot.id,
          exitBags: bags,
          soldBags: sold,
          // Per-row basis (defaults to "actual" via newRow). When the
          // lot's baseColdChargesBilled flag is already 1 the server
          // forces this back to "actual" defensively, so we just send
          // whatever the operator picked.
          chargeBasis: r.chargeBasis,
          kataCharges: Number(r.kataCharges) || 0,
          extraHammaliPerBag: Number(r.extraHammaliPerBag) || 0,
          gradingCharges: Number(r.gradingCharges) || 0,
        });
      }
      if (cleaned.length === 0) throw new Error("Add at least one valid row.");

      const sharedExitBill = parseInt(sharedExitBillInput);
      if (!Number.isFinite(sharedExitBill) || sharedExitBill <= 0) {
        throw new Error("Exit bill # must be a positive integer");
      }

      // Shared CS bill # — single value applied to every sales_history
      // row created by this batch. Optional on the wire (server falls
      // back to MAX+1) but the dialog always pre-fills it from the live
      // hint, so this branch should rarely fire.
      const sharedCsBillStr = sharedColdStorageBillInput.trim();
      let sharedCsBill: number | undefined;
      if (sharedCsBillStr !== "") {
        const parsed = parseInt(sharedCsBillStr);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error("Cold Storage Bill # must be a positive integer");
        }
        sharedCsBill = parsed;
      }

      const buyerLedgerIdToSend = targetBuyerSel && targetBuyerSel !== SELF_BUYER ? targetBuyerSel : null;

      // Inline payment (Task #294). Client-side cap check: gross must not
      // exceed grandTotal (the freshly-billed cold-storage due for this
      // batch). The server re-validates with a ±0.5 tolerance.
      let paymentToSend: {
        receiptType: "cash" | "account";
        accountId: string | null;
        amount: number;
        roundOff: number;
        receivedAt: string;
        notes: string | null;
      } | undefined;
      if (attachedPayment) {
        // Per task contract: validate by `amount` only. `roundOff` is metadata
        // stamped on the LAST touched receipt; it does NOT reduce sale dues.
        const amt = attachedPayment.amount || 0;
        if (amt <= 0) {
          throw new Error("Payment amount must be greater than zero");
        }
        if (amt > grandTotal + 0.5) {
          throw new Error(`Payment amount (₹${amt.toFixed(2)}) exceeds total cold-storage due (₹${grandTotal.toFixed(2)})`);
        }
        if (attachedPayment.receiptType === "account" && !attachedPayment.accountId) {
          throw new Error("Bank account is required when payment mode is account");
        }
        paymentToSend = {
          receiptType: attachedPayment.receiptType,
          accountId: attachedPayment.receiptType === "account" ? attachedPayment.accountId : null,
          amount: attachedPayment.amount,
          roundOff: attachedPayment.roundOff,
          receivedAt: attachedPayment.receivedAt,
          notes: attachedPayment.notes.trim() || null,
        };
      }

      const res = await apiRequest("POST", "/api/farmers/master-nikasi", {
        farmerLedgerId,
        buyerLedgerId: buyerLedgerIdToSend,
        exitDate,
        sharedExitBillNumber: sharedExitBill,
        sharedColdStorageBillNumber: sharedCsBill,
        rows: cleaned,
        ...(paymentToSend ? { payment: paymentToSend } : {}),
      });
      return (await res.json()) as MasterNikasiResult;
    },
    onSuccess: (data) => {
      setResult(data);
      // invalidateSaleSideEffects already invalidates cash-receipts,
      // cash-flow, buyer-ledger, farmer-ledger, bank-accounts — covering
      // the inline-payment side effects too.
      invalidateSaleSideEffects(queryClient);
      queryClient.invalidateQueries({ queryKey: ["/api/farmers"] });
      // Refresh the cold-storage counter so subsequent dialogs see the
      // bumped nextExitBillNumber / nextColdStorageBillNumber values.
      queryClient.invalidateQueries({ queryKey: ["/api/cold-storage"] });
      // Explicit invalidations for the inline-payment side effects (already
      // covered by invalidateSaleSideEffects, but stated explicitly per
      // Task #294 acceptance criteria to defend against future refactors).
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-flow"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-accounts"] });
      onSaleSuccess?.();
      const buyerSuffix = data.buyer ? ` · ${data.buyer.buyerName}` : "";
      const paySuffix = (data.paymentReceipts && data.paymentReceipts.length > 0)
        ? ` · ${t("paymentRecorded")}`
        : "";
      toast({ title: t("masterNikasi"), description: `${t("exitBillNumber")} ${data.sharedExitBillNumber}${buyerSuffix}${paySuffix}` });
      // Auto-print after a short delay so DOM renders the print block.
      setTimeout(() => {
        handlePrint();
      }, 250);
    },
    onError: (err: Error) => {
      const msg = err.message || "Failed";
      const body = (err as Error & { body?: { field?: string } }).body;
      // CS bill # is a single shared field now — no row mapping. Its
      // server error and the shared exit-bill error both render under
      // the matching shared input via substring on the message.
      if (body?.field === "coldStorageBillNumber" || /Cold Storage Bill #|cold storage bill number/i.test(msg)) {
        setBillNumberError(msg);
      } else if (body?.field === "sharedExitBillNumber" || /Exit Bill #|exit bill number/i.test(msg)) {
        setBillNumberError(msg);
      } else if (body?.field === "buyerLedgerId" || /buyer.*not found|buyer.*archived/i.test(msg)) {
        setBuyerError(msg);
      } else if (
        body?.field?.startsWith("payment.") ||
        /payment amount|bank account is required|exceeds total due|exceeds current due|FIFO has already paid/i.test(msg)
      ) {
        setPaymentError(msg);
        setPaymentDialogOpen(true);
      }
      toast({ title: t("error") || "Error", description: msg, variant: "destructive" });
    },
  });

  const handlePrint = () => {
    if (!printRef.current) return;
    printNikasiReceipt(printRef.current.innerHTML, t("masterNikasi"));
  };

  const validRowCount = rows.filter(r => {
    if (!r.lotNo || !r.marka) return false;
    const bags = Number(r.exitBags);
    if (!Number.isFinite(bags) || bags <= 0) return false;
    const lwc = resolveLot(r.lotNo, r.marka);
    if (!lwc) return false;
    if (bags > lwc.lot.remainingSize) return false;
    // Sold defaults to exit ONLY when blank. An explicit non-positive
    // entry (0, -1) keeps the row invalid — never silently coerce it
    // to exitBags. This mirrors the submit-time validation.
    const soldStr = r.soldBags;
    let sold: number;
    if (soldStr === "") {
      sold = bags;
    } else {
      const soldNum = Number(soldStr);
      if (!Number.isFinite(soldNum) || soldNum <= 0) return false;
      sold = soldNum;
    }
    if (sold < bags) return false;
    if (sold > lwc.lot.remainingSize) return false;
    return true;
  }).length;
  const canSubmit = !!farmerLedgerId && validRowCount > 0 && !duplicateKey && !submitMutation.isPending && !result;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] xl:max-w-7xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageMinus className="h-5 w-5" />
            {t("masterNikasiTitle")}
          </DialogTitle>
          <DialogDescription>{t("masterNikasiDesc")}</DialogDescription>
        </DialogHeader>

        {/* Party + exit date strip — single row */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-muted/40 px-3 py-2 rounded-md text-sm">
          <span className="text-xs text-muted-foreground">{partyRowLabel}</span>
          <span className="font-semibold" data-testid="text-mn-farmer-name">{farmerName}</span>
          <span className="text-xs text-muted-foreground">
            {village} · <span className="font-mono">{contactNumber}</span>
          </span>
          <div className="ml-auto flex items-center gap-3">
            {/* Buyer picker — Self by default. Selecting a real buyer routes
                the whole nikasi to that buyer (regular sale, due tracked under
                cold_merchant). Locked label "Buyer Name" matches SaleDialog. */}
            <div className="flex items-center gap-2">
              <Label htmlFor="mn-buyer" className="text-xs whitespace-nowrap">{t("buyerName") || "Buyer Name"}</Label>
              <Popover open={buyerComboboxOpen} onOpenChange={(o) => { setBuyerComboboxOpen(o); if (o) setBuyerError(null); }}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={buyerComboboxOpen}
                    disabled={!!result}
                    className={`h-8 w-56 justify-between font-normal ${buyerError ? "border-destructive ring-1 ring-destructive" : ""}`}
                    data-testid="select-mn-target-buyer"
                  >
                    {targetBuyerSel === SELF_BUYER ? (
                      <span>
                        {t("self") || "Self"} — {isCompany ? (t("company") || "Company") : (t("farmer") || "किसान")}
                      </span>
                    ) : (
                      <span className="truncate">
                        {(() => {
                          const sel = buyers.find(b => b.id === targetBuyerSel);
                          return sel ? `${sel.buyerName}${sel.buyerId ? ` (${sel.buyerId})` : ""}` : (t("selectMerchant") || "Select buyer");
                        })()}
                      </span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[320px] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder={t("searchBuyer") || "Search buyer..."}
                      value={buyerSearchQuery}
                      onValueChange={setBuyerSearchQuery}
                      data-testid="input-mn-buyer-search"
                    />
                    <CommandList>
                      <CommandEmpty>{t("noBuyersFound") || "No buyers found"}</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value={SELF_BUYER}
                          onSelect={() => {
                            setTargetBuyerSel(SELF_BUYER);
                            setBuyerComboboxOpen(false);
                            setBuyerSearchQuery("");
                            setBuyerError(null);
                          }}
                          data-testid="option-mn-buyer-self"
                        >
                          <Check className={`mr-2 h-4 w-4 ${targetBuyerSel === SELF_BUYER ? "opacity-100" : "opacity-0"}`} />
                          {t("self") || "Self"} / स्वयं
                        </CommandItem>
                        {buyers
                          .filter(b => !buyerSearchQuery || b.buyerName.toLowerCase().includes(buyerSearchQuery.toLowerCase()) || (b.buyerId || "").toLowerCase().includes(buyerSearchQuery.toLowerCase()))
                          .map(b => (
                            <CommandItem
                              key={b.id}
                              value={b.id}
                              onSelect={() => {
                                setTargetBuyerSel(b.id);
                                setBuyerComboboxOpen(false);
                                setBuyerSearchQuery("");
                                setBuyerError(null);
                              }}
                              data-testid={`option-mn-buyer-${b.id}`}
                            >
                              <Check className={`mr-2 h-4 w-4 ${targetBuyerSel === b.id ? "opacity-100" : "opacity-0"}`} />
                              <span className="flex items-center justify-between gap-2 w-full">
                                <span className="truncate">{b.buyerName}</span>
                                {b.buyerId && <span className="text-xs text-muted-foreground font-mono">{b.buyerId}</span>}
                              </span>
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {buyerError && (
                <span className="text-xs text-destructive" data-testid="text-mn-buyer-error">{buyerError}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="mn-exit-date" className="text-xs whitespace-nowrap">{t("exitDate")}</Label>
              <Input
                id="mn-exit-date"
                type="date"
                value={exitDate}
                onChange={(e) => setExitDate(e.target.value)}
                disabled={!!result}
                className="h-8 w-40"
                data-testid="input-mn-exit-date"
              />
            </div>
            {result ? (
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">{t("exitBillNumber")}</div>
                  <div className="text-lg font-bold text-amber-600" data-testid="text-mn-bill">#{result.sharedExitBillNumber}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">CS Bill #</div>
                  <div
                    className="text-lg font-bold text-amber-600"
                    data-testid="text-mn-cs-bill"
                  >
                    {result.sharedColdStorageBillNumber != null
                      ? `#${result.sharedColdStorageBillNumber}`
                      : "—"}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className={`flex items-center gap-2 rounded-md px-2 py-1 border ${
                  sharedExitBillEdited
                    ? "border-blue-300 dark:border-blue-700 bg-blue-50/60 dark:bg-blue-900/20"
                    : "border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-900/20"
                }`}>
                  <Label htmlFor="mn-shared-exit-bill" className="text-xs whitespace-nowrap">
                    {t("exitBillNumber") || "Exit Bill #"}
                  </Label>
                  <Input
                    id="mn-shared-exit-bill"
                    type="number"
                    min={1}
                    value={sharedExitBillInput}
                    onChange={(e) => {
                      setSharedExitBillInput(e.target.value);
                      setSharedExitBillEdited(true);
                      if (billNumberError && /Exit Bill/i.test(billNumberError)) setBillNumberError(null);
                    }}
                    className={`h-8 w-20 ${billNumberError && /Exit Bill/i.test(billNumberError) ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                    data-testid="input-mn-shared-exit-bill"
                    aria-invalid={!!(billNumberError && /Exit Bill/i.test(billNumberError))}
                  />
                  <span className={`text-[10px] uppercase tracking-wide ${
                    sharedExitBillEdited ? "text-blue-700 dark:text-blue-300" : "text-amber-700 dark:text-amber-300"
                  }`}>
                    {sharedExitBillEdited ? "edited" : "auto"}
                  </span>
                </div>
                {/* Shared Cold Storage bill # — single value applied to
                    every row in this batch. Same auto/edited badge
                    pattern as the shared Exit Bill input. */}
                <div className={`flex items-center gap-2 rounded-md px-2 py-1 border ${
                  sharedColdStorageBillEdited
                    ? "border-blue-300 dark:border-blue-700 bg-blue-50/60 dark:bg-blue-900/20"
                    : "border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-900/20"
                }`}>
                  <Label htmlFor="mn-shared-cs-bill" className="text-xs whitespace-nowrap">
                    CS Bill #
                  </Label>
                  <Input
                    id="mn-shared-cs-bill"
                    type="number"
                    min={1}
                    value={sharedColdStorageBillInput}
                    onChange={(e) => {
                      setSharedColdStorageBillInput(e.target.value);
                      setSharedColdStorageBillEdited(true);
                      if (billNumberError && /Cold Storage Bill/i.test(billNumberError)) setBillNumberError(null);
                    }}
                    className={`h-8 w-20 ${billNumberError && /Cold Storage Bill/i.test(billNumberError) ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                    data-testid="input-mn-shared-cs-bill"
                    aria-invalid={!!(billNumberError && /Cold Storage Bill/i.test(billNumberError))}
                  />
                  {/* Task #256: when every row's lot is already base-billed
                      AND the operator hasn't typed an override, show
                      "skip" so it's clear no CS Bill # will be assigned
                      to this batch (server writes NULL across siblings). */}
                  <span className={`text-[10px] uppercase tracking-wide ${
                    sharedColdStorageBillEdited ? "text-blue-700 dark:text-blue-300" : "text-amber-700 dark:text-amber-300"
                  }`}>
                    {sharedColdStorageBillEdited
                      ? "edited"
                      : (allSelectedRowsBaseBilled ? "skip" : "auto")}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
        {billNumberError && (
          <p
            className="text-xs text-red-600 dark:text-red-400 px-1 -mt-1"
            data-testid="error-mn-bill-number"
          >
            {billNumberError}
          </p>
        )}
        {/* Task #256: hint that blank input is intentional when every
            selected lot's base CS charges were already billed earlier
            (whole batch saves with NULL CS Bill #). */}
        {!result &&
          allSelectedRowsBaseBilled &&
          !sharedColdStorageBillEdited &&
          !billNumberError && (
            <p
              className="text-[11px] text-muted-foreground px-1 -mt-1"
              data-testid="hint-mn-cs-bill-skip"
            >
              {t("skipCsBillHint")}
            </p>
          )}

        {/* Grid */}
        {lots.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{t("noLotsAvailable")}</p>
        ) : duplicateKey ? (
          <p className="text-sm text-destructive py-6 text-center" data-testid="text-mn-duplicate-error">
            {t("duplicateLotData")} "{duplicateKey.replace("::", " / ")}". {t("fixDuplicateLot")}
          </p>
        ) : (
          <div className="overflow-x-auto border border-blue-700 rounded-md">
            <table className="w-full text-xs min-w-[1240px] border-collapse [&_th]:border [&_th]:border-blue-700 [&_th]:whitespace-nowrap [&_td]:border [&_td]:border-border">
              <thead className="bg-blue-700 text-white">
                <tr>
                  <th className="p-2 text-left">{t("receiptNo")}</th>
                  <th className="p-2 text-left">{t("marka") || "Marka"}</th>
                  <th className="p-2 text-right">{t("remainingBagsShort")}</th>
                  <th className="p-2 text-right">{t("exitBags")}</th>
                  <th className="p-2 text-right">{t("soldBags") || "Sold Bags"}</th>
                  <th className="p-2 text-left">{t("chargeBasis")}</th>
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
                  const exceeds = !!lwc && totals.exitBags > remaining;
                  // Sold validation: must be >= exit and <= remaining.
                  // The cell renders red when out of range. We use the
                  // raw input string to detect a true blank (vs. "0"),
                  // so the row only goes invalid once the operator has
                  // typed something — empty defaults to exit cleanly.
                  const soldRaw = r.soldBags === "" ? NaN : Number(r.soldBags);
                  const soldEntered = !Number.isNaN(soldRaw);
                  const soldExceeds = !!lwc && soldEntered && soldRaw > remaining;
                  const soldBelowExit = soldEntered && totals.exitBags > 0 && soldRaw < totals.exitBags;
                  const soldInvalid = soldExceeds || soldBelowExit;

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
                      <td className="p-2 w-[110px]">
                        <ReceiptCombobox
                          idx={idx}
                          value={r.lotNo}
                          options={lotNoOptions.map(n => {
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
                            return { lotNo: n, disabled: allUsed };
                          })}
                          disabled={!!result}
                          onPick={(newLotNo) => {
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
                          onClear={() => updateRow(r.rowKey, { lotNo: "", marka: "" })}
                          searchPlaceholder={t("searchReceipt") || "Search Receipt #"}
                          emptyText={t("noReceiptFound") || "No matching Receipt #"}
                          clearLabel={t("clear") || "Clear"}
                        />
                      </td>
                      <td className="p-2 w-[130px]">
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
                          onChange={(e) => updateExitBags(r.rowKey, e.target.value)}
                          disabled={!!result || !r.lotNo || !r.marka}
                          className={`h-8 w-14 text-right ${exceeds || soldBelowExit ? "border-destructive" : ""}`}
                          data-testid={`input-mn-bags-${idx}`}
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={1}
                          max={remaining || undefined}
                          value={r.soldBags}
                          onChange={(e) => updateRow(r.rowKey, { soldBags: e.target.value })}
                          disabled={!!result || !r.lotNo || !r.marka}
                          className={`h-8 w-14 text-right ${soldInvalid ? "border-destructive" : ""}`}
                          data-testid={`input-mn-sold-${idx}`}
                          aria-invalid={soldInvalid}
                          title={
                            soldExceeds
                              ? `Only ${remaining} bag(s) remaining`
                              : soldBelowExit
                                ? `Sold cannot be less than exit (${totals.exitBags})`
                                : undefined
                          }
                        />
                      </td>
                      <td className="p-2 w-[150px]">
                        {/* Per-row charge basis: mirrors the partial-sale
                            dialog. Disabled (and forced to "actual") when
                            the lot's base cold charges have already been
                            billed earlier — picking "totalRemaining" then
                            would be misleading because the calculator
                            zeroes base regardless. */}
                        {(() => {
                          const baseAlreadyBilled = lwc?.lot.baseColdChargesBilled === 1;
                          const disabled = !!result || !r.lotNo || !r.marka || baseAlreadyBilled;
                          // When the lot's base flag is already 1, force
                          // the visible value to "actual" — the server
                          // also forces this defensively, and the calc
                          // zeroes base regardless, but showing "All
                          // Remaining Bags" here would be misleading.
                          const displayValue = baseAlreadyBilled ? "actual" : r.chargeBasis;
                          return (
                            <Select
                              value={displayValue}
                              onValueChange={(value: "actual" | "totalRemaining") =>
                                updateRow(r.rowKey, { chargeBasis: value })
                              }
                              disabled={disabled}
                            >
                              <SelectTrigger
                                className={`h-8 ${baseAlreadyBilled ? "bg-muted cursor-not-allowed" : ""}`}
                                data-testid={`select-mn-charge-basis-${idx}`}
                                title={baseAlreadyBilled
                                  ? (t("baseChargesBilledChargeBasisHint") || "Base charges already billed - using actual bags only")
                                  : undefined}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="actual">{t("actualBags")}</SelectItem>
                                <SelectItem value="totalRemaining">{t("allRemainingBags")}</SelectItem>
                              </SelectContent>
                            </Select>
                          );
                        })()}
                      </td>
                      <td className="p-2 text-right font-mono" data-testid={`text-mn-base-${idx}`}>{fmt(totals.base)}</td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={0}
                          value={r.kataCharges}
                          onChange={(e) => updateRow(r.rowKey, { kataCharges: e.target.value })}
                          disabled={!!result || !r.lotNo || !r.marka}
                          className="h-8 w-14 text-right"
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
                          className="h-8 w-16 text-right"
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
                          className="h-8 w-14 text-right"
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
                  <td className="p-2 text-right font-mono" data-testid="text-mn-total-bags">{totalExitBags}</td>
                  <td className="p-2 text-right font-mono" data-testid="text-mn-total-sold">{totalSoldBags}</td>
                  {/* colSpan covers [chargeBasis, base, kata, extra, grading] */}
                  <td className="p-2" colSpan={5}></td>
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
              <NikasiPrintable
                data={{
                  sharedExitBillNumber: result.sharedExitBillNumber,
                  exitDate: result.exitDate,
                  farmer: {
                    farmerName: result.farmer.farmerName,
                    village: result.farmer.village,
                    contactNumber: result.farmer.contactNumber,
                  },
                  buyerName: result.buyer?.buyerName ?? null,
                  sales: result.sales.map(s => ({
                    saleId: s.saleId,
                    lotNo: s.lotNo,
                    marka: s.marka,
                    bagsExited: s.bagsExited,
                    bagType: s.bagType,
                    chamberName: s.chamberName,
                    floor: s.floor,
                    position: s.position,
                  })),
                }}
                coldStorage={coldStorage}
                partyRowLabel={partyRowLabel}
                t={t}
              />
            </div>
          </div>
        )}

        {/* Allocation preview — only shown when a payment is staged. Mirrors the
            server's top-to-bottom allocation against rowTotals.total so the
            operator sees exactly which rows will be paid in full / part /
            untouched before submit. */}
        {!result && attachedPayment && (() => {
          // Allocate `amount` only (round-off is metadata on last touched row,
          // not allocatable due). Find last touched row to annotate its
          // displayed round-off badge.
          const amt = attachedPayment.amount || 0;
          const rOff = attachedPayment.roundOff || 0;
          let remaining = amt;
          const allocs = rowTotals.map((r) => {
            const due = r.total;
            const a = Math.min(remaining, due);
            remaining = Math.max(0, remaining - a);
            return { due, alloc: a };
          });
          let lastTouched = -1;
          for (let i = allocs.length - 1; i >= 0; i--) {
            if (allocs[i].alloc > 0) { lastTouched = i; break; }
          }
          return (
            <div className="rounded-md border bg-muted/30 p-2 mb-2 text-xs space-y-1" data-testid="text-mn-payment-preview">
              <div className="font-semibold">
                {t("paymentAttached")} ₹{fmt(amt)}
                {rOff !== 0 ? <span className="ml-1 text-muted-foreground">(+ ₹{fmt(rOff)} {t("roundOff")})</span> : null}
                {" "}— {t("recordPaymentForNikasi")}
              </div>
              {allocs.map((a, i) => {
                const r = rows[i];
                const status = a.alloc <= 0 ? "(—)" : a.alloc + 0.005 >= a.due ? `(${t("paid")})` : `(${t("partial") || "partial"})`;
                const isLast = i === lastTouched && rOff !== 0;
                return (
                  <div key={r.rowKey} className="flex justify-between" data-testid={`text-mn-payment-preview-row-${i}`}>
                    <span className="text-muted-foreground">Row {i + 1} ({r.lotNo || "—"}): ₹{fmt(a.due)}</span>
                    <span className="font-mono">
                      ₹{fmt(a.alloc)} {status}
                      {isLast ? <span className="ml-1 text-[10px] text-muted-foreground">+₹{fmt(rOff)} r/o</span> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })()}

        <DialogFooter className="gap-2 sm:justify-between">
          {!result && (
            <Button
              type="button"
              variant={paymentError ? "destructive" : attachedPayment ? "default" : "outline"}
              onClick={() => { setPaymentDialogOpen(true); }}
              disabled={validRowCount === 0 || grandTotal <= 0 || submitMutation.isPending}
              className={paymentError ? "bg-red-600 hover:bg-red-700 text-white" : attachedPayment ? "bg-green-600 hover:bg-green-700 text-white" : ""}
              data-testid="button-mn-open-payment"
            >
              {attachedPayment ? (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  {t("paymentAttached")} ₹{fmt(((attachedPayment.amount || 0) + (attachedPayment.roundOff || 0)))}
                </>
              ) : (
                <>
                  <IndianRupee className="h-4 w-4 mr-1" />
                  {t("addPayment")}
                </>
              )}
            </Button>
          )}
          <div className="flex gap-2 ml-auto">
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
                {attachedPayment && (
                  <span className="ml-1 font-normal" data-testid="text-mn-submit-pay-suffix">
                    {" + "}{t("pay")} ₹{fmt((attachedPayment.amount || 0) + (attachedPayment.roundOff || 0))}
                  </span>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>

        {/* Inline payment sub-dialog (Task #294). Mirrors ManualPaymentDialog's
            field set: Cash/Account toggle, account picker, Amount, Round-off,
            Received-on, Notes. On Apply, stages the snapshot in `attachedPayment`;
            the actual receipt(s) are written on MN submit, inside the same db tx. */}
        <PaymentSubDialog
          open={paymentDialogOpen}
          onOpenChange={(o) => { setPaymentDialogOpen(o); if (!o) setPaymentError(null); }}
          totalDue={grandTotal}
          initial={attachedPayment}
          externalError={paymentError}
          onClearError={() => setPaymentError(null)}
          onApply={(snap) => {
            setAttachedPayment(snap);
            setPaymentError(null);
            setPaymentDialogOpen(false);
          }}
          onClear={() => {
            setAttachedPayment(null);
            setPaymentError(null);
            setPaymentDialogOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

interface PaymentSubDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalDue: number;
  initial: {
    receiptType: "cash" | "account";
    accountId: string | null;
    amount: number;
    roundOff: number;
    receivedAt: string;
    notes: string;
  } | null;
  externalError: string | null;
  onApply: (snapshot: {
    receiptType: "cash" | "account";
    accountId: string | null;
    amount: number;
    roundOff: number;
    receivedAt: string;
    notes: string;
  }) => void;
  onClear: () => void;
}

function PaymentSubDialog({ open, onOpenChange, totalDue, initial, externalError, onClearError, onApply, onClear }: PaymentSubDialogProps & { onClearError?: () => void }) {
  const { t } = useI18n();
  const todayIst = (): string =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  const [receiptType, setReceiptType] = useState<"cash" | "account">("cash");
  const [accountId, setAccountId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [roundOff, setRoundOff] = useState<string>("");
  const [receivedAt, setReceivedAt] = useState<string>(todayIst);
  const [notes, setNotes] = useState<string>("");

  // Year-keyed bank account list — driven by the operator-picked Received-on
  // date (NOT the current year), so backdated receipts show that year's
  // accounts. Falls back to current calendar year if the date is unparseable.
  const receivedYear = (() => {
    const m = receivedAt?.match(/^(\d{4})-/);
    return m ? parseInt(m[1], 10) : new Date().getFullYear();
  })();
  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({
    queryKey: ["/api/bank-accounts", receivedYear],
    enabled: open,
  });

  // Reset to either the staged snapshot or sensible defaults each open.
  useEffect(() => {
    if (!open) return;
    if (initial) {
      setReceiptType(initial.receiptType);
      setAccountId(initial.accountId || "");
      setAmount(initial.amount > 0 ? String(initial.amount) : "");
      setRoundOff(initial.roundOff > 0 ? String(initial.roundOff) : "");
      setReceivedAt(initial.receivedAt);
      setNotes(initial.notes);
    } else {
      setReceiptType("cash");
      setAccountId("");
      // Pre-fill amount with the total due so the operator can immediately
      // hit Apply for a full payment. They can edit it down for partials.
      setAmount(totalDue > 0 ? String(Math.round(totalDue * 100) / 100) : "");
      setRoundOff("");
      setReceivedAt(todayIst());
      setNotes("");
    }
  }, [open, initial, totalDue]);

  const amountNum = parseFloat(amount) || 0;
  const roundOffNum = parseFloat(roundOff) || 0;
  const gross = amountNum + roundOffNum;
  // Validate by `amount` only; round-off is metadata stamped on last touched
  // receipt and does NOT reduce sale dues (task contract).
  const exceedsDue = amountNum > totalDue + 0.5;
  const amountInvalid = amountNum <= 0;
  const accountMissing = receiptType === "account" && amountNum > 0 && !accountId;
  const dateInvalid = !/^\d{4}-\d{2}-\d{2}$/.test(receivedAt);

  const canApply = !amountInvalid && !exceedsDue && !accountMissing && !dateInvalid;

  const handleApply = () => {
    if (!canApply) return;
    onApply({
      receiptType,
      accountId: receiptType === "account" ? accountId : null,
      amount: amountNum,
      roundOff: roundOffNum,
      receivedAt,
      notes,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-mn-payment">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IndianRupee className="h-4 w-4" />
            {t("recordPaymentForNikasi")}
          </DialogTitle>
          <DialogDescription>{t("paymentSubDialogDesc")}</DialogDescription>
        </DialogHeader>

        {/* Due summary */}
        <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("totalColdStorageDue")}</span>
            <span className="font-semibold" data-testid="text-mn-payment-total-due">
              ₹{totalDue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">{t("paymentMode")}</Label>
            <Select value={receiptType} onValueChange={(v) => { onClearError?.(); setReceiptType(v as "cash" | "account"); }}>
              <SelectTrigger className="h-9" data-testid="select-mn-payment-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">{t("cash")}</SelectItem>
                <SelectItem value="account">{t("accountBank")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {receiptType === "account" && (
            <div className="space-y-1.5">
              <Label className="text-xs">{t("bankAccount")}</Label>
              <Select value={accountId} onValueChange={(v) => { onClearError?.(); setAccountId(v); }}>
                <SelectTrigger className="h-9" data-testid="select-mn-payment-account">
                  <SelectValue placeholder={t("selectAnAccount")} />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.accountName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {accountMissing && (
                <div className="text-xs text-red-600 dark:text-red-400" data-testid="text-mn-payment-error-account">
                  {t("bankAccountRequired")}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("amount")} (₹)</Label>
              <Input
                type="number" step="0.01" min="0" inputMode="decimal"
                value={amount}
                onChange={(e) => { onClearError?.(); setAmount(e.target.value); }}
                placeholder="0"
                data-testid="input-mn-payment-amount"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("roundOff")} (₹)</Label>
              <Input
                type="number" step="0.01" min="0" inputMode="decimal"
                value={roundOff}
                onChange={(e) => { onClearError?.(); setRoundOff(e.target.value); }}
                placeholder="0"
                data-testid="input-mn-payment-roundoff"
              />
            </div>
          </div>

          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground">{t("gross")}</span>
            <span
              className={`font-semibold ${exceedsDue ? "text-red-600 dark:text-red-400" : ""}`}
              data-testid="text-mn-payment-gross"
            >
              ₹{gross.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </span>
          </div>
          {exceedsDue && (
            <div className="text-xs text-red-600 dark:text-red-400" data-testid="text-mn-payment-error-exceeds">
              {t("cannotExceedTotalDue")} (₹{totalDue.toLocaleString("en-IN", { maximumFractionDigits: 2 })})
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">{t("receivedOn")}</Label>
            <Input
              type="date"
              value={receivedAt}
              onChange={(e) => { onClearError?.(); setReceivedAt(e.target.value); }}
              data-testid="input-mn-payment-date"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t("notesOptional")}</Label>
            <Textarea
              value={notes}
              onChange={(e) => { onClearError?.(); setNotes(e.target.value); }}
              placeholder={t("remarksPlaceholder")}
              rows={2}
              data-testid="input-mn-payment-notes"
            />
          </div>

          {externalError && (
            <div className="text-xs text-red-600 dark:text-red-400 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-2" data-testid="text-mn-payment-error-server">
              {externalError}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {initial ? (
            <Button
              type="button"
              variant="ghost"
              className="text-red-600 hover:text-red-700"
              onClick={onClear}
              data-testid="button-mn-payment-clear"
            >
              {t("clearPayment")}
            </Button>
          ) : <span />}
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-mn-payment-cancel">
              {t("cancel")}
            </Button>
            <Button
              onClick={handleApply}
              disabled={!canApply}
              className="bg-green-600 hover:bg-green-700 text-white"
              data-testid="button-mn-payment-apply"
            >
              {t("applyPayment")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ReceiptComboboxProps {
  idx: number;
  value: string;
  options: { lotNo: string; disabled: boolean }[];
  disabled: boolean;
  onPick: (lotNo: string) => void;
  onClear: () => void;
  searchPlaceholder: string;
  emptyText: string;
  clearLabel: string;
}

function ReceiptCombobox({
  idx,
  value,
  options,
  disabled,
  onPick,
  onClear,
  searchPlaceholder,
  emptyText,
  clearLabel,
}: ReceiptComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.lotNo.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-8 w-full justify-between font-normal px-2"
          data-testid={`select-mn-lot-${idx}`}
        >
          <span className="truncate">{value || "—"}</span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={query}
            onValueChange={setQuery}
            data-testid={`input-mn-lot-search-${idx}`}
          />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {filtered.map(o => (
                <CommandItem
                  key={o.lotNo}
                  value={o.lotNo}
                  disabled={o.disabled}
                  onSelect={() => {
                    if (o.disabled) return;
                    onPick(o.lotNo);
                    setOpen(false);
                    setQuery("");
                  }}
                  data-testid={`option-mn-lot-${idx}-${o.lotNo}`}
                >
                  <Check className={`mr-2 h-4 w-4 ${value === o.lotNo ? "opacity-100" : "opacity-0"}`} />
                  {o.lotNo}
                </CommandItem>
              ))}
            </CommandGroup>
            {value && (
              <CommandGroup>
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onClear();
                    setOpen(false);
                    setQuery("");
                  }}
                  className="text-destructive"
                  data-testid={`option-mn-lot-clear-${idx}`}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {clearLabel}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
