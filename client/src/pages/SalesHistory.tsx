import { useState, useMemo, useEffect, useRef } from "react";
import { useDropdownNavigation } from "@/hooks/use-dropdown-navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { authFetch, apiRequest, queryClient, invalidateSaleSideEffects } from "@/lib/queryClient";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Search, X, Filter, Package, Clock, LogOut, ArrowLeftRight, Download, Loader2, Warehouse, FileCheck, HandCoins, ChevronDown, Users, AlertTriangle, CreditCard, Banknote, Printer, BadgePercent } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import type { SalesHistory, SalesHistoryWithLastPayment, ExitRegisterResponse, ExitRegisterRow } from "@shared/schema";
import { PrintBillDialog } from "@/components/PrintBillDialog";
import { calculateTotalColdCharges } from "@shared/schema";
import { capitalizeFirstLetter } from "@/lib/utils";
import { Currency, formatCurrency } from "@/components/Currency";
import { DateFilterBar, dateMatchesFilter } from "@/components/DateFilterBar";

type FarmerRecord = {
  farmerName: string;
  village: string;
  tehsil: string;
  district: string;
  state: string;
  contactNumber: string;
};

const SALES_FILTERS_KEY = "salesHistoryFilters";

function loadSavedFilters() {
  try {
    const saved = localStorage.getItem(SALES_FILTERS_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.error("Failed to load saved filters:", e);
  }
  return null;
}

export default function SalesHistoryPage() {
  const { t, language } = useI18n();
  const { token } = useAuth();
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  
  // Load persisted filters or use defaults
  const savedFilters = loadSavedFilters();
  const [yearFilter, setYearFilter] = useState<string>(savedFilters?.yearFilter ?? new Date().getFullYear().toString());
  const [selectedMonths, setSelectedMonths] = useState<number[]>(Array.isArray(savedFilters?.selectedMonths) ? savedFilters.selectedMonths : []);
  const [selectedDays, setSelectedDays] = useState<number[]>(Array.isArray(savedFilters?.selectedDays) ? savedFilters.selectedDays : []);
  const [farmerFilter, setFarmerFilter] = useState(savedFilters?.farmerFilter ?? "");
  const [selectedFarmerVillage, setSelectedFarmerVillage] = useState(savedFilters?.selectedFarmerVillage ?? "");
  const [selectedFarmerMobile, setSelectedFarmerMobile] = useState(savedFilters?.selectedFarmerMobile ?? "");
  const [villageFilter, setVillageFilter] = useState<string>(savedFilters?.villageFilter ?? "");
  const [paymentFilter, setPaymentFilter] = useState<string>(savedFilters?.paymentFilter ?? "");
  const [buyerFilter, setBuyerFilter] = useState(savedFilters?.buyerFilter ?? "");
  const [typeFilter, setTypeFilter] = useState<string>(savedFilters?.typeFilter ?? "all");
  const [coldBillFilter, setColdBillFilter] = useState<string>(savedFilters?.coldBillFilter ?? "");

  const [activeTab, setActiveTab] = useState<"sales" | "tracker" | "exits">(savedFilters?.activeTab ?? "sales");

  // Persist filters + active tab to localStorage whenever any change
  useEffect(() => {
    const filters = {
      yearFilter,
      selectedMonths,
      selectedDays,
      farmerFilter,
      selectedFarmerVillage,
      selectedFarmerMobile,
      villageFilter,
      paymentFilter,
      buyerFilter,
      typeFilter,
      coldBillFilter,
      activeTab,
    };
    localStorage.setItem(SALES_FILTERS_KEY, JSON.stringify(filters));
  }, [yearFilter, selectedMonths, selectedDays, farmerFilter, selectedFarmerVillage, selectedFarmerMobile, villageFilter, paymentFilter, buyerFilter, typeFilter, coldBillFilter, activeTab]);

  // Autocomplete state
  const [showFarmerSuggestions, setShowFarmerSuggestions] = useState(false);
  const [showBuyerSuggestions, setShowBuyerSuggestions] = useState(false);
  const [showVillageSuggestions, setShowVillageSuggestions] = useState(false);
  // Per-row Print button state (mirrors Stock Register's wiring) — opens
  // the same PrintBillDialog so manual cold-storage payments recorded
  // here go through the same /api/sales/:id/manual-payment route and
  // get the same fifoExclusion=1 stamping as the Stock Register flow.
  const [printingSale, setPrintingSale] = useState<SalesHistoryWithLastPayment | null>(null);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const farmerNav = useDropdownNavigation();
  const villageNav = useDropdownNavigation();
  const buyerNav = useDropdownNavigation();

  const { data: years = [], isLoading: yearsLoading } = useQuery<number[]>({
    queryKey: ["/api/sales-history/years"],
  });

  // Farmer records for autocomplete
  const { data: farmerRecords } = useQuery<FarmerRecord[]>({
    queryKey: ["/api/farmers/lookup"],
    staleTime: 5 * 60 * 1000,
  });

  // Buyer records for autocomplete
  const { data: buyerRecords } = useQuery<{ buyerName: string }[]>({
    queryKey: ["/api/buyers/lookup"],
    staleTime: 5 * 60 * 1000,
  });

  // Filtered suggestions for farmer name
  const getFarmerSuggestions = useMemo(() => {
    if (!farmerRecords || farmerRecords.length === 0 || !farmerFilter.trim()) return [];
    const nameVal = farmerFilter.toLowerCase().trim();
    return farmerRecords
      .filter(farmer => farmer.farmerName.toLowerCase().includes(nameVal))
      .slice(0, 8);
  }, [farmerRecords, farmerFilter]);

  // Filtered suggestions for buyer name — always includes "Self" when input matches
  const getBuyerSuggestions = useMemo(() => {
    if (!buyerFilter.trim()) return [];
    const query = buyerFilter.toLowerCase().trim();
    const selfMatch = "self".includes(query) ? [{ buyerName: "Self" }] : [];
    const regular = (buyerRecords ?? [])
      .filter(buyer => buyer.buyerName.toLowerCase().includes(query))
      .slice(0, 8);
    return [...selfMatch, ...regular];
  }, [buyerRecords, buyerFilter]);

  // Village suggestions derived from farmer lookup
  const getVillageSuggestions = useMemo(() => {
    if (!farmerRecords || !villageFilter.trim()) return [];
    const q = villageFilter.toLowerCase().trim();
    const set = new Set<string>();
    for (const f of farmerRecords) {
      if (f.village && f.village.toLowerCase().includes(q)) set.add(f.village);
    }
    return Array.from(set).sort().slice(0, 8);
  }, [farmerRecords, villageFilter]);

  const selectFarmerSuggestion = (farmer: FarmerRecord) => {
    setFarmerFilter(farmer.farmerName);
    setSelectedFarmerVillage(farmer.village);
    setSelectedFarmerMobile(farmer.contactNumber);
    setShowFarmerSuggestions(false);
  };

  const selectBuyerSuggestion = (buyer: { buyerName: string }) => {
    setBuyerFilter(buyer.buyerName);
    setShowBuyerSuggestions(false);
  };

  const buildQueryString = () => {
    const params = new URLSearchParams();
    if (yearFilter) params.append("year", yearFilter);
    if (farmerFilter) params.append("farmerName", farmerFilter);
    const effectiveVillage = villageFilter || selectedFarmerVillage;
    if (effectiveVillage) params.append("village", effectiveVillage);
    if (selectedFarmerMobile) params.append("contactNumber", selectedFarmerMobile);
    if (paymentFilter) params.append("paymentStatus", paymentFilter);
    if (buyerFilter) params.append("buyerName", buyerFilter);
    if (coldBillFilter.trim()) params.append("coldStorageBillNumber", coldBillFilter.trim());
    return params.toString();
  };

  const { data: salesHistory = [], isLoading: historyLoading } = useQuery<SalesHistoryWithLastPayment[]>({
    queryKey: ["/api/sales-history", yearFilter, farmerFilter, selectedFarmerVillage, selectedFarmerMobile, villageFilter, paymentFilter, buyerFilter, coldBillFilter],
    queryFn: async () => {
      const queryString = buildQueryString();
      const response = await authFetch(`/api/sales-history${queryString ? `?${queryString}` : ""}`);
      if (!response.ok) throw new Error("Failed to fetch sales history");
      return response.json();
    },
  });

  const clearFilters = () => {
    setYearFilter("");
    setSelectedMonths([]);
    setSelectedDays([]);
    setFarmerFilter("");
    setSelectedFarmerVillage("");
    setSelectedFarmerMobile("");
    setVillageFilter("");
    setPaymentFilter("");
    setBuyerFilter("");
    setTypeFilter("all");
    setColdBillFilter("");
  };

  const hasActiveFilters = yearFilter || selectedMonths.length || selectedDays.length || farmerFilter || selectedFarmerVillage || villageFilter || paymentFilter || buyerFilter || coldBillFilter || (typeFilter && typeFilter !== "all");

  // Download function for sales export
  const getDownloadToken = async (): Promise<string | null> => {
    if (!token) return null;
    try {
      const response = await fetch("/api/export/token", {
        method: "POST",
        headers: { "x-auth-token": token },
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.downloadToken;
    } catch {
      return null;
    }
  };

  const handleExportSales = async () => {
    setIsExporting(true);
    try {
      const downloadToken = await getDownloadToken();
      if (!downloadToken) {
        toast({
          title: language === "hi" ? "डाउनलोड विफल" : "Download Failed",
          description: language === "hi" ? "कृपया पुनः प्रयास करें" : "Please try again",
          variant: "destructive",
        });
        return;
      }
      
      // Use selected year for date range, or wide range (2000-2099) if no year filter
      let fromDate: string;
      let toDate: string;
      if (yearFilter && yearFilter !== "all") {
        const selectedYear = parseInt(yearFilter, 10);
        fromDate = format(new Date(selectedYear, 0, 1), "yyyy-MM-dd");
        toDate = format(new Date(selectedYear, 11, 31), "yyyy-MM-dd");
      } else {
        // No year filter - use wide date range to export all years
        fromDate = "2000-01-01";
        toDate = "2099-12-31";
      }
      
      // Build URL with all filters
      const params = new URLSearchParams();
      params.append("fromDate", fromDate);
      params.append("toDate", toDate);
      params.append("language", language);
      params.append("downloadToken", downloadToken);
      
      // Add filter parameters
      if (yearFilter && yearFilter !== "all") params.append("year", yearFilter);
      if (farmerFilter) params.append("farmerName", farmerFilter);
      const effectiveVillageExport = villageFilter || selectedFarmerVillage;
      if (effectiveVillageExport) params.append("village", effectiveVillageExport);
      if (selectedFarmerMobile) params.append("contactNumber", selectedFarmerMobile);
      if (buyerFilter) params.append("buyerName", buyerFilter);
      if (paymentFilter && paymentFilter !== "all") params.append("paymentStatus", paymentFilter);
      
      const url = `/api/export/sales?${params.toString()}`;
      window.open(url, "_blank");
      
      toast({
        title: language === "hi" ? "डाउनलोड शुरू" : "Download Started",
        description: language === "hi" ? "बिक्री इतिहास" : "Sales History",
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Calculate summary totals from filtered data
  // Use paidAmount from sale, calculate due as remainder to ensure consistency
  // Fetch exits summary for the year filter
  const { data: exitsSummary } = useQuery<{ totalBagsExited: number }>({
    queryKey: [
      "/api/sales-history/exits-summary",
      yearFilter,
      selectedMonths.join(","),
      selectedDays.join(","),
      typeFilter,
      farmerFilter,
      selectedFarmerVillage,
      selectedFarmerMobile,
      villageFilter,
      paymentFilter,
      buyerFilter,
      coldBillFilter,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (yearFilter && yearFilter !== "all") params.append("year", yearFilter);
      if (selectedMonths.length) params.append("months", selectedMonths.join(","));
      if (selectedDays.length) params.append("days", selectedDays.join(","));
      if (typeFilter && typeFilter !== "all") params.append("bagType", typeFilter);
      if (farmerFilter) params.append("farmerName", farmerFilter);
      const effectiveVillage = villageFilter || selectedFarmerVillage;
      if (effectiveVillage) params.append("village", effectiveVillage);
      if (selectedFarmerMobile) params.append("contactNumber", selectedFarmerMobile);
      if (paymentFilter) params.append("paymentStatus", paymentFilter);
      if (buyerFilter) params.append("buyerName", buyerFilter);
      if (coldBillFilter.trim()) params.append("coldStorageBillNumber", coldBillFilter.trim());
      const qs = params.toString();
      const response = await authFetch(`/api/sales-history/exits-summary${qs ? `?${qs}` : ""}`);
      if (!response.ok) throw new Error("Failed to fetch exits summary");
      return response.json();
    },
  });

  const filteredSalesHistory = useMemo(() => {
    let list = salesHistory;
    if (selectedMonths.length || selectedDays.length) {
      list = list.filter((s) => dateMatchesFilter(s.soldAt, yearFilter || "all", selectedMonths, selectedDays));
    }
    if (typeFilter && typeFilter !== "all") {
      list = list.filter((s) => (s.bagType ?? "").toLowerCase() === typeFilter);
    }
    return list;
  }, [salesHistory, yearFilter, selectedMonths, selectedDays, typeFilter]);

  const paymentCutoff = useMemo(() => {
    if (!yearFilter || yearFilter === "all") return null;
    const year = Number(yearFilter);
    if (!Number.isInteger(year)) return null;
    if (selectedDays.length > 0 && selectedMonths.length === 0) return null;
    const month = selectedMonths.length > 0 ? Math.max(...selectedMonths) : 12;
    const day = selectedDays.length > 0 ? Math.max(...selectedDays) : new Date(year, month, 0).getDate();
    return new Date(year, month - 1, day, 23, 59, 59, 999);
  }, [yearFilter, selectedMonths, selectedDays]);

  const summary = filteredSalesHistory.reduce(
    (acc, sale) => {
      acc.totalBags += sale.quantitySold || 0;
      // Match the Nikasi Register's cash/account attribution, including its
      // fallback for older sales that have no separate payment counters.
      const cash = Number(sale.paidCash) || 0;
      const account = Number(sale.paidAccount) || 0;
      const counterTotal = cash + account;
      if (counterTotal > 0) {
        acc.cashPaid += cash;
        acc.accountPaid += account;
      } else if (sale.paymentMode === "cash") {
        acc.cashPaid += sale.paidAmount || 0;
      } else if (sale.paymentMode === "account") {
        acc.accountPaid += sale.paidAmount || 0;
      }

      // Task #378 — round-off is folded into paidCash/paidAccount by the FIFO
      // engine (see getSalesHistory), so pull it back out here and surface it
      // in the Discount card instead, matching the Nikasi Register.
      acc.discountAllocated += sale.discountAllocated || 0;
      acc.roundOffCash += sale.roundOffCash || 0;
      acc.roundOffAccount += sale.roundOffAccount || 0;
      const adjSelfDueShare = sale.adjSelfDue || 0;
      if (counterTotal > 0) {
        acc.cashSelfDueNet += adjSelfDueShare * (cash / counterTotal);
        acc.accountSelfDueNet += adjSelfDueShare * (account / counterTotal);
      } else if (sale.paymentMode === "cash") {
        acc.cashSelfDueNet += adjSelfDueShare;
      } else if (sale.paymentMode === "account") {
        acc.accountSelfDueNet += adjSelfDueShare;
      }

      if (paymentCutoff) {
        if (sale.payments && sale.payments.length > 0) {
          for (const payment of sale.payments) {
            if (new Date(payment.receivedAt).getTime() > paymentCutoff.getTime()) continue;
            const amt = payment.amount || 0;
            if (payment.receiptType === "cash") {
              acc.cashPaidByCutoff += amt;
            } else if (payment.receiptType === "account") {
              acc.accountPaidByCutoff += amt;
            } else if (sale.paymentMode === "cash") {
              acc.cashPaidByCutoff += amt;
            } else if (sale.paymentMode === "account") {
              acc.accountPaidByCutoff += amt;
            }
          }
        } else if (sale.paidAt && new Date(sale.paidAt).getTime() <= paymentCutoff.getTime()) {
          // Legacy/manual fully paid rows may pre-date receipt-application tracking.
          if (sale.paymentMode === "cash") {
            acc.cashPaidByCutoff += sale.paidAmount || 0;
          } else if (sale.paymentMode === "account") {
            acc.accountPaidByCutoff += sale.paidAmount || 0;
          } else if (counterTotal > 0) {
            acc.cashPaidByCutoff += cash;
            acc.accountPaidByCutoff += account;
          }
        }
      }
      const coldStorageDue = Math.max(0, (sale.coldStorageCharge || 0) - (sale.paidAmount || 0));
      acc.amountDue += coldStorageDue + (sale.extraDueToMerchant || 0);
      acc.totalColdStorageCharges += sale.coldStorageCharge || 0;
      acc.totalReceivableAdj += (sale.adjPyReceivables || 0) + (sale.adjAdvance || 0) + (sale.adjFreight || 0) + (sale.adjSelfDue || 0);
      acc.totalAdjSelfDue += sale.adjSelfDue || 0;
      return acc;
    },
    {
      totalBags: 0, amountDue: 0, totalColdStorageCharges: 0, totalReceivableAdj: 0, totalAdjSelfDue: 0,
      cashPaid: 0, accountPaid: 0, cashSelfDueNet: 0, accountSelfDueNet: 0, cashPaidByCutoff: 0, accountPaidByCutoff: 0,
      discountAllocated: 0, roundOffCash: 0, roundOffAccount: 0,
    }
  );

  // Task #378 — net the round-off slice out of Cash Paid / Account Paid (it's
  // folded into paidCash/paidAccount by the FIFO engine) and roll it into a
  // combined discount figure, matching the Nikasi Register's invariant
  // cash + account + discount + due == coldCharges.
  summary.cashPaid = Math.max(0, summary.cashPaid - summary.cashSelfDueNet - summary.roundOffCash);
  summary.accountPaid = Math.max(0, summary.accountPaid - summary.accountSelfDueNet - summary.roundOffAccount);
  summary.cashPaidByCutoff = paymentCutoff ? Math.max(0, summary.cashPaidByCutoff - summary.cashSelfDueNet) : 0;
  summary.accountPaidByCutoff = paymentCutoff ? Math.max(0, summary.accountPaidByCutoff - summary.accountSelfDueNet) : 0;
  summary.totalColdStorageCharges = Math.max(0, summary.totalColdStorageCharges - summary.totalAdjSelfDue);
  const roundOffReceived = summary.roundOffCash + summary.roundOffAccount;
  const discountReceived = summary.discountAllocated + roundOffReceived;

  const handleSalesPrint = () => {
    if (filteredSalesHistory.length === 0) return;

    const escape = (s: string | number | null | undefined): string =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const fmtINR = (n: number): string =>
      `\u20B9${(Math.round(n * 100) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

    const formatBagType = (bagType: string | null | undefined): string => {
      if (!bagType) return "—";
      const norm = bagType.toLowerCase();
      if (norm === "wafer") return t("wafer");
      if (norm === "seed") return t("seed");
      if (norm === "ration") return t("ration");
      return bagType;
    };
    const bagTypePrintStyle = (bagType: string | null | undefined): string => {
      const norm = (bagType || "").toLowerCase();
      if (norm === "wafer") return "background:rgba(59,130,246,0.10);color:#2563eb;";
      if (norm === "seed") return "background:rgba(16,185,129,0.10);color:#059669;";
      if (norm === "ration") return "background:rgba(249,115,22,0.10);color:#ea580c;";
      return "";
    };

    const monthShortNames = t("monthsShort").split(",");

    const filterParts: string[] = [];
    if (yearFilter && yearFilter !== "all") filterParts.push(`${t("year")}: ${yearFilter}`);
    if (selectedMonths.length) filterParts.push(`${t("monthsLabel")}: ${selectedMonths.map((m) => monthShortNames[m - 1]).join(", ")}`);
    if (selectedDays.length) filterParts.push(`${t("daysLabel")}: ${selectedDays.join(", ")}`);
    if (farmerFilter) filterParts.push(`${t("farmerName")}: ${farmerFilter}`);
    const effectiveVillage = villageFilter || selectedFarmerVillage;
    if (effectiveVillage) filterParts.push(`${t("village")}: ${effectiveVillage}`);
    if (buyerFilter) filterParts.push(`${t("buyerName")}: ${buyerFilter.toLowerCase() === "self" ? t("self") : buyerFilter}`);
    if (typeFilter && typeFilter !== "all") filterParts.push(`${t("bagType")}: ${formatBagType(typeFilter)}`);
    if (paymentFilter && paymentFilter !== "all") filterParts.push(`${t("paymentStatus")}: ${t(paymentFilter)}`);
    if (coldBillFilter.trim()) filterParts.push(`${t("coldBillNo")}: ${coldBillFilter.trim()}`);

    const bagsExitedTotal = exitsSummary?.totalBagsExited || 0;

    const summaryCardsHtml = `
      <div class="cards">
        <div class="card"><div class="lbl">${escape(t("totalBagsSold"))}</div><div class="val">${summary.totalBags.toLocaleString()}</div></div>
        <div class="card"><div class="lbl">${escape(t("cashPaid"))}</div><div class="val cash">${escape(fmtINR(summary.cashPaid))}<div class="subval">${paymentCutoff ? escape(fmtINR(summary.cashPaidByCutoff)) : "—"}</div></div></div>
        <div class="card"><div class="lbl">${escape(t("accountPaid"))}</div><div class="val acct">${escape(fmtINR(summary.accountPaid))}<div class="subval">${paymentCutoff ? escape(fmtINR(summary.accountPaidByCutoff)) : "—"}</div></div></div>
        <div class="card"><div class="lbl">${escape(t("amountDue"))}</div><div class="val due">${escape(fmtINR(summary.amountDue))}</div></div>
        <div class="card"><div class="lbl">${escape(t("sold"))}/${escape(t("exit"))}</div><div class="val">${summary.totalBags}/${bagsExitedTotal}</div></div>
        <div class="card"><div class="lbl">${escape(t("coldStorageCharges"))}</div><div class="val acct">${escape(fmtINR(summary.totalColdStorageCharges))}</div></div>
        <div class="card"><div class="lbl">${escape(t("receivableAdjustments"))}</div><div class="val">${escape(fmtINR(summary.totalReceivableAdj))}</div></div>
      </div>
    `;

    const renderBuyerCell = (sale: SalesHistoryWithLastPayment): string => {
      const baseBuyer = Number(sale.isSelfSale) === 1 ? t("self") : (sale.buyerName || "-");
      const transferName = sale.transferToBuyerName?.trim();
      if (transferName && Number(sale.isTransferReversed) !== 1) {
        return `<span style="text-decoration:line-through;color:#71717a;">${escape(baseBuyer)}</span> &rarr; <span style="color:#7c3aed;font-weight:600;">${escape(transferName)}</span>`;
      }
      if (transferName && Number(sale.isTransferReversed) === 1) {
        return `${escape(baseBuyer)} <span style="text-decoration:line-through;color:#a1a1aa;font-size:10px;">${escape(transferName)}</span>`;
      }
      return escape(baseBuyer);
    };

    // Task #365 — village names wrap after the first word instead of running
    // on one line, while the column keeps its original width. For a
    // two-word village this puts the second word on its own line; for
    // longer names everything but the last word stays on line one and the
    // last word wraps down.
    const renderVillageCell = (village: string): string => {
      const words = (village || "").trim().split(/\s+/).filter(Boolean);
      if (words.length < 2) return escape(village || "");
      const firstLine = words.slice(0, -1).join(" ");
      const secondLine = words[words.length - 1];
      return `${escape(firstLine)}<br/>${escape(secondLine)}`;
    };

    // Task #365 — Payment Mode column: show each payment mode actually used
    // (account, then cash) with its amount, one per line; skip zero amounts.
    const renderPaymentModeCell = (sale: SalesHistoryWithLastPayment): string => {
      const account = Number(sale.paidAccount) || 0;
      const cash = Number(sale.paidCash) || 0;
      const lines: string[] = [];
      if (account > 0) lines.push(`Account - ${fmtINR(account)}`);
      if (cash > 0) lines.push(`${t("cash")} - ${fmtINR(cash)}`);
      if (lines.length === 0) return "—";
      return lines.map((l) => escape(l)).join("<br/>");
    };

    const rowsHtml = filteredSalesHistory
      .map((sale) => {
        const remainingAfter =
          sale.remainingSizeAtSale != null ? sale.remainingSizeAtSale - sale.quantitySold : null;
        return `
        <tr>
          <td class="nowrap">${escape(format(new Date(sale.soldAt), "dd MMM yyyy"))}</td>
          <td class="wrap">${escape(sale.farmerName)}</td>
          <td class="nowrap">${renderVillageCell(sale.village)}</td>
          <td class="nowrap">${escape(sale.lotNo)}</td>
          <td class="nowrap">${escape(sale.marka || "—")}</td>
          <td class="nowrap">${escape(sale.coldStorageBillNumber != null ? String(sale.coldStorageBillNumber) : "—")}</td>
          <td class="nowrap r">${escape(sale.originalLotSize)}</td>
          <td class="nowrap r">${remainingAfter != null ? escape(remainingAfter) : "—"}</td>
          <td class="nowrap">${sale.bagType ? `<span class="bag-badge" style="${bagTypePrintStyle(sale.bagType)}">${escape(formatBagType(sale.bagType))}</span>` : "—"}</td>
          <td class="nowrap r">${escape(sale.quantitySold)}</td>
          <td class="nowrap r">${escape(fmtINR(calculateTotalColdCharges(sale)))}</td>
          <td class="wrap">${renderBuyerCell(sale)}</td>
          <td class="nowrap">${escape(t(sale.paymentStatus))}</td>
          <td class="nowrap">${renderPaymentModeCell(sale)}</td>
        </tr>
      `;
      })
      .join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escape(t("salesHistory"))}</title>
<style>
  @page{size:A4 landscape;margin:8mm;}
  *{box-sizing:border-box;}
  body{font-family:Arial,Helvetica,"Liberation Sans","DejaVu Sans",sans-serif;margin:16px;color:#111;}
  h1{margin:0 0 4px 0;font-size:18px;}
  .meta{font-size:11px;color:#555;margin-bottom:12px;}
  .cards{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:14px;}
  .card{border:1px solid #d4d4d8;border-radius:6px;padding:8px 10px;min-height:44px;}
  .lbl{font-size:11px;line-height:1.25;color:#555;word-break:break-word;overflow-wrap:anywhere;}
   .val{font-size:16px;line-height:1.3;font-weight:700;margin-top:2px;white-space:nowrap;}
   .subval{font-size:9px;line-height:1.25;font-weight:600;margin-top:2px;white-space:normal;}
  .val.cash{color:#047857;} .val.acct{color:#4338ca;} .val.disc{color:#7c3aed;} .val.due{color:#be123c;}
  table{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed;}
  th,td{border:1px solid #d4d4d8;padding:4px 6px;text-align:left;vertical-align:top;}
  th{background:#f4f4f5;font-weight:700;white-space:normal;word-break:break-word;overflow-wrap:anywhere;line-height:1.2;}
  td.r,th.r{text-align:right;}
  td.cash{color:#047857;} td.due{color:#be123c;}
  .nowrap{white-space:nowrap;}
  .wrap{word-break:break-word;overflow-wrap:anywhere;white-space:normal;}
  .bag-badge{display:inline-block;padding:1px 6px;border:1px solid #d4d4d8;border-radius:9999px;font-size:10px;font-weight:600;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  col.c-date{width:6.5%;} col.c-farmer{width:13.3%;} col.c-village{width:8%;}
  col.c-lot{width:4.5%;} col.c-marka{width:5%;} col.c-cbill{width:5%;}
  col.c-obags{width:5%;} col.c-rbags{width:5%;} col.c-btype{width:6%;}
  col.c-qty{width:5%;} col.c-charges{width:8%;} col.c-buyer{width:11.2%;}
  col.c-status{width:8%;} col.c-paymode{width:9.5%;}
  @media print{body{margin:8mm;} .cards{grid-template-columns:repeat(6,1fr);}}
</style></head><body>
  <h1>${escape(t("salesHistory"))}</h1>
  <div class="meta">${filterParts.map((p) => escape(p)).join(" &nbsp;|&nbsp; ")}</div>
  ${summaryCardsHtml}
  <table>
    <colgroup>
      <col class="c-date"/>
      <col class="c-farmer"/>
      <col class="c-village"/>
      <col class="c-lot"/>
      <col class="c-marka"/>
      <col class="c-cbill"/>
      <col class="c-obags"/>
      <col class="c-rbags"/>
      <col class="c-btype"/>
      <col class="c-qty"/>
      <col class="c-charges"/>
      <col class="c-buyer"/>
      <col class="c-status"/>
      <col class="c-paymode"/>
    </colgroup>
    <thead><tr>
      <th>${escape(t("saleDate"))}</th>
      <th>${escape(t("farmerName"))}</th>
      <th>${escape(t("village"))}</th>
      <th>${escape(t("lotNo"))}</th>
      <th>${escape(t("marka"))}</th>
      <th>${escape(t("coldBillNo"))}</th>
      <th class="r">${escape(t("originalBags"))}</th>
      <th class="r">${escape(t("remainingBagsAfterSale"))}</th>
      <th>${escape(t("bagType"))}</th>
      <th class="r">${escape(t("quantitySold"))}</th>
      <th class="r">${escape(t("totalColdStorageCharges"))}</th>
      <th>${escape(t("buyerName"))}</th>
      <th>${escape(t("paymentStatus"))}</th>
      <th>${escape(t("paymentMode"))}</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <script>window.onload=function(){window.print();}<\/script>
</body></html>`;

    const w = window.open("", "_blank");
    if (!w) {
      toast({
        title: t("error"),
        description: "Pop-up blocked. Please allow pop-ups for this site to print.",
        variant: "destructive",
      });
      return;
    }
    w.document.write(html);
    w.document.close();
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        <h1 className="text-2xl font-bold" data-testid="text-page-title">
          {activeTab === "tracker" ? t("farmerPaymentTracker") : activeTab === "exits" ? t("exitRegister") : t("salesHistory")}
        </h1>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "sales" | "tracker" | "exits")}>
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger
              value="exits"
              data-testid="tab-exits"
              className="text-xs sm:text-sm data-[state=active]:bg-chart-1 data-[state=active]:text-white data-[state=active]:hover:bg-chart-1/90"
            >
              <LogOut className="h-4 w-4 mr-1 hidden sm:inline-block" />{t("exitRegister")}
            </TabsTrigger>
            <TabsTrigger
              value="sales"
              data-testid="tab-sales"
              className="text-xs sm:text-sm data-[state=active]:bg-chart-1 data-[state=active]:text-white data-[state=active]:hover:bg-chart-1/90"
            >
              {t("salesHistory")}
            </TabsTrigger>
            <TabsTrigger
              value="tracker"
              data-testid="tab-tracker"
              className="text-xs sm:text-sm data-[state=active]:bg-chart-1 data-[state=active]:text-white data-[state=active]:hover:bg-chart-1/90"
            >
              <HandCoins className="h-4 w-4 mr-1 hidden sm:inline-block" />{t("farmerPaymentTracker")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {activeTab === "tracker" ? (
        <FarmerPaymentTracker />
      ) : activeTab === "exits" ? (
        <ExitRegister />
      ) : (
      <>
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              {t("filters")}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={handleSalesPrint}
                disabled={filteredSalesHistory.length === 0}
                data-testid="button-print-sales"
                aria-label={t("printPdf")}
                title={t("printPdf")}
              >
                <Printer className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleExportSales}
                disabled={isExporting}
                data-testid="button-export-sales"
              >
                {isExporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-[22rem]">
              <DateFilterBar
                year={yearFilter || "all"}
                onYearChange={(y) => setYearFilter(y === "all" ? "" : y)}
                selectedMonths={selectedMonths}
                onMonthsChange={setSelectedMonths}
                selectedDays={selectedDays}
                onDaysChange={setSelectedDays}
                availableYears={years}
              />
            </div>

            <div className="w-full sm:w-44 space-y-2">
              <label className="text-sm text-muted-foreground">{t("filterByFarmer")}</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <Input
                  value={farmerFilter}
                  onChange={(e) => {
                    setFarmerFilter(capitalizeFirstLetter(e.target.value));
                    setSelectedFarmerVillage("");
                    setSelectedFarmerMobile("");
                    setShowFarmerSuggestions(true);
                  }}
                  onFocus={() => { setShowFarmerSuggestions(true); farmerNav.resetActive(); }}
                  onBlur={() => setTimeout(() => { setShowFarmerSuggestions(false); farmerNav.resetActive(); }, 200)}
                  onKeyDown={(e) => farmerNav.handleKeyDown(e, getFarmerSuggestions.length, (i) => { selectFarmerSuggestion(getFarmerSuggestions[i]); setShowFarmerSuggestions(false); }, () => setShowFarmerSuggestions(false))}
                  placeholder={t("farmerName")}
                  className="pl-10"
                  autoComplete="off"
                  data-testid="input-farmer-filter"
                />
                {showFarmerSuggestions && getFarmerSuggestions.length > 0 && farmerFilter && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                    {getFarmerSuggestions.map((farmer, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={`w-full px-3 py-2 text-left hover-elevate text-sm flex flex-col ${farmerNav.activeIndex === idx ? "bg-accent" : ""}`}
                        onClick={() => selectFarmerSuggestion(farmer)}
                        data-testid={`suggestion-farmer-${idx}`}
                      >
                        <span className="font-medium">{farmer.farmerName}</span>
                        <span className="text-xs text-muted-foreground">{farmer.contactNumber} • {farmer.village}</span>
                      </button>
                    ))}
                  </div>
                )}
                {selectedFarmerVillage && selectedFarmerMobile && (
                  <div className="flex items-center gap-1 mt-1">
                    <Badge variant="secondary" className="text-xs">
                      {selectedFarmerVillage} • {selectedFarmerMobile}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setFarmerFilter("");
                        setSelectedFarmerVillage("");
                        setSelectedFarmerMobile("");
                      }}
                      data-testid="button-clear-specific-farmer-sales"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div className="w-full sm:w-36 space-y-2">
              <label className="text-sm text-muted-foreground">{t("village")}</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <Input
                  value={villageFilter}
                  onChange={(e) => {
                    setVillageFilter(capitalizeFirstLetter(e.target.value));
                    setShowVillageSuggestions(true);
                  }}
                  onFocus={() => { setShowVillageSuggestions(true); villageNav.resetActive(); }}
                  onBlur={() => setTimeout(() => { setShowVillageSuggestions(false); villageNav.resetActive(); }, 200)}
                  onKeyDown={(e) => villageNav.handleKeyDown(e, getVillageSuggestions.length, (i) => { setVillageFilter(getVillageSuggestions[i]); setShowVillageSuggestions(false); }, () => setShowVillageSuggestions(false))}
                  placeholder={t("village")}
                  className="pl-10"
                  autoComplete="off"
                  data-testid="input-village-filter"
                />
                {showVillageSuggestions && getVillageSuggestions.length > 0 && villageFilter && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                    {getVillageSuggestions.map((v, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={`w-full px-3 py-2 text-left hover-elevate text-sm ${villageNav.activeIndex === idx ? "bg-accent" : ""}`}
                        onClick={() => { setVillageFilter(v); setShowVillageSuggestions(false); }}
                        data-testid={`suggestion-village-${idx}`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="w-full sm:w-44 space-y-2">
              <label className="text-sm text-muted-foreground">{t("filterByBuyer")}</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <Input
                  value={buyerFilter}
                  onChange={(e) => {
                    setBuyerFilter(capitalizeFirstLetter(e.target.value));
                    setShowBuyerSuggestions(true);
                  }}
                  onFocus={() => { setShowBuyerSuggestions(true); buyerNav.resetActive(); }}
                  onBlur={() => setTimeout(() => { setShowBuyerSuggestions(false); buyerNav.resetActive(); }, 200)}
                  onKeyDown={(e) => buyerNav.handleKeyDown(e, getBuyerSuggestions.length, (i) => { selectBuyerSuggestion(getBuyerSuggestions[i]); setShowBuyerSuggestions(false); }, () => setShowBuyerSuggestions(false))}
                  placeholder={t("buyerName")}
                  className="pl-10"
                  autoComplete="off"
                  data-testid="input-buyer-filter"
                />
                {showBuyerSuggestions && getBuyerSuggestions.length > 0 && buyerFilter && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                    {getBuyerSuggestions.map((buyer, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={`w-full px-3 py-2 text-left hover-elevate text-sm ${buyerNav.activeIndex === idx ? "bg-accent" : ""}`}
                        onClick={() => selectBuyerSuggestion(buyer)}
                        data-testid={`suggestion-buyer-${idx}`}
                      >
                        {buyer.buyerName === "Self" ? t("self") : buyer.buyerName}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="w-full sm:w-28 space-y-2">
              <label className="text-sm text-muted-foreground">{t("filterByType")}</label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger data-testid="select-type-filter">
                  <SelectValue placeholder={t("all")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("all")}</SelectItem>
                  <SelectItem value="wafer">{t("wafer")}</SelectItem>
                  <SelectItem value="seed">{t("seed")}</SelectItem>
                  <SelectItem value="ration">{t("ration")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="w-full sm:w-32 space-y-2">
              <label className="text-sm text-muted-foreground">{t("paymentStatus")}</label>
              <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                <SelectTrigger data-testid="select-payment-filter">
                  <SelectValue placeholder={t("all")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("all")}</SelectItem>
                  <SelectItem value="paid">{t("paid")}</SelectItem>
                  <SelectItem value="partial">{t("partial")}</SelectItem>
                  <SelectItem value="due">{t("due")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="w-full sm:w-28 space-y-2">
              <label className="text-sm text-muted-foreground">{t("coldBillNo")}</label>
              <Input
                type="text"
                inputMode="numeric"
                value={coldBillFilter}
                onChange={(e) => setColdBillFilter(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder={t("coldBillNo")}
                data-testid="input-cold-bill-filter"
              />
            </div>

            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
                <X className="h-4 w-4 mr-1" />
                {t("clearFilters")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary Section */}
      {!historyLoading && filteredSalesHistory.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
          <Card data-testid="card-summary-bags">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                  <Package className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-tight text-muted-foreground">{t("totalBagsSold")}</p>
                  <p className="text-xs font-bold" data-testid="text-total-bags">{summary.totalBags.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-summary-cold-charges">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-sky-500/10 shrink-0">
                  <Warehouse className="h-5 w-5 text-sky-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-tight text-muted-foreground">{t("coldStorageCharges")}</p>
                  <p className="text-xs font-bold text-sky-600 dark:text-sky-400" data-testid="text-cold-charges">
                    <Currency amount={summary.totalColdStorageCharges} />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-summary-cash-paid">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 shrink-0">
                  <Banknote className="h-5 w-5 text-emerald-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-tight text-muted-foreground">{t("cashPaid")}</p>
                  <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400" data-testid="text-cash-paid">
                    <Currency amount={summary.cashPaid} />
                  </p>
                  <p className="text-[10px] leading-tight font-medium text-emerald-700/80 dark:text-emerald-300/80" data-testid="text-cash-paid-by-date">
                    {paymentCutoff ? <Currency amount={summary.cashPaidByCutoff} /> : "—"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-summary-account-paid">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-indigo-500/10 shrink-0">
                  <CreditCard className="h-5 w-5 text-indigo-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-tight text-muted-foreground">{t("accountPaid")}</p>
                  <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400" data-testid="text-account-paid">
                    <Currency amount={summary.accountPaid} />
                  </p>
                  <p className="text-[10px] leading-tight font-medium text-indigo-700/80 dark:text-indigo-300/80" data-testid="text-account-paid-by-date">
                    {paymentCutoff ? <Currency amount={summary.accountPaidByCutoff} /> : "—"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-summary-discount">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-violet-500/10 shrink-0">
                  <BadgePercent className="h-5 w-5 text-violet-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-tight text-muted-foreground">{t("discountReceived")}</p>
                  <p className="text-xs font-bold text-violet-600 dark:text-violet-400" data-testid="text-discount">
                    <Currency amount={discountReceived} />
                  </p>
                  {roundOffReceived > 0 && (
                    <p className="text-[10px] leading-tight text-muted-foreground" data-testid="text-discount-roundoff">
                      {t("roundOffShort")}: ₹{formatCurrency(roundOffReceived)}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-summary-due">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10 shrink-0">
                  <Clock className="h-5 w-5 text-amber-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-tight text-muted-foreground">{t("amountDue")}</p>
                  <p className="text-xs font-bold text-amber-600 dark:text-amber-400" data-testid="text-amount-due">
                    <Currency amount={summary.amountDue} />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-summary-bags-exit">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-violet-500/10 shrink-0">
                  <LogOut className="h-5 w-5 text-violet-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-tight text-muted-foreground">{t("sold")}/{t("exit")}</p>
                  <p className="text-xs font-bold" data-testid="text-bags-sold-exited">
                    {summary.totalBags}/{exitsSummary?.totalBagsExited || 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-summary-receivable-adj">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10 shrink-0">
                  <FileCheck className="h-5 w-5 text-orange-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-tight text-muted-foreground">{t("receivableAdjustments")}</p>
                  <p className="text-xs font-bold text-orange-600 dark:text-orange-400" data-testid="text-receivable-adj">
                    <Currency amount={summary.totalReceivableAdj} />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {historyLoading ? (
            <div className="p-6 space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filteredSalesHistory.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground" data-testid="text-no-results">
              {t("noSalesHistory")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="text-xs font-semibold whitespace-nowrap">{t("saleDate")}</TableHead>
                    <TableHead className="text-xs font-semibold">{t("farmerName")}</TableHead>
                    <TableHead className="text-xs font-semibold whitespace-nowrap">{t("village")}</TableHead>
                    <TableHead className="text-xs font-semibold whitespace-nowrap">{t("lotNo")}</TableHead>
                    <TableHead className="text-xs font-semibold whitespace-nowrap">{t("marka")}</TableHead>
                    <TableHead className="text-xs font-semibold whitespace-nowrap">{t("coldBillNo")}</TableHead>
                    <TableHead className="text-xs font-semibold text-right whitespace-nowrap">{t("originalBags")}</TableHead>
                    <TableHead className="text-xs font-semibold text-right whitespace-nowrap">{t("remainingBagsAfterSale")}</TableHead>
                    <TableHead className="text-xs font-semibold whitespace-nowrap">{t("bagType")}</TableHead>
                    <TableHead className="text-xs font-semibold text-right whitespace-nowrap">{t("quantitySold")}</TableHead>
                    <TableHead className="text-xs font-semibold text-right whitespace-nowrap">{t("totalColdStorageCharges")}</TableHead>
                    <TableHead className="text-xs font-semibold whitespace-nowrap">{t("buyerName")}</TableHead>
                    <TableHead className="text-xs font-semibold text-right whitespace-nowrap">{t("pricePerKg")}</TableHead>
                    <TableHead className="text-xs font-semibold whitespace-nowrap">{t("paymentStatus")}</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSalesHistory.map((sale) => (
                    <TableRow key={sale.id} data-testid={`row-sale-${sale.id}`}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {format(new Date(sale.soldAt), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell className="text-xs font-medium min-w-[120px]">{sale.farmerName}</TableCell>
                      <TableCell className="text-xs">{sale.village}</TableCell>
                      <TableCell>{sale.lotNo}</TableCell>
                      <TableCell className="text-xs" data-testid={`cell-marka-${sale.id}`}>{sale.marka || "—"}</TableCell>
                      <TableCell className="text-xs" data-testid={`cell-cold-bill-${sale.id}`}>{sale.coldStorageBillNumber != null ? String(sale.coldStorageBillNumber) : "—"}</TableCell>
                      <TableCell className="text-right">{sale.originalLotSize}</TableCell>
                      <TableCell className="text-right" data-testid={`cell-remaining-after-sale-${sale.id}`}>
                        {sale.remainingSizeAtSale != null
                          ? sale.remainingSizeAtSale - sale.quantitySold
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={sale.bagType === "wafer" ? "bg-chart-1/10 text-chart-1" : "bg-chart-2/10 text-chart-2"}>
                          {t(sale.bagType)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{sale.quantitySold}</TableCell>
                      <TableCell className="text-right font-medium">
                        <div className="flex items-center justify-end gap-1">
                          <Currency amount={calculateTotalColdCharges(sale)} />
                          {sale.transferToBuyerName && sale.transferToBuyerName.trim() && Number(sale.isTransferReversed) !== 1 && (
                            <ArrowLeftRight className="h-4 w-4 text-purple-600" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {sale.transferToBuyerName && sale.transferToBuyerName.trim() && Number(sale.isTransferReversed) !== 1 ? (
                          <div className="flex flex-col">
                            <span className="line-through text-muted-foreground">{Number(sale.isSelfSale) === 1 ? t("self") : (sale.buyerName || "-")}</span>
                            <span className="text-purple-600 font-medium">{sale.transferToBuyerName}</span>
                          </div>
                        ) : sale.transferToBuyerName && sale.transferToBuyerName.trim() && Number(sale.isTransferReversed) === 1 ? (
                          <div className="flex flex-col">
                            <span>{Number(sale.isSelfSale) === 1 ? t("self") : (sale.buyerName || "-")}</span>
                            <span className="line-through text-gray-400 text-xs">{sale.transferToBuyerName}</span>
                          </div>
                        ) : (
                          Number(sale.isSelfSale) === 1 ? t("self") : (sale.buyerName || "-")
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {sale.pricePerKg ? <Currency amount={sale.pricePerKg} /> : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={sale.paymentStatus === "paid" ? "default" : sale.paymentStatus === "partial" ? "secondary" : "destructive"}
                          className={sale.paymentStatus === "paid" ? "bg-green-600" : ""}
                        >
                          {t(sale.paymentStatus)}
                        </Badge>
                        {sale.paymentStatus === "partial" && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {t("paid")}: <Currency amount={sale.paidAmount || 0} />
                          </div>
                        )}
                        {sale.paidAt && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {t("paidOn")}: {format(new Date(sale.paidAt), "dd/MM/yy")}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPrintingSale(sale);
                            setPrintDialogOpen(true);
                          }}
                          className="h-7 w-7 bg-yellow-200 hover:bg-yellow-300"
                          aria-label={t("print")}
                          title={t("print")}
                          data-testid={`button-print-sale-${sale.id}`}
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {filteredSalesHistory.length > 0 && (
        <div className="flex justify-between items-center text-sm text-muted-foreground">
          <span>
            {filteredSalesHistory.length} {filteredSalesHistory.length === 1 ? "sale" : "sales"} found
          </span>
          <div className="flex gap-4">
            <span className="text-green-600">
              {t("paid")}: {filteredSalesHistory.filter(s => s.paymentStatus === "paid").length}
            </span>
            <span className="text-blue-600">
              {t("partial")}: {filteredSalesHistory.filter(s => s.paymentStatus === "partial").length}
            </span>
            <span className="text-amber-600">
              {t("due")}: {filteredSalesHistory.filter(s => s.paymentStatus === "due").length}
            </span>
          </div>
        </div>
      )}

      {printingSale && (
        <PrintBillDialog
          sale={printingSale}
          open={printDialogOpen}
          onOpenChange={(open) => {
            setPrintDialogOpen(open);
            if (!open) setPrintingSale(null);
          }}
        />
      )}

      </>
      )}
    </div>
  );
}

type FarmerLookupRecord = {
  farmerName: string;
  village: string;
  contactNumber: string;
  farmerLedgerId: string;
};

function calculateNetPayableToFarmer(sale: SalesHistory): number {
  const totalIncome = (sale.netWeight || 0) * (sale.pricePerKg || 0);

  const chargeBasis = sale.chargeBasis || "actual";
  const bagsToUse = chargeBasis === "totalRemaining"
    ? (sale.remainingSizeAtSale || sale.quantitySold)
    : sale.quantitySold;

  const chargeUnit = sale.chargeUnitAtSale || "bag";
  const isQuintalBased = chargeUnit === "quintal";
  const quintalValueNum = isQuintalBased && sale.initialNetWeightKg && sale.originalLotSize && sale.originalLotSize > 0
    ? (sale.initialNetWeightKg * bagsToUse) / (sale.originalLotSize * 100)
    : 0;

  const hasSeparateCharges = sale.coldCharge != null && sale.hammali != null;
  let coldChargeAmount = 0;
  let hammaliAmount = 0;

  if (sale.baseChargeAmountAtSale === 0) {
    coldChargeAmount = 0;
    hammaliAmount = 0;
  } else if (sale.baseHammaliAmount != null) {
    hammaliAmount = sale.baseHammaliAmount;
    coldChargeAmount = (sale.baseChargeAmountAtSale || 0) - hammaliAmount;
  } else if (hasSeparateCharges && sale.coldCharge != null && sale.hammali != null) {
    if (isQuintalBased) {
      coldChargeAmount = (sale.coldCharge || 0) * quintalValueNum;
      hammaliAmount = (sale.hammali || 0) * bagsToUse;
    } else {
      coldChargeAmount = (sale.coldCharge || 0) * bagsToUse;
      hammaliAmount = (sale.hammali || 0) * bagsToUse;
    }
  } else {
    const extrasInner = (sale.kataCharges || 0) + (sale.extraHammali || 0) + (sale.gradingCharges || 0);
    coldChargeAmount = (sale.coldStorageCharge || 0) - extrasInner - (sale.adjReceivableSelfDueAmount || 0);
    hammaliAmount = 0;
  }

  const extras = (sale.kataCharges || 0) + (sale.extraHammali || 0) + (sale.gradingCharges || 0);
  const adjAmount = sale.adjReceivableSelfDueAmount || 0;
  const discountAllocated = sale.discountAllocated || 0;
  const totalCharges = coldChargeAmount + hammaliAmount + extras + adjAmount;
  const netColdBill = Math.max(0, totalCharges - discountAllocated);

  return totalIncome - netColdBill;
}

function FarmerPaymentTracker() {
  const { t } = useI18n();
  const { toast } = useToast();
  const trackerFarmerNav = useDropdownNavigation();

  const [trackerYearFilter, setTrackerYearFilter] = useState<string>(new Date().getFullYear().toString());
  const [trackerFarmerFilter, setTrackerFarmerFilter] = useState("");
  const [trackerFarmerLedgerId, setTrackerFarmerLedgerId] = useState("");
  const [showTrackerFarmerSuggestions, setShowTrackerFarmerSuggestions] = useState(false);

  const { data: years = [] } = useQuery<number[]>({
    queryKey: ["/api/sales-history/years"],
  });

  const { data: farmerRecords } = useQuery<FarmerLookupRecord[]>({
    queryKey: ["/api/farmers/lookup"],
    staleTime: 5 * 60 * 1000,
  });

  const buildTrackerQuery = () => {
    const params = new URLSearchParams();
    if (trackerYearFilter && trackerYearFilter !== "all") params.append("year", trackerYearFilter);
    return params.toString();
  };

  const { data: allSalesHistory = [], isLoading } = useQuery<SalesHistory[]>({
    queryKey: ["/api/sales-history", trackerYearFilter],
    queryFn: async () => {
      const queryString = buildTrackerQuery();
      const response = await authFetch(`/api/sales-history${queryString ? `?${queryString}` : ""}`);
      if (!response.ok) throw new Error("Failed to fetch sales history");
      return response.json();
    },
  });

  const facilitatedSales = useMemo(() => {
    let filtered = allSalesHistory.filter(
      (s) => Number(s.isSelfSale) === 0 && (s.pricePerKg || 0) > 0 && (s.netWeight || 0) > 0
    );
    if (trackerFarmerLedgerId) {
      filtered = filtered.filter((s) => s.farmerLedgerId === trackerFarmerLedgerId);
    }
    return filtered.slice().sort((a, b) => {
      const soldDiff = new Date(b.soldAt).getTime() - new Date(a.soldAt).getTime();
      if (soldDiff !== 0) return soldDiff;
      const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      const createdDiff = bCreated - aCreated;
      if (createdDiff !== 0) return createdDiff;
      const aBill = a.coldStorageBillNumber ?? -1;
      const bBill = b.coldStorageBillNumber ?? -1;
      if (aBill !== bBill) return bBill - aBill;
      const aLot = parseInt(a.lotNo, 10);
      const bLot = parseInt(b.lotNo, 10);
      const aIsNum = !Number.isNaN(aLot);
      const bIsNum = !Number.isNaN(bLot);
      if (aIsNum && bIsNum && aLot !== bLot) return aLot - bLot;
      if (aIsNum && !bIsNum) return -1;
      if (bIsNum && !aIsNum) return 1;
      if (!aIsNum && !bIsNum) {
        const lotCmp = a.lotNo.localeCompare(b.lotNo);
        if (lotCmp !== 0) return lotCmp;
      }
      const aRemaining = a.remainingSizeAtSale != null
        ? a.remainingSizeAtSale - (a.quantitySold ?? 0)
        : Number.POSITIVE_INFINITY;
      const bRemaining = b.remainingSizeAtSale != null
        ? b.remainingSizeAtSale - (b.quantitySold ?? 0)
        : Number.POSITIVE_INFINITY;
      return aRemaining - bRemaining;
    });
  }, [allSalesHistory, trackerFarmerLedgerId]);

  const trackerFarmerSuggestions = useMemo(() => {
    if (!farmerRecords || !trackerFarmerFilter.trim()) return [];
    const query = trackerFarmerFilter.toLowerCase().trim();
    return farmerRecords
      .filter((f) => f.farmerName.toLowerCase().includes(query) || f.contactNumber.includes(query) || f.village.toLowerCase().includes(query))
      .slice(0, 8);
  }, [farmerRecords, trackerFarmerFilter]);

  const selectTrackerFarmer = (farmer: FarmerLookupRecord) => {
    setTrackerFarmerFilter(farmer.farmerName);
    setTrackerFarmerLedgerId(farmer.farmerLedgerId);
    setShowTrackerFarmerSuggestions(false);
  };

  const farmerPaymentMutation = useMutation({
    mutationFn: async ({ saleId, status, paidAt }: { saleId: string; status: string; paidAt: string | null }) => {
      await apiRequest("PATCH", `/api/sales-history/${saleId}/farmer-payment`, {
        farmerPaymentStatus: status,
        farmerPaidAt: paidAt,
      });
    },
    onSuccess: () => {
      invalidateSaleSideEffects(queryClient);
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
    },
    onError: (error: Error) => {
      toast({ title: t("error"), description: error.message, variant: "destructive" });
    },
  });

  const handleTogglePaid = (sale: SalesHistory) => {
    const newStatus = sale.farmerPaymentStatus === "paid" ? "unpaid" : "paid";
    const paidAt = newStatus === "paid" ? format(new Date(), "yyyy-MM-dd") : null;
    farmerPaymentMutation.mutate({ saleId: sale.id, status: newStatus, paidAt });
  };

  const handleDateChange = (sale: SalesHistory, date: string) => {
    farmerPaymentMutation.mutate({ saleId: sale.id, status: "paid", paidAt: date });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            {t("filters")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">{t("filterByYear")}</label>
              <Select value={trackerYearFilter} onValueChange={setTrackerYearFilter}>
                <SelectTrigger data-testid="select-tracker-year">
                  <SelectValue placeholder={t("allYears")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allYears")}</SelectItem>
                  {years.map((year) => (
                    <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">{t("filterByFarmer")}</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <Input
                  value={trackerFarmerFilter}
                  onChange={(e) => {
                    setTrackerFarmerFilter(capitalizeFirstLetter(e.target.value));
                    setTrackerFarmerLedgerId("");
                    setShowTrackerFarmerSuggestions(true);
                  }}
                  onFocus={() => { setShowTrackerFarmerSuggestions(true); trackerFarmerNav.resetActive(); }}
                  onBlur={() => setTimeout(() => { setShowTrackerFarmerSuggestions(false); trackerFarmerNav.resetActive(); }, 200)}
                  onKeyDown={(e) => trackerFarmerNav.handleKeyDown(e, trackerFarmerSuggestions.length, (i) => { selectTrackerFarmer(trackerFarmerSuggestions[i]); setShowTrackerFarmerSuggestions(false); }, () => setShowTrackerFarmerSuggestions(false))}
                  placeholder={t("farmerName")}
                  className="pl-10"
                  autoComplete="off"
                  data-testid="input-tracker-farmer-filter"
                />
                {showTrackerFarmerSuggestions && trackerFarmerSuggestions.length > 0 && trackerFarmerFilter && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                    {trackerFarmerSuggestions.map((farmer, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={`w-full px-3 py-2 text-left hover-elevate text-sm flex flex-col ${trackerFarmerNav.activeIndex === idx ? "bg-accent" : ""}`}
                        onClick={() => selectTrackerFarmer(farmer)}
                        data-testid={`suggestion-tracker-farmer-${idx}`}
                      >
                        <span className="font-medium">{farmer.farmerName}</span>
                        <span className="text-xs text-muted-foreground">{farmer.contactNumber} • {farmer.village}</span>
                      </button>
                    ))}
                  </div>
                )}
                {trackerFarmerLedgerId && (
                  <div className="flex items-center gap-1 mt-1">
                    <Badge variant="secondary" className="text-xs">{trackerFarmerFilter}</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setTrackerFarmerFilter("");
                        setTrackerFarmerLedgerId("");
                      }}
                      data-testid="button-clear-tracker-farmer"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-end">
              {(trackerYearFilter || trackerFarmerLedgerId) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setTrackerYearFilter(new Date().getFullYear().toString());
                    setTrackerFarmerFilter("");
                    setTrackerFarmerLedgerId("");
                  }}
                  className="w-full"
                  data-testid="button-clear-tracker-filters"
                >
                  <X className="h-4 w-4 mr-2" />
                  {t("clearFilters")}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : facilitatedSales.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground" data-testid="text-no-tracker-results">
              {t("noFacilitatedSales")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="text-xs font-semibold whitespace-nowrap">{t("saleDate")}</TableHead>
                    <TableHead className="text-xs font-semibold">{t("farmerName")}</TableHead>
                    <TableHead className="text-xs font-semibold">{t("village")}</TableHead>
                    <TableHead className="text-xs font-semibold whitespace-nowrap">{t("lotNo")}</TableHead>
                    <TableHead className="text-xs font-semibold text-right whitespace-nowrap">{t("originalBags")}</TableHead>
                    <TableHead className="text-xs font-semibold text-right whitespace-nowrap">{t("quantitySold")}</TableHead>
                    <TableHead className="text-xs font-semibold">{t("buyerName")}</TableHead>
                    <TableHead className="text-xs font-semibold text-right whitespace-nowrap">{t("pricePerKg")}</TableHead>
                    <TableHead className="text-xs font-semibold text-right whitespace-nowrap">{t("weight")}</TableHead>
                    <TableHead className="text-xs font-semibold text-right whitespace-nowrap">{t("totalDueToFarmer")}</TableHead>
                    <TableHead className="text-xs font-semibold whitespace-nowrap">{t("paymentStatus")}</TableHead>
                    <TableHead className="text-xs font-semibold whitespace-nowrap">{t("paymentDate")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {facilitatedSales.map((sale) => {
                    const netPayable = calculateNetPayableToFarmer(sale);
                    const isPaid = sale.farmerPaymentStatus === "paid";
                    return (
                      <TableRow key={sale.id} data-testid={`row-tracker-${sale.id}`}>
                        <TableCell className="whitespace-nowrap text-xs">
                          {format(new Date(sale.soldAt), "dd MMM yyyy")}
                        </TableCell>
                        <TableCell className="text-xs font-medium min-w-[120px]">{sale.farmerName}</TableCell>
                        <TableCell className="text-xs">{sale.village}</TableCell>
                        <TableCell className="text-xs">{sale.lotNo}</TableCell>
                        <TableCell className="text-right text-xs">{sale.originalLotSize}</TableCell>
                        <TableCell className="text-right text-xs">{sale.quantitySold}</TableCell>
                        <TableCell className="text-xs">{sale.buyerName || "-"}</TableCell>
                        <TableCell className="text-right text-xs">
                          <Currency amount={sale.pricePerKg || 0} />
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {(sale.netWeight || 0).toLocaleString()} kg
                        </TableCell>
                        <TableCell className="text-right text-xs font-medium">
                          <Currency amount={netPayable} />
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={`cursor-pointer select-none ${isPaid ? "bg-green-600 hover:bg-green-700" : "bg-red-500 hover:bg-red-600"}`}
                            onClick={() => handleTogglePaid(sale)}
                            data-testid={`badge-farmer-payment-${sale.id}`}
                          >
                            {isPaid ? t("farmerPaid") : t("farmerUnpaid")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs min-w-[140px]">
                          {isPaid && (
                            <Input
                              type="date"
                              value={sale.farmerPaidAt || ""}
                              onChange={(e) => handleDateChange(sale, e.target.value)}
                              className="h-7 text-xs"
                              data-testid={`input-farmer-paid-date-${sale.id}`}
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {facilitatedSales.length > 0 && (
        <div className="flex justify-between items-center text-sm text-muted-foreground">
          <span>
            {facilitatedSales.length} {facilitatedSales.length === 1 ? "sale" : "sales"}
          </span>
          <div className="flex gap-4">
            <span className="text-green-600">
              {t("farmerPaid")}: {facilitatedSales.filter((s) => s.farmerPaymentStatus === "paid").length}
            </span>
            <span className="text-red-600">
              {t("farmerUnpaid")}: {facilitatedSales.filter((s) => s.farmerPaymentStatus !== "paid").length}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================
// Exit / Nikasi Register
// =====================

const EXIT_DATE_FILTERS_KEY = "exit_register_date_filters_v2";

function getTodayIST() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const year  = Number(parts.find(p => p.type === "year")!.value);
  const month = Number(parts.find(p => p.type === "month")!.value);
  const day   = Number(parts.find(p => p.type === "day")!.value);
  return {
    year, month, day,
    dateStr: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function initExitDateFilters(): { year: string; months: number[]; days: number[] } {
  const today = getTodayIST();
  try {
    const raw = localStorage.getItem(EXIT_DATE_FILTERS_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const isValidMonth = (m: unknown): m is number =>
        typeof m === "number" && m >= 1 && m <= 12;
      const isValidDay = (d: unknown): d is number =>
        typeof d === "number" && d >= 1 && d <= 31;
      const yearOk   = typeof saved.year === "string" && (/^\d{4}$/.test(saved.year) || saved.year === "all");
      const monthsOk = Array.isArray(saved.months) && saved.months.every(isValidMonth);
      const daysOk   = Array.isArray(saved.days)   && saved.days.every(isValidDay);
      if (yearOk && monthsOk && daysOk && saved.savedDate === today.dateStr) {
        return { year: saved.year as string, months: saved.months, days: saved.days };
      }
    }
  } catch {}
  localStorage.removeItem(EXIT_DATE_FILTERS_KEY);
  return { year: String(today.year), months: [], days: [] };
}

function ExitRegister() {
  const { t } = useI18n();
  const exitFarmerNav = useDropdownNavigation();
  const exitVillageNav = useDropdownNavigation();
  const exitBuyerNav = useDropdownNavigation();

  // initExitDateFilters reads localStorage — compute once and share across the three state calls
  const _initDatesRef = useRef<ReturnType<typeof initExitDateFilters> | null>(null);
  if (!_initDatesRef.current) _initDatesRef.current = initExitDateFilters();
  const [year,   setYear]   = useState<string>  (_initDatesRef.current.year);
  const [months, setMonths] = useState<number[]>(_initDatesRef.current.months);
  const [days,   setDays]   = useState<number[]>(_initDatesRef.current.days);
  const [farmerFilter, setFarmerFilter] = useState("");
  const [farmerContact, setFarmerContact] = useState("");
  const [villageFilter, setVillageFilter] = useState("");
  const [buyerFilter, setBuyerFilter] = useState("");
  const [showFarmerSug, setShowFarmerSug] = useState(false);
  const [showVillageSug, setShowVillageSug] = useState(false);
  const [showBuyerSug, setShowBuyerSug] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [coldBillFilter, setColdBillFilter] = useState("");

  const { data: years = [] } = useQuery<number[]>({
    queryKey: ["/api/exit-register/years"],
  });

  const { data: farmerRecords } = useQuery<FarmerRecord[]>({
    queryKey: ["/api/farmers/lookup"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: buyerRecords } = useQuery<{ buyerName: string }[]>({
    queryKey: ["/api/buyers/lookup"],
    staleTime: 5 * 60 * 1000,
  });

  const farmerSug = useMemo(() => {
    if (!farmerRecords || !farmerFilter.trim()) return [];
    const q = farmerFilter.toLowerCase().trim();
    return farmerRecords.filter(f => f.farmerName.toLowerCase().includes(q)).slice(0, 8);
  }, [farmerRecords, farmerFilter]);

  const buyerSug = useMemo(() => {
    if (!buyerFilter.trim()) return [];
    const q = buyerFilter.toLowerCase().trim();
    const selfMatch = "self".includes(q) ? [{ buyerName: "Self" }] : [];
    const regular = (buyerRecords ?? []).filter(b => b.buyerName.toLowerCase().includes(q)).slice(0, 8);
    return [...selfMatch, ...regular];
  }, [buyerRecords, buyerFilter]);

  const villageSug = useMemo(() => {
    if (!farmerRecords || !villageFilter.trim()) return [];
    const q = villageFilter.toLowerCase().trim();
    const set = new Set<string>();
    for (const f of farmerRecords) {
      if (f.village && f.village.toLowerCase().includes(q)) set.add(f.village);
    }
    return Array.from(set).sort().slice(0, 8);
  }, [farmerRecords, villageFilter]);

  // Persist date filters to localStorage (keyed by today's IST date)
  useEffect(() => {
    const today = getTodayIST();
    localStorage.setItem(EXIT_DATE_FILTERS_KEY, JSON.stringify({
      year, months, days, savedDate: today.dateStr,
    }));
  }, [year, months, days]);

  // Auto-reset to today's date on every IST midnight (recurring)
  useEffect(() => {
    // IST = UTC+5:30 (no DST). Next IST midnight in ms:
    //   take today's IST date, advance by 1 day, convert to UTC.
    //   IST 00:00 = UTC 00:00 - 5h30m = UTC (prev day) 18:30.
    const getMsUntilMidnightIST = () => {
      const now = new Date();
      const today = getTodayIST();
      const nextMidnightUTC =
        Date.UTC(today.year, today.month - 1, today.day + 1) - 330 * 60 * 1000;
      return Math.max(0, nextMidnightUTC - now.getTime());
    };

    let timer: ReturnType<typeof setTimeout>;

    const scheduleReset = () => {
      timer = setTimeout(() => {
        const today = getTodayIST();
        setYear(String(today.year));
        setMonths([]);
        setDays([]);
        localStorage.removeItem(EXIT_DATE_FILTERS_KEY);
        scheduleReset();
      }, getMsUntilMidnightIST());
    };

    scheduleReset();
    return () => clearTimeout(timer);
  }, []);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (year !== "all") p.append("year", year);
    if (months.length) p.append("months", months.join(","));
    if (days.length) p.append("days", days.join(","));
    if (farmerFilter) p.append("farmerName", farmerFilter);
    if (farmerContact) p.append("farmerContact", farmerContact);
    if (buyerFilter) p.append("buyerName", buyerFilter);
    if (villageFilter) p.append("village", villageFilter);
    if (typeFilter && typeFilter !== "all") p.append("bagType", typeFilter);
    if (coldBillFilter.trim()) p.append("coldStorageBillNumber", coldBillFilter.trim());
    return p.toString();
  }, [year, months, days, farmerFilter, farmerContact, buyerFilter, villageFilter, typeFilter, coldBillFilter]);

  const { data, isLoading } = useQuery<ExitRegisterResponse>({
    queryKey: ["/api/exit-register", year, months.join(","), days.join(","), farmerFilter, farmerContact, buyerFilter, villageFilter, typeFilter, coldBillFilter],
    queryFn: async () => {
      const res = await authFetch(`/api/exit-register${queryString ? `?${queryString}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch exit register");
      return res.json();
    },
  });

  const monthShortNames = t("monthsShort").split(",");

  const monthLabel = months.length === 0
    ? t("allMonths")
    : months.length === 1
      ? monthShortNames[months[0] - 1]
      : `${months.length} ${t("monthsLabel")}`;

  const dayLabel = days.length === 0
    ? t("allDays")
    : days.length === 1
      ? String(days[0])
      : `${days.length} ${t("daysLabel")}`;

  const yearLabel = year === "all" ? t("allYears") : year;

  const clearFilters = () => {
    const today = getTodayIST();
    setYear(String(today.year));
    setMonths([]);
    setDays([]);
    setFarmerFilter("");
    setFarmerContact("");
    setVillageFilter("");
    setBuyerFilter("");
    setTypeFilter("all");
    setColdBillFilter("");
  };

  const todayIST = getTodayIST();
  const hasFilters =
    year !== String(todayIST.year) ||
    months.length > 0 ||
    days.length > 0 ||
    !!farmerFilter || !!farmerContact || !!villageFilter || !!buyerFilter ||
    !!coldBillFilter ||
    (typeFilter !== "" && typeFilter !== "all");

  const summary = data?.summary;
  const rows = data?.rows ?? [];

  const renderBuyer = (r: ExitRegisterRow) => {
    if (Number(r.isSelfSale) === 1 && !r.transferToBuyerName) return t("self");
    if (r.transferToBuyerName && r.transferToBuyerName.trim() && Number(r.isTransferReversed) !== 1) {
      return (
        <div className="flex flex-col">
          <span className="line-through text-muted-foreground">{Number(r.isSelfSale) === 1 ? t("self") : (r.buyerName || "-")}</span>
          <span className="text-purple-600 font-medium">{r.transferToBuyerName}</span>
        </div>
      );
    }
    return Number(r.isSelfSale) === 1 ? t("self") : (r.buyerName || "-");
  };

  const formatBagType = (bagType: string | null | undefined): string => {
    if (!bagType) return "—";
    const norm = bagType.toLowerCase();
    if (norm === "wafer") return t("wafer");
    if (norm === "seed") return t("seed");
    if (norm === "ration") return t("ration");
    return bagType;
  };

  const bagTypeBadgeClass = (bagType: string | null | undefined): string => {
    const norm = (bagType || "").toLowerCase();
    if (norm === "wafer") return "bg-chart-1/10 text-chart-1";
    if (norm === "seed") return "bg-chart-2/10 text-chart-2";
    if (norm === "ration") return "bg-chart-3/10 text-chart-3";
    return "";
  };

  const bagTypePrintStyle = (bagType: string | null | undefined): string => {
    const norm = (bagType || "").toLowerCase();
    if (norm === "wafer") return "background:rgba(59,130,246,0.10);color:#2563eb;";
    if (norm === "seed") return "background:rgba(16,185,129,0.10);color:#059669;";
    if (norm === "ration") return "background:rgba(249,115,22,0.10);color:#ea580c;";
    return "";
  };

  const isKnownBagType = (bagType: string | null | undefined): boolean => {
    const norm = (bagType || "").toLowerCase();
    return norm === "wafer" || norm === "seed" || norm === "ration";
  };

  const renderBagTypeBadge = (bagType: string | null | undefined) => {
    if (!isKnownBagType(bagType)) return <span className="text-muted-foreground">—</span>;
    return (
      <Badge variant="outline" className={bagTypeBadgeClass(bagType)}>
        {formatBagType(bagType)}
      </Badge>
    );
  };

  const renderBuyerText = (r: ExitRegisterRow): string => {
    if (Number(r.isSelfSale) === 1 && !r.transferToBuyerName) return t("self");
    if (r.transferToBuyerName && r.transferToBuyerName.trim() && Number(r.isTransferReversed) !== 1) {
      return r.transferToBuyerName;
    }
    return Number(r.isSelfSale) === 1 ? t("self") : (r.buyerName || "-");
  };

  const fmtINR = (n: number): string =>
    `\u20B9${(Math.round(n * 100) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  const handlePrint = () => {
    if (!summary || rows.length === 0) return;

    const filterParts: string[] = [];
    filterParts.push(`${t("year")}: ${yearLabel}`);
    if (months.length) filterParts.push(`${t("monthsLabel")}: ${months.map((m) => monthShortNames[m - 1]).join(", ")}`);
    if (days.length) filterParts.push(`${t("daysLabel")}: ${days.join(", ")}`);
    if (farmerFilter) filterParts.push(`${t("farmerName")}: ${farmerFilter}`);
    if (buyerFilter) filterParts.push(`${t("buyerName")}: ${buyerFilter.toLowerCase() === "self" ? t("self") : buyerFilter}`);
    if (coldBillFilter.trim()) filterParts.push(`${t("coldBillNo")}: ${coldBillFilter.trim()}`);

    const escape = (s: string | number | null | undefined): string =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const summaryCardsHtml = `
      <div class="cards">
        <div class="card"><div class="lbl">${escape(t("numFarmers"))}</div><div class="val">${summary.farmers}<br/><small>${escape(t("exitsWithDue"))}: ${summary.exitsWithDue}</small></div></div>
        <div class="card"><div class="lbl">${escape(t("totalBagsExited"))}</div><div class="val">${summary.totalBagsExited.toLocaleString()}</div></div>
        <div class="card"><div class="lbl">${escape(t("coldStorageCharges"))}</div><div class="val">${escape(fmtINR(summary.coldChargesTotal))}</div></div>
        <div class="card"><div class="lbl">${escape(t("cashReceived"))}</div><div class="val cash">${escape(fmtINR(summary.cashReceived))}</div></div>
        <div class="card"><div class="lbl">${escape(t("accountReceived"))}</div><div class="val acct">${escape(fmtINR(summary.accountReceived))}</div></div>
        <div class="card"><div class="lbl">${escape(t("discountReceived"))}</div><div class="val disc">${escape(fmtINR(summary.discountReceived))}</div></div>
        <div class="card"><div class="lbl">${escape(t("amountDue"))}</div><div class="val due">${escape(fmtINR(summary.amountDue))}</div></div>
        <div class="card"><div class="lbl">${escape(t("receivableAdjustments"))}</div><div class="val">${escape(fmtINR(summary.receivableAdjReceived))}</div></div>
      </div>
    `;

    // Task #366 — village names wrap after the first word instead of running
    // on one line, while the column keeps its original width. Same behavior
    // as the Sales History PDF's renderVillageCell (client/src/pages/SalesHistory.tsx handleSalesPrint).
    const renderExitVillageCell = (village: string): string => {
      const words = (village || "").trim().split(/\s+/).filter(Boolean);
      if (words.length < 2) return escape(village || "");
      const firstLine = words.slice(0, -1).join(" ");
      const secondLine = words[words.length - 1];
      return `${escape(firstLine)}<br/>${escape(secondLine)}`;
    };

    // Task #366 — Payment Mode column: mirrors the exact per-row cash/account
    // attribution the exit-register summary cards already use (server/storage.ts
    // getExitRegister, ~lines 4323-4333) so the column never disagrees with
    // the Cash Received / Account Received cards above the table:
    //   1) If the sale has non-zero paidCash/paidAccount counters, prorate
    //      each by this exit's bagsExited/quantitySold share.
    //   2) Otherwise (legacy rows with zero counters), fall back to the
    //      sale's single paymentMode field and attribute the whole prorated
    //      paidShare to that one mode.
    const renderPaymentModeCell = (r: ExitRegisterRow): string => {
      const qty = r.quantitySold || 0;
      const share = qty > 0 ? r.bagsExited / qty : 0;
      const paidCash = Number(r.paidCash) || 0;
      const paidAccount = Number(r.paidAccount) || 0;
      const counterTotal = paidCash + paidAccount;
      let cashAmt = 0;
      let accountAmt = 0;
      if (counterTotal > 0) {
        cashAmt = paidCash * share;
        accountAmt = paidAccount * share;
      } else if (r.paymentMode === "cash") {
        cashAmt = r.paidShare;
      } else if (r.paymentMode === "account") {
        accountAmt = r.paidShare;
      }
      const lines: string[] = [];
      if (accountAmt > 0) lines.push(`Account - ${fmtINR(accountAmt)}`);
      if (cashAmt > 0) lines.push(`${t("cash")} - ${fmtINR(cashAmt)}`);
      if (lines.length === 0) return "—";
      return lines.map((l) => escape(l)).join("<br/>");
    };

    const rowsHtml = rows
      .map(
        (r) => `
        <tr>
          <td class="nowrap">${escape(format(new Date(r.exitDate), "dd MMM yyyy"))}</td>
          <td class="wrap">${escape(r.farmerName)}</td>
          <td class="nowrap">${renderExitVillageCell(r.village)}</td>
          <td class="nowrap">${escape(r.lotNo)}</td>
          <td class="nowrap">${escape(r.marka || "—")}</td>
          <td class="nowrap">${isKnownBagType(r.bagType) ? `<span class="bag-badge" style="${bagTypePrintStyle(r.bagType)}">${escape(formatBagType(r.bagType))}</span>` : "—"}</td>
          <td class="nowrap">${escape(r.coldStorageBillNumber != null ? String(r.coldStorageBillNumber) : "—")}</td>
          <td class="nowrap r">${escape(r.bagsExited)}</td>
          <td class="wrap">${escape(renderBuyerText(r))}</td>
          <td class="nowrap r">${escape(fmtINR(r.coldChargeShare))}</td>
          <td class="nowrap r cash">${r.paidShare > 0 ? escape(fmtINR(r.paidShare)) : "—"}</td>
          <td class="nowrap r due">${r.dueShare > 0 ? escape(fmtINR(r.dueShare)) : "—"}</td>
          <td class="nowrap">${renderPaymentModeCell(r)}</td>
        </tr>
      `,
      )
      .join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escape(t("exitRegister"))}</title>
<style>
  @page{size:A4 landscape;margin:8mm;}
  *{box-sizing:border-box;}
  body{font-family:Arial,Helvetica,"Liberation Sans","DejaVu Sans",sans-serif;margin:16px;color:#111;}
  h1{margin:0 0 4px 0;font-size:18px;}
  .meta{font-size:11px;color:#555;margin-bottom:12px;}
  .cards{display:grid;grid-template-columns:repeat(8,1fr);gap:6px;margin-bottom:14px;}
  .card{border:1px solid #d4d4d8;border-radius:6px;padding:8px 10px;min-height:44px;}
  .lbl{font-size:11px;line-height:1.25;color:#555;word-break:break-word;overflow-wrap:anywhere;}
  .val{font-size:16px;line-height:1.3;font-weight:700;margin-top:2px;white-space:nowrap;}
  .val.cash{color:#047857;} .val.acct{color:#4338ca;} .val.disc{color:#7c3aed;} .val.due{color:#be123c;}
  table{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed;}
  th,td{border:1px solid #d4d4d8;padding:4px 6px;text-align:left;vertical-align:top;}
  th{background:#f4f4f5;font-weight:700;}
  td.r,th.r{text-align:right;}
  td.cash{color:#047857;} td.due{color:#be123c;}
  .nowrap{white-space:nowrap;}
  .wrap{word-break:break-word;overflow-wrap:anywhere;}
  .bag-badge{display:inline-block;padding:1px 6px;border:1px solid #d4d4d8;border-radius:9999px;font-size:10px;font-weight:600;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  /* Task #366 — explicit percentage widths (table-layout:fixed) so Buyer
     Name and Cold Charges can be tightened and the freed space can be
     redistributed to the new Payment Mode column, while Village keeps its
     original share of the page width. */
  col.c-date{width:6.5%;} col.c-farmer{width:13%;} col.c-village{width:8%;}
  col.c-lot{width:4.5%;} col.c-marka{width:5%;} col.c-btype{width:6%;}
  col.c-cbill{width:5%;} col.c-bags{width:5%;} col.c-buyer{width:10%;}
  col.c-charges{width:7%;} col.c-paid{width:8%;} col.c-due{width:8%;}
  col.c-paymode{width:14%;}
  @media print{body{margin:8mm;} .cards{grid-template-columns:repeat(8,1fr);}}
</style></head><body>
  <h1>${escape(t("exitRegister"))}</h1>
  <div class="meta">${filterParts.map((p) => escape(p)).join(" &nbsp;|&nbsp; ")}</div>
  ${summaryCardsHtml}
  <table>
    <colgroup>
      <col class="c-date"/>
      <col class="c-farmer"/>
      <col class="c-village"/>
      <col class="c-lot"/>
      <col class="c-marka"/>
      <col class="c-btype"/>
      <col class="c-cbill"/>
      <col class="c-bags"/>
      <col class="c-buyer"/>
      <col class="c-charges"/>
      <col class="c-paid"/>
      <col class="c-due"/>
      <col class="c-paymode"/>
    </colgroup>
    <thead><tr>
      <th class="nowrap">${escape(t("exitDate"))}</th>
      <th class="wrap">${escape(t("farmerName"))}</th>
      <th class="nowrap">${escape(t("village"))}</th>
      <th class="nowrap">${escape(t("lotNo"))}</th>
      <th class="nowrap">${escape(t("marka"))}</th>
      <th class="nowrap">${escape(t("potatoType"))}</th>
      <th class="nowrap">${escape(t("coldBillNo"))}</th>
      <th class="nowrap r">${escape(t("bagsExited"))}</th>
      <th class="wrap">${escape(t("buyerName"))}</th>
      <th class="nowrap r">Cold Charges</th>
      <th class="nowrap r">${escape(t("paid"))}</th>
      <th class="nowrap r">${escape(t("due"))}</th>
      <th>${escape(t("paymentMode"))}</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <script>window.onload=function(){window.print();}<\/script>
</body></html>`;

    const w = window.open("", "_blank");
    if (!w) {
      toast({
        title: t("error"),
        description: "Pop-up blocked. Please allow pop-ups for this site to print.",
        variant: "destructive",
      });
      return;
    }
    w.document.write(html);
    w.document.close();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            {t("filters")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-2">
            {/* Year / Month / Day */}
            <div className="w-full sm:w-[22rem]">
              <DateFilterBar
                year={year}
                onYearChange={setYear}
                selectedMonths={months}
                onMonthsChange={setMonths}
                selectedDays={days}
                onDaysChange={setDays}
                availableYears={years}
                showLabels={false}
              />
            </div>

            {/* Farmer autocomplete */}
            <div className="relative w-44">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
              <Input
                value={farmerFilter}
                onChange={(e) => { setFarmerFilter(capitalizeFirstLetter(e.target.value)); setFarmerContact(""); setShowFarmerSug(true); }}
                onFocus={() => { setShowFarmerSug(true); exitFarmerNav.resetActive(); }}
                onBlur={() => setTimeout(() => { setShowFarmerSug(false); exitFarmerNav.resetActive(); }, 200)}
                onKeyDown={(e) => exitFarmerNav.handleKeyDown(e, farmerSug.length, (i) => { const f = farmerSug[i]; setFarmerFilter(f.farmerName); setFarmerContact(f.contactNumber); setShowFarmerSug(false); }, () => setShowFarmerSug(false))}
                placeholder={t("farmerName")}
                className="pl-10 h-9"
                autoComplete="off"
                data-testid="input-exit-farmer"
              />
              {showFarmerSug && farmerSug.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                  {farmerSug.map((f, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`w-full px-3 py-2 text-left hover-elevate text-sm flex flex-col ${exitFarmerNav.activeIndex === idx ? "bg-accent" : ""}`}
                      onClick={() => { setFarmerFilter(f.farmerName); setFarmerContact(f.contactNumber); setShowFarmerSug(false); }}
                      data-testid={`exit-suggestion-farmer-${idx}`}
                    >
                      <span className="font-medium">{f.farmerName}</span>
                      <span className="text-xs text-muted-foreground">{f.contactNumber} • {f.village}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Village autocomplete */}
            <div className="relative w-40">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
              <Input
                value={villageFilter}
                onChange={(e) => { setVillageFilter(capitalizeFirstLetter(e.target.value)); setShowVillageSug(true); }}
                onFocus={() => { setShowVillageSug(true); exitVillageNav.resetActive(); }}
                onBlur={() => setTimeout(() => { setShowVillageSug(false); exitVillageNav.resetActive(); }, 200)}
                onKeyDown={(e) => exitVillageNav.handleKeyDown(e, villageSug.length, (i) => { setVillageFilter(villageSug[i]); setShowVillageSug(false); }, () => setShowVillageSug(false))}
                placeholder={t("village")}
                className="pl-10 h-9"
                autoComplete="off"
                data-testid="input-exit-village"
              />
              {showVillageSug && villageSug.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                  {villageSug.map((v, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`w-full px-3 py-2 text-left hover-elevate text-sm ${exitVillageNav.activeIndex === idx ? "bg-accent" : ""}`}
                      onClick={() => { setVillageFilter(v); setShowVillageSug(false); }}
                      data-testid={`exit-suggestion-village-${idx}`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Buyer autocomplete */}
            <div className="relative w-44">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
              <Input
                value={buyerFilter}
                onChange={(e) => { setBuyerFilter(capitalizeFirstLetter(e.target.value)); setShowBuyerSug(true); }}
                onFocus={() => { setShowBuyerSug(true); exitBuyerNav.resetActive(); }}
                onBlur={() => setTimeout(() => { setShowBuyerSug(false); exitBuyerNav.resetActive(); }, 200)}
                onKeyDown={(e) => exitBuyerNav.handleKeyDown(e, buyerSug.length, (i) => { setBuyerFilter(buyerSug[i].buyerName); setShowBuyerSug(false); }, () => setShowBuyerSug(false))}
                placeholder={t("buyerName")}
                className="pl-10 h-9"
                autoComplete="off"
                data-testid="input-exit-buyer"
              />
              {showBuyerSug && buyerSug.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                  {buyerSug.map((b, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`w-full px-3 py-2 text-left hover-elevate text-sm ${exitBuyerNav.activeIndex === idx ? "bg-accent" : ""}`}
                      onClick={() => { setBuyerFilter(b.buyerName); setShowBuyerSug(false); }}
                      data-testid={`exit-suggestion-buyer-${idx}`}
                    >
                      {b.buyerName === "Self" ? t("self") : b.buyerName}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Cold Bill No. */}
            <div className="w-32">
              <Input
                type="text"
                inputMode="numeric"
                value={coldBillFilter}
                onChange={(e) => setColdBillFilter(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder={t("coldBillNo")}
                className="h-9"
                data-testid="input-exit-cold-bill-filter"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="w-56 sm:w-32">
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="h-9" data-testid="select-exit-type-filter">
                    <SelectValue placeholder={t("filterByType")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("all")}</SelectItem>
                    <SelectItem value="wafer">{t("wafer")}</SelectItem>
                    <SelectItem value="seed">{t("seed")}</SelectItem>
                    <SelectItem value="ration">{t("ration")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {hasFilters && (
                <Button variant="outline" size="sm" onClick={clearFilters} data-testid="button-exit-clear-filters" className="sm:hidden h-9">
                  <X className="h-4 w-4 mr-1" /> {t("clearFilters")}
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={handlePrint}
                disabled={!summary || rows.length === 0}
                data-testid="button-exit-print"
                aria-label={t("printPdf")}
                title={t("printPdf")}
                className="sm:hidden h-9 px-2 ml-auto"
              >
                <Printer className="h-4 w-4" />
              </Button>
            </div>

            {hasFilters && (
              <Button variant="outline" size="sm" onClick={clearFilters} data-testid="button-exit-clear-filters-desktop" className="hidden sm:inline-flex">
                <X className="h-4 w-4 mr-1" /> {t("clearFilters")}
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              disabled={!summary || rows.length === 0}
              data-testid="button-exit-print-desktop"
              aria-label={t("printPdf")}
              title={t("printPdf")}
              className="hidden sm:inline-flex"
            >
              <Printer className="h-4 w-4" />
            </Button>

          </div>
        </CardContent>
      </Card>

      {/* Summary cards: 1 stat-tiles + Cold Charges + Cash Received + Account Received + Discount + Amount Due */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <Card data-testid="card-exit-farmers-due">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-500/10 shrink-0">
                  <Users className="h-4 w-4 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs text-muted-foreground truncate">{t("numFarmers")}</p>
                    <p className="text-xs font-bold text-blue-700 dark:text-blue-300" data-testid="stat-farmers">
                      {summary.farmers}
                    </p>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs text-muted-foreground truncate">{t("exitsWithDue")}</p>
                    <p className="text-xs font-bold text-amber-700 dark:text-amber-300" data-testid="stat-exits-due">
                      {summary.exitsWithDue}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-exit-bags-exited">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-violet-500/10">
                  <Package className="h-5 w-5 text-violet-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{t("totalBagsExited")}</p>
                  <p className="text-xs font-bold text-violet-700 dark:text-violet-300 truncate" data-testid="stat-bags-exited">
                    {summary.totalBagsExited.toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-exit-cold">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-sky-500/10">
                  <Warehouse className="h-5 w-5 text-sky-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{t("coldStorageCharges")}</p>
                  <p className="text-xs font-bold text-sky-700 dark:text-sky-400 truncate" data-testid="stat-cold-charges">
                    <Currency amount={summary.coldChargesTotal} />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-exit-cash">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10">
                  <Banknote className="h-5 w-5 text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{t("cashReceived")}</p>
                  <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400 truncate" data-testid="stat-cash">
                    <Currency amount={summary.cashReceived} />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-exit-account">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-indigo-500/10">
                  <CreditCard className="h-5 w-5 text-indigo-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{t("accountReceived")}</p>
                  <p className="text-xs font-bold text-indigo-700 dark:text-indigo-400 truncate" data-testid="stat-account">
                    <Currency amount={summary.accountReceived} />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-exit-discount">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-violet-500/10">
                  <BadgePercent className="h-5 w-5 text-violet-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{t("discountReceived")}</p>
                  <p className="text-xs font-bold text-violet-700 dark:text-violet-400 truncate" data-testid="stat-discount">
                    <Currency amount={summary.discountReceived} />
                  </p>
                  {summary.roundOffReceived > 0 && (
                    <p className="text-[10px] text-muted-foreground" data-testid="stat-discount-roundoff">
                      {t("roundOffShort")}: ₹{formatCurrency(summary.roundOffReceived)}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-exit-due">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-rose-500/10">
                  <AlertTriangle className="h-5 w-5 text-rose-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{t("amountDue")}</p>
                  <p className="text-xs font-bold text-rose-700 dark:text-rose-400 truncate" data-testid="stat-due">
                    <Currency amount={summary.amountDue} />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-exit-receivable-adj">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10">
                  <FileCheck className="h-5 w-5 text-orange-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{t("receivableAdjustments")}</p>
                  <p className="text-xs font-bold text-orange-600 dark:text-orange-400 truncate" data-testid="stat-receivable-adj">
                    <Currency amount={summary.receivableAdjReceived} />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground" data-testid="text-no-exits">
              {t("noExits")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="text-sm font-semibold whitespace-nowrap">{t("exitDate")}</TableHead>
                    <TableHead className="text-sm font-semibold">{t("farmerName")}</TableHead>
                    <TableHead className="text-sm font-semibold whitespace-nowrap">{t("village")}</TableHead>
                    <TableHead className="text-sm font-semibold whitespace-nowrap">{t("lotNo")}</TableHead>
                    <TableHead className="text-sm font-semibold whitespace-nowrap">{t("marka")}</TableHead>
                    <TableHead className="text-sm font-semibold whitespace-nowrap">{t("potatoType")}</TableHead>
                    <TableHead className="text-sm font-semibold whitespace-nowrap">{t("exitBillNo")}</TableHead>
                    <TableHead className="text-sm font-semibold whitespace-nowrap">{t("coldBillNo")}</TableHead>
                    <TableHead className="text-sm font-semibold text-right whitespace-nowrap">{t("bagsExited")}</TableHead>
                    <TableHead className="text-sm font-semibold whitespace-nowrap">{t("buyerName")}</TableHead>
                    <TableHead className="text-sm font-semibold text-right whitespace-nowrap">{t("coldStorageCharges")}</TableHead>
                    <TableHead className="text-sm font-semibold text-right whitespace-nowrap">{t("paid")}</TableHead>
                    <TableHead className="text-sm font-semibold text-right whitespace-nowrap">{t("due")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.exitId} data-testid={`row-exit-${r.exitId}`}>
                      <TableCell className="text-sm whitespace-nowrap">{format(new Date(r.exitDate), "dd MMM yyyy")}</TableCell>
                      <TableCell className="text-sm font-medium min-w-[120px]">{r.farmerName}</TableCell>
                      <TableCell className="text-sm">{r.village}</TableCell>
                      <TableCell className="text-sm">{r.lotNo}</TableCell>
                      <TableCell className="text-sm">{r.marka || "—"}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{renderBagTypeBadge(r.bagType)}</TableCell>
                      <TableCell className="text-sm" data-testid={`exit-bill-${r.exitId}`}>{r.billNumber != null && r.billNumber > 0 ? String(r.billNumber) : "—"}</TableCell>
                      <TableCell className="text-sm">{r.coldStorageBillNumber != null ? String(r.coldStorageBillNumber) : "—"}</TableCell>
                      <TableCell className="text-sm text-right">{r.bagsExited}</TableCell>
                      <TableCell className="text-sm">{renderBuyer(r)}</TableCell>
                      <TableCell className="text-sm text-right font-medium" data-testid={`cold-share-${r.exitId}`}>
                        <Currency amount={r.coldChargeShare} />
                      </TableCell>
                      <TableCell className="text-sm text-right text-emerald-700 dark:text-emerald-400" data-testid={`paid-share-${r.exitId}`}>
                        {r.paidShare > 0 ? <Currency amount={r.paidShare} /> : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-right text-rose-700 dark:text-rose-400" data-testid={`due-share-${r.exitId}`}>
                        {r.dueShare > 0 ? <Currency amount={r.dueShare} /> : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <div className="text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? "exit" : "exits"}
        </div>
      )}
    </div>
  );
}
