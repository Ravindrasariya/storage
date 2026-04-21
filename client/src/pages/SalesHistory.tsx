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
import { Search, X, Pencil, Filter, Package, IndianRupee, Clock, LogOut, ArrowLeftRight, Download, Loader2, Warehouse, FileCheck, HandCoins, ChevronDown, Users, AlertTriangle, CreditCard, Banknote, Printer, BadgePercent } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { EditSaleDialog } from "@/components/EditSaleDialog";
import type { SalesHistory, ExitRegisterResponse, ExitRegisterRow } from "@shared/schema";
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
      activeTab,
    };
    localStorage.setItem(SALES_FILTERS_KEY, JSON.stringify(filters));
  }, [yearFilter, selectedMonths, selectedDays, farmerFilter, selectedFarmerVillage, selectedFarmerMobile, villageFilter, paymentFilter, buyerFilter, typeFilter, activeTab]);
  const [editingSale, setEditingSale] = useState<SalesHistory | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // Autocomplete state
  const [showFarmerSuggestions, setShowFarmerSuggestions] = useState(false);
  const [showBuyerSuggestions, setShowBuyerSuggestions] = useState(false);
  const [showVillageSuggestions, setShowVillageSuggestions] = useState(false);
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

  // Filtered suggestions for buyer name
  const getBuyerSuggestions = useMemo(() => {
    if (!buyerRecords || buyerRecords.length === 0 || !buyerFilter.trim()) return [];
    const query = buyerFilter.toLowerCase().trim();
    return buyerRecords
      .filter(buyer => buyer.buyerName.toLowerCase().includes(query))
      .slice(0, 8);
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
    return params.toString();
  };

  const { data: salesHistory = [], isLoading: historyLoading } = useQuery<SalesHistory[]>({
    queryKey: ["/api/sales-history", yearFilter, farmerFilter, selectedFarmerVillage, selectedFarmerMobile, villageFilter, paymentFilter, buyerFilter],
    queryFn: async () => {
      const queryString = buildQueryString();
      const response = await authFetch(`/api/sales-history${queryString ? `?${queryString}` : ""}`);
      if (!response.ok) throw new Error("Failed to fetch sales history");
      return response.json();
    },
  });

  const handleEditSale = (sale: SalesHistory) => {
    setEditingSale(sale);
    setEditDialogOpen(true);
  };

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
  };

  const hasActiveFilters = yearFilter || selectedMonths.length || selectedDays.length || farmerFilter || selectedFarmerVillage || villageFilter || paymentFilter || buyerFilter || (typeFilter && typeFilter !== "all");

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
    queryKey: ["/api/sales-history/exits-summary", yearFilter],
    queryFn: async () => {
      const params = yearFilter && yearFilter !== "all" ? `?year=${yearFilter}` : "";
      const response = await authFetch(`/api/sales-history/exits-summary${params}`);
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

  const summary = filteredSalesHistory.reduce(
    (acc, sale) => {
      acc.totalBags += sale.quantitySold || 0;
      acc.amountPaid += sale.paidAmount || 0;
      const coldStorageDue = Math.max(0, (sale.coldStorageCharge || 0) - (sale.paidAmount || 0));
      acc.amountDue += coldStorageDue + (sale.extraDueToMerchant || 0);
      acc.totalColdStorageCharges += sale.coldStorageCharge || 0;
      acc.totalReceivableAdj += (sale.adjPyReceivables || 0) + (sale.adjAdvance || 0) + (sale.adjFreight || 0) + (sale.adjSelfDue || 0);
      acc.totalAdjSelfDue += sale.adjSelfDue || 0;
      return acc;
    },
    { totalBags: 0, amountPaid: 0, amountDue: 0, totalColdStorageCharges: 0, totalReceivableAdj: 0, totalAdjSelfDue: 0 }
  );

  summary.amountPaid = Math.max(0, summary.amountPaid - summary.totalAdjSelfDue);
  summary.totalColdStorageCharges = Math.max(0, summary.totalColdStorageCharges - summary.totalAdjSelfDue);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold" data-testid="text-page-title">
          {activeTab === "tracker" ? t("farmerPaymentTracker") : activeTab === "exits" ? t("exitRegister") : t("salesHistory")}
        </h1>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "sales" | "tracker" | "exits")}>
          <TabsList>
            <TabsTrigger
              value="exits"
              data-testid="tab-exits"
              className="data-[state=active]:bg-chart-1 data-[state=active]:text-white data-[state=active]:hover:bg-chart-1/90"
            >
              <LogOut className="h-4 w-4 mr-1" />{t("exitRegister")}
            </TabsTrigger>
            <TabsTrigger
              value="sales"
              data-testid="tab-sales"
              className="data-[state=active]:bg-chart-1 data-[state=active]:text-white data-[state=active]:hover:bg-chart-1/90"
            >
              {t("salesHistory")}
            </TabsTrigger>
            <TabsTrigger
              value="tracker"
              data-testid="tab-tracker"
              className="data-[state=active]:bg-chart-1 data-[state=active]:text-white data-[state=active]:hover:bg-chart-1/90"
            >
              <HandCoins className="h-4 w-4 mr-1" />{t("farmerPaymentTracker")}
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
                        {buyer.buyerName}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="w-full sm:w-32 space-y-2">
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

            <div className="w-full sm:w-36 space-y-2">
              <label className="text-sm text-muted-foreground">{t("paymentStatus")}</label>
              <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                <SelectTrigger data-testid="select-payment-filter">
                  <SelectValue placeholder={t("all")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("all")}</SelectItem>
                  <SelectItem value="paid">{t("paid")}</SelectItem>
                  <SelectItem value="due">{t("due")}</SelectItem>
                </SelectContent>
              </Select>
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
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 lg:gap-4">
          <Card data-testid="card-summary-bags">
            <CardContent className="p-3 lg:pt-6 lg:px-6">
              <div className="flex items-center gap-2">
                <div className="p-1.5 lg:p-2 rounded-lg bg-primary/10 shrink-0">
                  <Package className="h-4 w-4 lg:h-5 lg:w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs lg:text-sm text-muted-foreground truncate">{t("totalBagsSold")}</p>
                  <p className="text-base lg:text-lg font-bold truncate" data-testid="text-total-bags">{summary.totalBags.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-summary-paid">
            <CardContent className="p-3 lg:pt-6 lg:px-6">
              <div className="flex items-center gap-2">
                <div className="p-1.5 lg:p-2 rounded-lg bg-emerald-500/10 shrink-0">
                  <IndianRupee className="h-4 w-4 lg:h-5 lg:w-5 text-emerald-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs lg:text-sm text-muted-foreground truncate">{t("amountPaid")}</p>
                  <p className="text-base lg:text-lg font-bold text-emerald-600 dark:text-emerald-400 truncate" data-testid="text-amount-paid">
                    <Currency amount={summary.amountPaid} />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-summary-due">
            <CardContent className="p-3 lg:pt-6 lg:px-6">
              <div className="flex items-center gap-2">
                <div className="p-1.5 lg:p-2 rounded-lg bg-amber-500/10 shrink-0">
                  <Clock className="h-4 w-4 lg:h-5 lg:w-5 text-amber-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs lg:text-sm text-muted-foreground truncate">{t("amountDue")}</p>
                  <p className="text-base lg:text-lg font-bold text-amber-600 dark:text-amber-400 truncate" data-testid="text-amount-due">
                    <Currency amount={summary.amountDue} />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-summary-bags-exit">
            <CardContent className="p-3 lg:pt-6 lg:px-6">
              <div className="flex items-center gap-2">
                <div className="p-1.5 lg:p-2 rounded-lg bg-violet-500/10 shrink-0">
                  <LogOut className="h-4 w-4 lg:h-5 lg:w-5 text-violet-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs lg:text-sm text-muted-foreground truncate">{t("sold")}/{t("exit")}</p>
                  <p className="text-base lg:text-lg font-bold truncate" data-testid="text-bags-sold-exited">
                    {summary.totalBags}/{exitsSummary?.totalBagsExited || 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-summary-cold-charges">
            <CardContent className="p-3 lg:pt-6 lg:px-6">
              <div className="flex items-center gap-2">
                <div className="p-1.5 lg:p-2 rounded-lg bg-sky-500/10 shrink-0">
                  <Warehouse className="h-4 w-4 lg:h-5 lg:w-5 text-sky-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs lg:text-sm text-muted-foreground truncate">{t("coldStorageCharges")}</p>
                  <p className="text-base lg:text-lg font-bold text-sky-600 dark:text-sky-400 truncate" data-testid="text-cold-charges">
                    <Currency amount={summary.totalColdStorageCharges} />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-summary-receivable-adj">
            <CardContent className="p-3 lg:pt-6 lg:px-6">
              <div className="flex items-center gap-2">
                <div className="p-1.5 lg:p-2 rounded-lg bg-orange-500/10 shrink-0">
                  <FileCheck className="h-4 w-4 lg:h-5 lg:w-5 text-orange-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs lg:text-sm text-muted-foreground truncate">{t("receivableAdjustments")}</p>
                  <p className="text-base lg:text-lg font-bold text-orange-600 dark:text-orange-400 truncate" data-testid="text-receivable-adj">
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
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEditSale(sale)}
                            data-testid={`button-edit-sale-${sale.id}`}
                          >
                            <Pencil className="h-4 w-4 mr-1" />
                            {t("edit")}
                          </Button>
                        </div>
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

      <EditSaleDialog 
        sale={editingSale}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
      />

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
    return filtered.sort((a, b) => new Date(b.soldAt).getTime() - new Date(a.soldAt).getTime());
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

const EXIT_DATE_FILTERS_KEY = "exit_register_date_filters";

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
      const yearOk   = typeof saved.year === "string" && /^\d{4}$/.test(saved.year);
      const monthsOk = Array.isArray(saved.months) && saved.months.every(isValidMonth);
      const daysOk   = Array.isArray(saved.days)   && saved.days.every(isValidDay);
      if (yearOk && monthsOk && daysOk && saved.savedDate === today.dateStr) {
        return { year: saved.year as string, months: saved.months, days: saved.days };
      }
    }
  } catch {}
  return { year: String(today.year), months: [today.month], days: [today.day] };
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
    if (!buyerRecords || !buyerFilter.trim()) return [];
    const q = buyerFilter.toLowerCase().trim();
    return buyerRecords.filter(b => b.buyerName.toLowerCase().includes(q)).slice(0, 8);
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
        setMonths([today.month]);
        setDays([today.day]);
        localStorage.removeItem(EXIT_DATE_FILTERS_KEY);
        scheduleReset(); // reschedule for the next midnight
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
    return p.toString();
  }, [year, months, days, farmerFilter, farmerContact, buyerFilter, villageFilter, typeFilter]);

  const { data, isLoading } = useQuery<ExitRegisterResponse>({
    queryKey: ["/api/exit-register", year, months.join(","), days.join(","), farmerFilter, farmerContact, buyerFilter, villageFilter, typeFilter],
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
    setMonths([today.month]);
    setDays([today.day]);
    setFarmerFilter("");
    setFarmerContact("");
    setVillageFilter("");
    setBuyerFilter("");
    setTypeFilter("all");
  };

  const todayIST = getTodayIST();
  const hasFilters =
    year !== String(todayIST.year) ||
    months.join(",") !== String(todayIST.month) ||
    days.join(",") !== String(todayIST.day) ||
    !!farmerFilter || !!farmerContact || !!villageFilter || !!buyerFilter ||
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
    if (buyerFilter) filterParts.push(`${t("buyerName")}: ${buyerFilter}`);

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

    const rowsHtml = rows
      .map(
        (r) => `
        <tr>
          <td class="nowrap">${escape(format(new Date(r.exitDate), "dd MMM yyyy"))}</td>
          <td class="wrap">${escape(r.farmerName)}</td>
          <td class="nowrap">${escape(r.village)}</td>
          <td class="nowrap">${escape(r.lotNo)}</td>
          <td class="nowrap">${escape(r.marka || "—")}</td>
          <td class="nowrap">${isKnownBagType(r.bagType) ? `<span class="bag-badge" style="${bagTypePrintStyle(r.bagType)}">${escape(formatBagType(r.bagType))}</span>` : "—"}</td>
          <td class="nowrap">${escape(r.coldStorageBillNumber != null ? String(r.coldStorageBillNumber) : "—")}</td>
          <td class="nowrap r">${escape(r.bagsExited)}</td>
          <td class="wrap">${escape(renderBuyerText(r))}</td>
          <td class="nowrap r">${escape(fmtINR(r.coldChargeShare))}</td>
          <td class="nowrap r cash">${r.paidShare > 0 ? escape(fmtINR(r.paidShare)) : "—"}</td>
          <td class="nowrap r due">${r.dueShare > 0 ? escape(fmtINR(r.dueShare)) : "—"}</td>
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
  table{width:100%;border-collapse:collapse;font-size:11px;}
  th,td{border:1px solid #d4d4d8;padding:4px 6px;text-align:left;}
  th{background:#f4f4f5;font-weight:700;}
  td.r,th.r{text-align:right;}
  td.cash{color:#047857;} td.due{color:#be123c;}
  .nowrap{white-space:nowrap;}
  .wrap{word-break:break-word;overflow-wrap:anywhere;}
  th.date{width:64px;} th.lot{width:48px;} th.bags{width:48px;} th.cold-bill{width:60px;} th.cold-charges{width:80px;}
  .bag-badge{display:inline-block;padding:1px 6px;border:1px solid #d4d4d8;border-radius:9999px;font-size:10px;font-weight:600;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  @media print{body{margin:8mm;} .cards{grid-template-columns:repeat(8,1fr);}}
</style></head><body>
  <h1>${escape(t("exitRegister"))}</h1>
  <div class="meta">${filterParts.map((p) => escape(p)).join(" &nbsp;|&nbsp; ")}</div>
  ${summaryCardsHtml}
  <table>
    <thead><tr>
      <th class="nowrap date">${escape(t("exitDate"))}</th>
      <th class="wrap">${escape(t("farmerName"))}</th>
      <th class="nowrap">${escape(t("village"))}</th>
      <th class="nowrap lot">${escape(t("lotNo"))}</th>
      <th class="nowrap">${escape(t("marka"))}</th>
      <th class="nowrap">${escape(t("potatoType"))}</th>
      <th class="nowrap cold-bill">${escape(t("coldBillNo"))}</th>
      <th class="nowrap r bags">${escape(t("bagsExited"))}</th>
      <th class="wrap">${escape(t("buyerName"))}</th>
      <th class="nowrap r cold-charges">Cold Charges</th>
      <th class="nowrap r">${escape(t("paid"))}</th>
      <th class="nowrap r">${escape(t("due"))}</th>
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
          <div className="flex flex-wrap items-end gap-3">
            {/* Year / Month / Day */}
            <div className="w-full sm:w-[28rem]">
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
            <div className="relative w-56">
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
            <div className="relative w-56">
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
            <div className="relative w-56">
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
                      {b.buyerName}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="w-full sm:w-32">
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
              <Button variant="outline" size="sm" onClick={clearFilters} data-testid="button-exit-clear-filters">
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
                    <p className="text-base font-bold text-blue-700 dark:text-blue-300" data-testid="stat-farmers">
                      {summary.farmers}
                    </p>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs text-muted-foreground truncate">{t("exitsWithDue")}</p>
                    <p className="text-base font-bold text-amber-700 dark:text-amber-300" data-testid="stat-exits-due">
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
                  <p className="text-lg font-bold text-violet-700 dark:text-violet-300 truncate" data-testid="stat-bags-exited">
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
                  <p className="text-lg font-bold text-sky-700 dark:text-sky-400 truncate" data-testid="stat-cold-charges">
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
                  <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400 truncate" data-testid="stat-cash">
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
                  <p className="text-lg font-bold text-indigo-700 dark:text-indigo-400 truncate" data-testid="stat-account">
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
                  <p className="text-lg font-bold text-violet-700 dark:text-violet-400 truncate" data-testid="stat-discount">
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
                  <p className="text-lg font-bold text-rose-700 dark:text-rose-400 truncate" data-testid="stat-due">
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
                  <p className="text-lg font-bold text-orange-600 dark:text-orange-400 truncate" data-testid="stat-receivable-adj">
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
