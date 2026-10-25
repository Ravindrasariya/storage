import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import type { ArchiveRecord } from "@shared/bills-archive";
import { Archive, AlertCircle, Download, Eye, Printer, Search, X } from "lucide-react";
import { authFetch } from "@/lib/queryClient";
import { useI18n } from "@/lib/i18n";
import { useDropdownNavigation } from "@/hooks/use-dropdown-navigation";
import { DateFilterBar, dateMatchesFilter } from "@/components/DateFilterBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Currency, formatCurrency } from "@/components/Currency";
import { calculateTotalColdCharges } from "@shared/schema";

type RegisterKind = "sales" | "exits";
type Filters = {
  year: string;
  months: number[];
  days: number[];
  farmer: string;
  farmerContact: string;
  selectedFarmerVillage: string;
  selectedFarmerIdentity: boolean;
  village: string;
  buyer: string;
  type: string;
  payment: string;
  bill: string;
};
type FarmerSuggestion = { farmerName: string; contactNumber: string; village: string };

const emptyFilters = (): Filters => ({
  year: "all", months: [], days: [], farmer: "", farmerContact: "",
  selectedFarmerVillage: "", selectedFarmerIdentity: false, village: "", buyer: "", type: "all", payment: "all", bill: "",
});

const text = (value: unknown) => value == null || value === "" ? "—" : String(value);
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]!));

function csvCell(value: unknown) {
  const raw = String(value ?? "");
  // Excel/Sheets evaluate cells beginning with formula operators, including
  // when whitespace precedes the operator. Prefix unsafe text, not numbers.
  const safe = typeof value === "string" && /^[\s\u0000-\u001f]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Archive detail must not borrow current lot fields. In particular, a live
 * lot's remaining size is not the historical remaining size at reversal.
 */
function snapshot(record: ArchiveRecord, kind: RegisterKind) {
  return { ...(kind === "sales" ? record.sale ?? {} : record.exit ?? {}), ...record.display };
}

function value(row: Record<string, any>, key: string, fallback?: string) {
  return row[key] ?? (fallback ? row[fallback] : undefined);
}

function dateText(value: unknown, pattern: string) {
  if (!value) return "—";
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? "—" : format(date, pattern);
}

function printHtml(title: string, status: string, headers: string[], rows: string[][], language: string) {
  const tableRows = rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
  @page{size:A4 landscape;margin:8mm}*{box-sizing:border-box}body{font:12px system-ui,sans-serif;color:#272b28;margin:16px}
  h1{font-size:18px;margin:0 0 4px}.mark{color:#9b3b31;font-weight:700;margin:0 0 12px}
  table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #aeb6b1;padding:5px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
  th{background:#e9eeea;font-size:10px}@media print{body{margin:8mm}tr{break-inside:avoid}}
  </style></head><body><h1>${escapeHtml(title)}</h1><p class="mark">${escapeHtml(status)}</p>
  <table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table>
  <script>window.onload=()=>window.print()</script></body></html>`;
}

function printSnapshot(title: string, status: string, headers: string[], rows: string[][], language: string) {
  const html = printHtml(title, status, headers, rows, language);
  const popup = window.open("", "_blank");
  if (popup) {
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    return;
  }

  // Mobile browsers may block popups even after a deliberate button press.
  // Use a temporary hidden iframe as the same read-only print fallback.
  const frame = document.createElement("iframe");
  frame.title = title;
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.opacity = "0";
  frame.style.pointerEvents = "none";
  frame.style.border = "0";
  frame.onload = () => {
    const frameWindow = frame.contentWindow;
    if (!frameWindow) {
      frame.remove();
      return;
    }
    frameWindow.addEventListener("afterprint", () => frame.remove(), { once: true });
    frameWindow.focus();
    frameWindow.print();
    window.setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
  frame.srcdoc = html;
}

function baseBuyer(row: Record<string, any>, t: (key: string) => string) {
  return Number(row.isSelfSale) === 1 ? t("self") : (row.buyerName || "-");
}

function activeTransfer(row: Record<string, any>) {
  return Boolean(row.transferToBuyerName?.trim()) && Number(row.isTransferReversed) !== 1;
}

function effectiveExitBuyer(row: Record<string, any>, t: (key: string) => string) {
  return activeTransfer(row) ? row.transferToBuyerName : baseBuyer(row, t);
}

function coldChargeAmount(row: Record<string, any>): number | null {
  if (row.coldStorageCharge == null || !Number.isFinite(Number(row.coldStorageCharge))) return null;
  return calculateTotalColdCharges({
    coldStorageCharge: Number(row.coldStorageCharge),
    kataCharges: row.kataCharges,
    tulaiCharges: row.tulaiCharges,
    extraHammali: row.extraHammali,
    gradingCharges: row.gradingCharges,
  });
}

function salePaymentText(row: Record<string, any>, t: (key: string) => string) {
  const values = [row.paymentStatus ? t(row.paymentStatus) : "—"];
  if (row.paymentStatus === "partial") values.push(`${t("paid")}: ₹${formatCurrency(row.paidAmount || 0)}`);
  if (row.paidAt) values.push(`${t("paidOn")}: ${dateText(row.paidAt, "dd/MM/yy")}`);
  return values.join(" · ");
}

export function ArchiveRegisters({ kind }: { kind: RegisterKind }) {
  const { t, language } = useI18n();
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [selected, setSelected] = useState<ArchiveRecord | null>(null);
  const [farmerSuggestionsOpen, setFarmerSuggestionsOpen] = useState(false);
  const farmerNavigation = useDropdownNavigation();
  const endpoint = kind === "sales" ? "/api/bills-archive/sales" : "/api/bills-archive/exits";
  const { data = [], isLoading, isError, refetch } = useQuery<ArchiveRecord[]>({
    queryKey: [endpoint],
    queryFn: async () => {
      const response = await authFetch(endpoint);
      if (!response.ok) throw new Error(`Archive request failed (${response.status})`);
      return response.json();
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  const rows = useMemo(() => data.map((record) => ({ record, row: snapshot(record, kind) })), [data, kind]);
  const availableYears = useMemo(() => Array.from(new Set(rows.map(({ row }) => {
    const date = value(row, kind === "sales" ? "soldAt" : "exitDate");
    const year = date ? new Date(date).getFullYear() : NaN;
    return Number.isFinite(year) ? year : null;
  }).filter((year): year is number => year !== null))).sort((a, b) => b - a), [rows, kind]);

  const farmerOptions = useMemo(() => {
    const byIdentity = new Map<string, FarmerSuggestion>();
    for (const { row } of rows) {
      const farmerName = String(row.farmerName ?? "").trim();
      if (!farmerName) continue;
      const option = {
        farmerName,
        contactNumber: String(row.contactNumber ?? row.farmerContact ?? "").trim(),
        village: String(row.village ?? "").trim(),
      };
      byIdentity.set(`${option.farmerName}\u0000${option.contactNumber}\u0000${option.village}`, option);
    }
    return Array.from(byIdentity.values()).sort((a, b) =>
      a.farmerName.localeCompare(b.farmerName) || a.village.localeCompare(b.village) || a.contactNumber.localeCompare(b.contactNumber));
  }, [rows]);
  const farmerSuggestions = useMemo(() => {
    const query = filters.farmer.trim().toLocaleLowerCase();
    if (!query) return [];
    return farmerOptions.filter((farmer) =>
      farmer.farmerName.toLocaleLowerCase().includes(query) ||
      farmer.contactNumber.toLocaleLowerCase().includes(query) ||
      farmer.village.toLocaleLowerCase().includes(query)).slice(0, 8);
  }, [farmerOptions, filters.farmer]);
  const villageOptions = useMemo(() => Array.from(new Set(rows.map(({ row }) => row.village)
    .filter((village): village is string => typeof village === "string" && !!village.trim()))).sort(), [rows]);
  const buyerOptions = useMemo(() => {
    const buyers = new Set<string>();
    for (const { row } of rows) {
      if (kind === "sales") {
        const original = baseBuyer(row, t);
        if (original) buyers.add(original);
        if (activeTransfer(row) && row.transferToBuyerName) buyers.add(row.transferToBuyerName);
      } else {
        const effective = effectiveExitBuyer(row, t);
        if (effective) buyers.add(effective);
      }
    }
    return Array.from(buyers).sort((a, b) => a.localeCompare(b));
  }, [rows, kind, t]);
  const bagTypeOptions = useMemo(() => Array.from(new Set(rows.map(({ row }) => row.bagType)
    .filter((type): type is string => typeof type === "string" && !!type.trim()))).sort(), [rows]);
  const paymentOptions = useMemo(() => Array.from(new Set(rows.map(({ row }) => row.paymentStatus)
    .filter((status): status is string => typeof status === "string" && !!status.trim()))).sort(), [rows]);

  const filtered = useMemo(() => rows.filter(({ row }) => {
    const date = value(row, kind === "sales" ? "soldAt" : "exitDate");
    if (date == null && filters.year === "all" && filters.months.length === 0 && filters.days.length === 0) {
      // Legacy orphan records without a business date remain searchable.
    } else if (!dateMatchesFilter(date, filters.year, filters.months, filters.days)) return false;

    const includes = (candidate: unknown, query: string) =>
      !query || String(candidate ?? "").toLocaleLowerCase().includes(query.toLocaleLowerCase());
    if (filters.farmer) {
      if (filters.selectedFarmerIdentity) {
        if (String(row.farmerName ?? "") !== filters.farmer ||
          String(row.contactNumber ?? row.farmerContact ?? "") !== filters.farmerContact) return false;
        if (!filters.village && filters.selectedFarmerVillage &&
          String(row.village ?? "") !== filters.selectedFarmerVillage) return false;
      } else if (!includes(row.farmerName, filters.farmer) && !includes(row.contactNumber ?? row.farmerContact, filters.farmer)) {
        return false;
      }
    }
    const effectiveVillage = filters.village || filters.selectedFarmerVillage;
    if (effectiveVillage && String(row.village ?? "").trim().toLocaleLowerCase() !== effectiveVillage.trim().toLocaleLowerCase()) return false;

    if (filters.buyer) {
      const search = filters.buyer.toLocaleLowerCase();
      const isSelf = search === t("self").toLocaleLowerCase() || search === "self";
      // Both live registers search the effective buyer (not the old buyer
      // after an active transfer), including Self only without a transfer.
      const effective = effectiveExitBuyer(row, t);
      const buyerMatches = isSelf
        ? Number(row.isSelfSale) === 1 && !activeTransfer(row)
        : includes(effective, filters.buyer);
      if (!buyerMatches) return false;
    }
    if (filters.type !== "all" && String(row.bagType ?? "").toLowerCase() !== filters.type) return false;
    if (filters.payment !== "all" && String(row.paymentStatus ?? "").toLowerCase() !== filters.payment) return false;
    if (filters.bill && (row.coldStorageBillNumber == null || Number(row.coldStorageBillNumber) !== Number(filters.bill))) return false;
    return true;
  }), [rows, filters, kind, t]);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((old) => ({ ...old, [key]: value }));
  const selectFarmer = (farmer: FarmerSuggestion) => {
    setFilters((old) => ({
      ...old,
      farmer: farmer.farmerName,
      farmerContact: farmer.contactNumber,
      selectedFarmerVillage: farmer.village,
      selectedFarmerIdentity: true,
    }));
    setFarmerSuggestionsOpen(false);
  };
  const clearFilters = () => {
    setFilters(emptyFilters());
    setFarmerSuggestionsOpen(false);
  };

  const salesHeaders = [
    t("saleDate"), t("farmerName"), t("village"), t("lotNo"), t("marka"), t("coldBillNo"),
    t("originalBags"), t("remainingBagsAfterSale"), t("bagType"), t("quantitySold"),
    t("totalColdStorageCharges"), t("buyerName"), t("pricePerKg"), t("paymentStatus"),
  ];
  const exitsHeaders = [
    t("exitDate"), t("farmerName"), t("village"), t("lotNo"), t("marka"), t("potatoType"),
    t("exitBillNo"), t("coldBillNo"), t("bagsExited"), t("buyerName"),
    t("coldStorageCharges"), t("paid"), t("due"),
  ];
  const headers = kind === "sales" ? salesHeaders : exitsHeaders;
  const showBuyer = (row: Record<string, any>) => {
    if (kind === "sales") {
      if (activeTransfer(row)) return { original: baseBuyer(row, t), transfer: row.transferToBuyerName, reversed: false };
      if (row.transferToBuyerName?.trim() && Number(row.isTransferReversed) === 1) {
        return { original: baseBuyer(row, t), transfer: row.transferToBuyerName, reversed: true };
      }
      return { original: baseBuyer(row, t) };
    }
    return { original: effectiveExitBuyer(row, t) };
  };
  const tableCells = (row: Record<string, any>): ReactNode[] => {
    if (kind === "sales") {
      const remaining = row.remainingSizeAtSale != null
        ? Number(row.remainingSizeAtSale) - Number(row.quantitySold)
        : null;
      const buyer = showBuyer(row);
      return [
        dateText(row.soldAt, "dd MMM yyyy"),
        row.farmerName || "—",
        row.village || "—",
        row.lotNo || "—",
        row.marka || "—",
        row.coldStorageBillNumber != null ? String(row.coldStorageBillNumber) : "—",
        text(row.originalLotSize),
        remaining != null ? text(remaining) : "—",
        row.bagType ? <Badge variant="outline" className={row.bagType === "wafer" ? "bg-chart-1/10 text-chart-1" : "bg-chart-2/10 text-chart-2"}>{t(row.bagType)}</Badge> : "—",
        text(row.quantitySold),
        coldChargeAmount(row) == null ? "—" : <Currency amount={coldChargeAmount(row)!} />,
        buyer.transfer ? <div className="flex flex-col">
          <span className={buyer.reversed ? "" : "line-through text-muted-foreground"}>{buyer.original}</span>
          <span className={buyer.reversed ? "line-through text-muted-foreground text-xs" : "font-medium text-purple-600"}>{buyer.transfer}</span>
        </div> : buyer.original,
        row.pricePerKg ? <Currency amount={row.pricePerKg} /> : "-",
        <div>
          <Badge variant={row.paymentStatus === "paid" ? "default" : row.paymentStatus === "partial" ? "secondary" : "destructive"} className={row.paymentStatus === "paid" ? "bg-green-600" : ""}>
            {row.paymentStatus ? t(row.paymentStatus) : "—"}
          </Badge>
          {row.paymentStatus === "partial" && <div className="mt-1 text-xs text-muted-foreground">{t("paid")}: <Currency amount={row.paidAmount || 0} /></div>}
          {row.paidAt && <div className="mt-1 text-xs text-muted-foreground">{t("paidOn")}: {dateText(row.paidAt, "dd/MM/yy")}</div>}
        </div>,
      ];
    }

    const knownType = ["wafer", "seed", "ration"].includes(String(row.bagType).toLowerCase());
    const buyer = showBuyer(row);
    return [
      dateText(row.exitDate, "dd MMM yyyy"),
      row.farmerName || "—",
      row.village || "—",
      row.lotNo || "—",
      row.marka || "—",
      knownType ? <Badge variant="outline" className={row.bagType === "wafer" ? "bg-chart-1/10 text-chart-1" : row.bagType === "seed" ? "bg-chart-2/10 text-chart-2" : "bg-chart-3/10 text-chart-3"}>{t(row.bagType)}</Badge> : <span className="text-muted-foreground">—</span>,
      row.billNumber != null && Number(row.billNumber) > 0 ? String(row.billNumber) : "—",
      row.coldStorageBillNumber != null ? String(row.coldStorageBillNumber) : "—",
      text(row.bagsExited),
      buyer.original || "-",
      <span className="font-medium"><Currency amount={row.coldChargeShare ?? 0} /></span>,
      Number(row.paidShare) > 0 ? <Currency amount={row.paidShare} /> : "—",
      Number(row.dueShare) > 0 ? <Currency amount={row.dueShare} /> : "—",
    ];
  };
  const cellClassName = (index: number) => {
    if (kind === "sales") {
      const right = [6, 7, 9, 10, 12].includes(index);
      return [
        "text-xs",
        index === 0 || index === 8 ? "whitespace-nowrap" : "",
        index === 1 ? "font-medium min-w-[120px]" : "",
        right ? "text-right" : "",
        index === 10 ? "font-medium" : "",
      ].filter(Boolean).join(" ");
    }
    const right = [8, 10, 11, 12].includes(index);
    return [
      "text-sm",
      index === 0 || index === 5 ? "whitespace-nowrap" : "",
      index === 1 ? "font-medium min-w-[120px]" : "",
      right ? "text-right" : "",
      index === 10 ? "font-medium" : "",
      index === 11 ? "text-emerald-700 dark:text-emerald-400" : "",
      index === 12 ? "text-rose-700 dark:text-rose-400" : "",
    ].filter(Boolean).join(" ");
  };

  const printableCells = (row: Record<string, any>, csv = false) => kind === "sales"
    ? [
      dateText(row.soldAt, csv ? "dd/MM/yyyy" : "dd MMM yyyy"), row.farmerName, row.village, row.lotNo, row.marka,
      row.coldStorageBillNumber, row.originalLotSize,
      row.remainingSizeAtSale != null ? Number(row.remainingSizeAtSale) - Number(row.quantitySold) : "—",
      row.bagType, row.quantitySold,
      coldChargeAmount(row) == null ? "—" : `₹${formatCurrency(coldChargeAmount(row)!)}`,
      activeTransfer(row) ? `${baseBuyer(row, t)} → ${row.transferToBuyerName}` : baseBuyer(row, t),
      row.pricePerKg ? `₹${formatCurrency(row.pricePerKg)}` : "-",
      salePaymentText(row, t),
    ]
    : [
      dateText(row.exitDate, csv ? "dd/MM/yyyy" : "dd MMM yyyy"), row.farmerName, row.village, row.lotNo, row.marka,
      row.bagType, row.billNumber != null && Number(row.billNumber) > 0 ? row.billNumber : "—",
      row.coldStorageBillNumber, row.bagsExited, effectiveExitBuyer(row, t),
      `₹${formatCurrency(row.coldChargeShare ?? 0)}`,
      Number(row.paidShare) > 0 ? `₹${formatCurrency(row.paidShare)}` : "—",
      Number(row.dueShare) > 0 ? `₹${formatCurrency(row.dueShare)}` : "—",
    ];

  const overallExport = () => {
    const csv = [headers, ...filtered.map(({ row }) => printableCells(row, true))]
      .map((line) => line.map(csvCell).join(",")).join("\r\n");
    downloadCsv(csv, `archive-${kind}-overall.csv`, language === "hi" ? "उलटा गया — अभिलेख प्रति" : "REVERSED — ARCHIVE COPY");
  };
  const kataExport = () => {
    const kataHeaders = language === "hi"
      ? ["बिक्री तिथि", "रसीद नं.", "कोल्ड स्टोरेज बिल", "निकासी बिल नं.", "किसान का नाम", "गाँव", "काटा चार्ज", "तुलाई"]
      : ["Sale Date", "Receipt #", "CS Bill #", "Exit Bill #", "Farmer Name", "Village", "Kata Charges", "Tulai Charges"];
    const rowsCsv = filtered.map(({ row }) => [
      dateText(row.soldAt, "dd/MM/yyyy"),
      row.lotNo ?? "",
      row.coldStorageBillNumber ?? "",
      row.exitBillNumbers ?? "",
      row.farmerName ?? "",
      row.village ?? "",
      row.kataCharges ?? 0,
      row.tulaiCharges ?? 0,
    ]);
    const csv = [kataHeaders, ...rowsCsv].map((line) => line.map(csvCell).join(",")).join("\r\n");
    downloadCsv(csv, "archive-sales-kata-tulai.csv", language === "hi" ? "उलटा गया — अभिलेख प्रति · काटा + तुलाई" : "REVERSED — ARCHIVE COPY · Kata + Tulai");
  };
  const statusMark = language === "hi" ? "उलटा गया — अभिलेख प्रति" : "REVERSED — ARCHIVE COPY";
  const printAll = () => printSnapshot(kind === "sales" ? t("salesHistory") : t("exitRegister"), statusMark, headers,
    filtered.map(({ row }) => printableCells(row).map((cell) => String(cell ?? ""))), language);
  const printOne = (record: ArchiveRecord) => {
    const row = snapshot(record, "sales");
    printSnapshot(`${t("salesHistory")} · ${row.lotNo ?? ""}`, statusMark, salesHeaders,
      [printableCells(row).map((cell) => String(cell ?? ""))], language);
  };

  const filterRows = () => (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold"><Archive className="h-4 w-4" />{language === "hi" ? "केवल उलटे गए अभिलेख" : "Reversed records only"}</div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={clearFilters} aria-label={language === "hi" ? "फ़िल्टर साफ़ करें" : "Clear filters"}>
              <X className="mr-1 h-4 w-4" />{t("clearFilters")}
            </Button>
            <Button variant="outline" size="icon" aria-label={t("printPdf")} title={t("printPdf")} onClick={printAll} disabled={!filtered.length}><Printer className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon" aria-label={language === "hi" ? "CSV डाउनलोड" : "Download CSV"} title={language === "hi" ? "CSV डाउनलोड" : "Download CSV"} onClick={overallExport} disabled={!filtered.length}><Download className="h-4 w-4" /></Button>
            {kind === "sales" && <Button variant="outline" size="sm" onClick={kataExport} disabled={!filtered.length}>{language === "hi" ? "काटा + तुलाई" : "Kata + Tulai"}</Button>}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-[22rem]">
            <DateFilterBar year={filters.year} onYearChange={(year) => setFilter("year", year)}
              selectedMonths={filters.months} onMonthsChange={(months) => setFilter("months", months)}
              selectedDays={filters.days} onDaysChange={(days) => setFilter("days", days)}
              availableYears={availableYears} testIdPrefix={`archive-${kind}`} />
          </div>
          <div className="relative w-full sm:w-44 space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor={`archive-${kind}-farmer`}>{t("filterByFarmer")}</label>
            <Search className="absolute left-3 top-[2.25rem] z-10 h-4 w-4 text-muted-foreground" />
            <Input id={`archive-${kind}-farmer`} value={filters.farmer}
              onChange={(event) => {
                setFilters((old) => ({ ...old, farmer: event.target.value, farmerContact: "", selectedFarmerVillage: "", selectedFarmerIdentity: false }));
                setFarmerSuggestionsOpen(true);
              }}
              onFocus={() => { setFarmerSuggestionsOpen(true); farmerNavigation.resetActive(); }}
              onBlur={() => setTimeout(() => { setFarmerSuggestionsOpen(false); farmerNavigation.resetActive(); }, 200)}
              onKeyDown={(event) => farmerNavigation.handleKeyDown(event, farmerSuggestions.length,
                (index) => selectFarmer(farmerSuggestions[index]), () => setFarmerSuggestionsOpen(false))}
              placeholder={t("farmerName")} className="pl-10" autoComplete="off" />
            {farmerSuggestionsOpen && farmerSuggestions.length > 0 && <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-auto rounded-md border bg-background shadow-lg">
              {farmerSuggestions.map((farmer, index) => <button key={`${farmer.farmerName}-${farmer.contactNumber}-${farmer.village}`}
                type="button" className={`flex w-full flex-col px-3 py-2 text-left text-sm hover-elevate ${farmerNavigation.activeIndex === index ? "bg-accent" : ""}`}
                onClick={() => selectFarmer(farmer)}>
                <span className="font-medium">{farmer.farmerName}</span>
                <span className="text-xs text-muted-foreground">{farmer.contactNumber || "—"} · {farmer.village || "—"}</span>
              </button>)}
            </div>}
            {filters.selectedFarmerIdentity && <div className="mt-1 flex items-center gap-1">
              <Badge variant="secondary" className="text-xs">{filters.farmerContact || "—"} · {filters.selectedFarmerVillage || "—"}</Badge>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setFilters((old) => ({ ...old, farmer: "", farmerContact: "", selectedFarmerVillage: "", selectedFarmerIdentity: false }))} aria-label={language === "hi" ? "किसान चयन हटाएँ" : "Clear selected farmer"}><X className="h-3 w-3" /></Button>
            </div>}
          </div>
          <div className="w-full sm:w-36 space-y-1">
            <label htmlFor={`archive-${kind}-village`} className="text-xs text-muted-foreground">{t("village")}</label>
            <Input id={`archive-${kind}-village`} list={`archive-${kind}-villages`} value={filters.village}
              onChange={(event) => setFilter("village", event.target.value)} placeholder={t("village")} autoComplete="off" />
            <datalist id={`archive-${kind}-villages`}>{villageOptions.map((village) => <option key={village} value={village} />)}</datalist>
          </div>
          <div className="w-full sm:w-44 space-y-1">
            <label htmlFor={`archive-${kind}-buyer`} className="text-xs text-muted-foreground">{t("filterByBuyer")}</label>
            <Input id={`archive-${kind}-buyer`} list={`archive-${kind}-buyers`} value={filters.buyer}
              onChange={(event) => setFilter("buyer", event.target.value)} placeholder={t("buyerName")} autoComplete="off" />
            <datalist id={`archive-${kind}-buyers`}>{buyerOptions.map((buyer) => <option key={buyer} value={buyer} />)}</datalist>
          </div>
          <div className="w-full sm:w-32 space-y-1">
            <label className="text-xs text-muted-foreground">{t("filterByType")}</label>
            <Select value={filters.type} onValueChange={(type) => setFilter("type", type)}>
              <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="all">{t("all")}</SelectItem>
                {Array.from(new Set(["wafer", "seed", "ration", ...bagTypeOptions.map((type) => type.toLowerCase())])).map((type) =>
                  <SelectItem key={type} value={type}>{(["wafer", "seed", "ration"].includes(type) ? t(type) : type)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {kind === "sales" && <div className="w-full sm:w-32 space-y-1">
            <label className="text-xs text-muted-foreground">{t("paymentStatus")}</label>
            <Select value={filters.payment} onValueChange={(payment) => setFilter("payment", payment)}>
              <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="all">{t("all")}</SelectItem>
                {Array.from(new Set(["paid", "partial", "due", ...paymentOptions.map((status) => status.toLowerCase())])).map((status) =>
                  <SelectItem key={status} value={status}>{t(status)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>}
          <div className="w-full sm:w-32 space-y-1">
            <label htmlFor={`archive-${kind}-bill`} className="text-xs text-muted-foreground">{t("coldBillNo")}</label>
            <Input id={`archive-${kind}-bill`} inputMode="numeric" value={filters.bill}
              onChange={(event) => setFilter("bill", event.target.value.replace(/[^0-9]/g, ""))} placeholder={t("coldBillNo")} />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      {filterRows()}
      <Card>
        <CardContent className="p-0">
          {isLoading ? <div className="space-y-3 p-5" aria-label={t("loading")}>{[1, 2, 3].map((item) => <Skeleton key={item} className="h-12 w-full" />)}</div>
            : isError ? <div className="flex flex-col items-center gap-3 p-10 text-center text-muted-foreground">
              <AlertCircle className="h-6 w-6 text-destructive" /><p>{language === "hi" ? "अभिलेख लोड नहीं हो सके।" : "Archive records could not be loaded."}</p>
              <Button variant="outline" onClick={() => void refetch()}>{language === "hi" ? "पुनः प्रयास करें" : "Retry"}</Button>
            </div>
            : filtered.length === 0 ? <div className="p-12 text-center">
              <Archive className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
              <p className="font-medium">{language === "hi" ? "कोई उलटा गया रिकॉर्ड नहीं मिला" : "No reversed records found"}</p>
              <p className="mt-1 text-sm text-muted-foreground">{language === "hi" ? "तिथि या फ़िल्टर बदलकर देखें।" : "Try a different date or filter."}</p>
            </div> : <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50"><TableRow>
                  {headers.map((header, index) => <TableHead key={`${index}-${header}`} className={`whitespace-nowrap ${kind === "sales" ? "text-xs" : "text-sm"} font-semibold ${(kind === "sales" ? [6, 7, 9, 10, 12] : [8, 10, 11, 12]).includes(index) ? "text-right" : ""}`}>{header}</TableHead>)}
                  <TableHead className="w-28 text-xs font-semibold">{language === "hi" ? "अभिलेख" : "Archive"}</TableHead>
                </TableRow></TableHeader>
                <TableBody>{filtered.map(({ record, row }) => <TableRow key={record.id}>
                  {tableCells(row).map((cell, index) => <TableCell key={index} className={cellClassName(index)}>
                    {cell}
                  </TableCell>)}
                  <TableCell><div className="flex items-center gap-1">
                    <Badge variant="destructive" className="px-1.5 text-[10px]">{language === "hi" ? "उलटा" : "Reversed"}</Badge>
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={language === "hi" ? "अभिलेख विवरण" : "Archive details"} onClick={() => setSelected(record)}><Eye className="h-4 w-4" /></Button>
                    {kind === "sales" && <Button variant="outline" size="icon" className="h-7 w-7" aria-label={t("print")} title={t("print")} onClick={() => printOne(record)}><Printer className="h-3.5 w-3.5" /></Button>}
                  </div></TableCell>
                </TableRow>)}</TableBody>
              </Table>
            </div>}
        </CardContent>
      </Card>
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{language === "hi" ? "अभिलेख विवरण · उलटा गया" : "Archive details · Reversed"}</DialogTitle></DialogHeader>
          {selected && <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-2">
              <div><span className="text-muted-foreground">{language === "hi" ? "मूल रिकॉर्ड आईडी" : "Original record ID"}</span><div className="font-mono">{selected.originalId}</div></div>
              <div><span className="text-muted-foreground">{language === "hi" ? "उलटने का समय" : "Reversed at"}</span><div>{selected.reversedAt ? dateText(selected.reversedAt, "dd MMM yyyy, HH:mm") : "—"}</div></div>
              <div><span className="text-muted-foreground">{language === "hi" ? "ऑपरेटर" : "Operator"}</span><div>{text(selected.operatorName)}</div></div>
              <div><span className="text-muted-foreground">{language === "hi" ? "स्रोत" : "Source"}</span><div>{selected.source === "legacy" ? (language === "hi" ? "पुराना अभिलेख" : "Legacy archive") : (language === "hi" ? "उलटने का स्नैपशॉट" : "Reversal snapshot")}</div></div>
            </div>
            <div className="divide-y rounded-md border">
              {Object.entries(snapshot(selected, kind)).map(([key, entry]) => <div key={key} className="grid grid-cols-[minmax(7rem,1fr)_2fr] gap-3 px-3 py-2 text-sm">
                <span className="break-words font-medium text-muted-foreground">{key}</span>
                <span className="break-words">{entry == null || entry === "" ? "—" : typeof entry === "object" ? JSON.stringify(entry) : String(entry)}</span>
              </div>)}
            </div>
            <div className="flex justify-end"><Button variant="outline" onClick={() => setSelected(null)}>{t("close")}</Button></div>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function downloadCsv(csv: string, filename: string, marker: string) {
  const blob = new Blob([`\uFEFF${csvCell(marker)}\r\n${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
