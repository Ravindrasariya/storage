import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/queryClient";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Search, X, Pencil, Filter, Package, IndianRupee, Clock, Printer, LogOut } from "lucide-react";
import { EditSaleDialog } from "@/components/EditSaleDialog";
import { PrintBillDialog } from "@/components/PrintBillDialog";
import { ExitDialog } from "@/components/ExitDialog";
import type { SalesHistory } from "@shared/schema";
import { calculateTotalColdCharges } from "@shared/schema";
import { capitalizeFirstLetter } from "@/lib/utils";
import { Currency } from "@/components/Currency";

type FarmerRecord = {
  farmerName: string;
  village: string;
  tehsil: string;
  district: string;
  state: string;
  contactNumber: string;
};

export default function SalesHistoryPage() {
  const { t } = useI18n();
  
  const [yearFilter, setYearFilter] = useState<string>(new Date().getFullYear().toString());
  const [farmerFilter, setFarmerFilter] = useState("");
  const [selectedFarmerVillage, setSelectedFarmerVillage] = useState("");
  const [selectedFarmerMobile, setSelectedFarmerMobile] = useState("");
  const [mobileFilter, setMobileFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<string>("");
  const [buyerFilter, setBuyerFilter] = useState("");
  const [editingSale, setEditingSale] = useState<SalesHistory | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [printingSale, setPrintingSale] = useState<SalesHistory | null>(null);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [exitingSale, setExitingSale] = useState<SalesHistory | null>(null);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);

  // Autocomplete state
  const [showFarmerSuggestions, setShowFarmerSuggestions] = useState(false);
  const [showBuyerSuggestions, setShowBuyerSuggestions] = useState(false);
  const [showMobileSuggestions, setShowMobileSuggestions] = useState(false);

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

  // Filtered suggestions for mobile number
  const getMobileSuggestions = useMemo(() => {
    if (!farmerRecords || farmerRecords.length === 0 || !mobileFilter.trim()) return [];
    const query = mobileFilter.replace(/\D/g, '');
    if (!query) return [];
    return farmerRecords
      .filter(farmer => farmer.contactNumber.includes(query))
      .slice(0, 8);
  }, [farmerRecords, mobileFilter]);

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

  const selectMobileSuggestion = (farmer: FarmerRecord) => {
    setMobileFilter(farmer.contactNumber);
    setShowMobileSuggestions(false);
  };

  const buildQueryString = () => {
    const params = new URLSearchParams();
    if (yearFilter) params.append("year", yearFilter);
    if (farmerFilter) params.append("farmerName", farmerFilter);
    if (selectedFarmerVillage) params.append("village", selectedFarmerVillage);
    if (selectedFarmerMobile) params.append("contactNumber", selectedFarmerMobile);
    else if (mobileFilter) params.append("contactNumber", mobileFilter);
    if (paymentFilter) params.append("paymentStatus", paymentFilter);
    if (buyerFilter) params.append("buyerName", buyerFilter);
    return params.toString();
  };

  const { data: salesHistory = [], isLoading: historyLoading } = useQuery<SalesHistory[]>({
    queryKey: ["/api/sales-history", yearFilter, farmerFilter, selectedFarmerVillage, selectedFarmerMobile, mobileFilter, paymentFilter, buyerFilter],
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

  const handlePrintSale = (sale: SalesHistory) => {
    setPrintingSale(sale);
    setPrintDialogOpen(true);
  };

  const handleExitSale = (sale: SalesHistory) => {
    setExitingSale(sale);
    setExitDialogOpen(true);
  };

  const clearFilters = () => {
    setYearFilter("");
    setFarmerFilter("");
    setSelectedFarmerVillage("");
    setSelectedFarmerMobile("");
    setMobileFilter("");
    setPaymentFilter("");
    setBuyerFilter("");
  };

  const hasActiveFilters = yearFilter || farmerFilter || selectedFarmerVillage || mobileFilter || paymentFilter || buyerFilter;

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

  const summary = salesHistory.reduce(
    (acc, sale) => {
      acc.totalBags += sale.quantitySold || 0;
      // Calculate total charges including all surcharges
      const totalCharges = calculateTotalColdCharges(sale);
      // Use paidAmount from sale, calculate due as remainder to ensure consistency
      const salePaid = sale.paidAmount || 0;
      acc.amountPaid += salePaid;
      acc.amountDue += Math.max(0, totalCharges - salePaid);
      return acc;
    },
    { totalBags: 0, amountPaid: 0, amountDue: 0 }
  );

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold" data-testid="text-page-title">{t("salesHistory")}</h1>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            {t("filters")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">{t("filterByYear")}</label>
              <Select value={yearFilter} onValueChange={setYearFilter}>
                <SelectTrigger data-testid="select-year-filter">
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
                  value={farmerFilter}
                  onChange={(e) => {
                    setFarmerFilter(capitalizeFirstLetter(e.target.value));
                    setSelectedFarmerVillage("");
                    setSelectedFarmerMobile("");
                    setShowFarmerSuggestions(true);
                  }}
                  onFocus={() => setShowFarmerSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowFarmerSuggestions(false), 200)}
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
                        className="w-full px-3 py-2 text-left hover-elevate text-sm flex flex-col"
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

            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">{t("filterByMobile")}</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <Input
                  value={mobileFilter}
                  onChange={(e) => {
                    setMobileFilter(e.target.value);
                    setShowMobileSuggestions(true);
                  }}
                  onFocus={() => setShowMobileSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowMobileSuggestions(false), 200)}
                  placeholder={t("contactNumber")}
                  className="pl-10"
                  autoComplete="off"
                  data-testid="input-mobile-filter"
                />
                {showMobileSuggestions && getMobileSuggestions.length > 0 && mobileFilter && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                    {getMobileSuggestions.map((farmer, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className="w-full px-3 py-2 text-left hover-elevate text-sm flex flex-col"
                        onClick={() => selectMobileSuggestion(farmer)}
                        data-testid={`suggestion-mobile-${idx}`}
                      >
                        <span className="font-medium">{farmer.contactNumber}</span>
                        <span className="text-xs text-muted-foreground">{farmer.farmerName} • {farmer.village}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">{t("filterByBuyer")}</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <Input
                  value={buyerFilter}
                  onChange={(e) => {
                    setBuyerFilter(capitalizeFirstLetter(e.target.value));
                    setShowBuyerSuggestions(true);
                  }}
                  onFocus={() => setShowBuyerSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowBuyerSuggestions(false), 200)}
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
                        className="w-full px-3 py-2 text-left hover-elevate text-sm"
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

            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">{t("filterByPayment")}</label>
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

            <div className="flex items-end">
              {hasActiveFilters && (
                <Button variant="outline" onClick={clearFilters} className="w-full" data-testid="button-clear-filters">
                  <X className="h-4 w-4 mr-2" />
                  {t("clearFilters")}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Section */}
      {!historyLoading && salesHistory.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-4">
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
          ) : salesHistory.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground" data-testid="text-no-results">
              {t("noSalesHistory")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("saleDate")}</TableHead>
                    <TableHead>{t("farmerName")}</TableHead>
                    <TableHead>{t("contactNumber")}</TableHead>
                    <TableHead>{t("lotNo")}</TableHead>
                    <TableHead className="text-right">{t("originalBags")}</TableHead>
                    <TableHead>{t("bagType")}</TableHead>
                    <TableHead>{t("saleType")}</TableHead>
                    <TableHead className="text-right">{t("quantitySold")}</TableHead>
                    <TableHead className="text-right">{t("totalColdStorageCharges")}</TableHead>
                    <TableHead>{t("buyerName")}</TableHead>
                    <TableHead className="text-right">{t("pricePerKg")}</TableHead>
                    <TableHead>{t("paymentStatus")}</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salesHistory.map((sale) => (
                    <TableRow key={sale.id} data-testid={`row-sale-${sale.id}`}>
                      <TableCell className="whitespace-nowrap">
                        {format(new Date(sale.soldAt), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell className="font-medium">{sale.farmerName}</TableCell>
                      <TableCell>{sale.contactNumber}</TableCell>
                      <TableCell>{sale.lotNo}</TableCell>
                      <TableCell className="text-right">{sale.originalLotSize}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {t(sale.bagType)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={sale.saleType === "full" ? "default" : "secondary"}>
                          {sale.saleType === "full" ? t("fullSale") : t("partialSale")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{sale.quantitySold}</TableCell>
                      <TableCell className="text-right font-medium">
                        <Currency amount={calculateTotalColdCharges(sale)} />
                      </TableCell>
                      <TableCell>{sale.buyerName || "-"}</TableCell>
                      <TableCell className="text-right">
                        {sale.pricePerKg ? <><Currency amount={sale.pricePerKg} />/kg</> : "-"}
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
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleExitSale(sale)}
                            data-testid={`button-exit-sale-${sale.id}`}
                          >
                            <LogOut className="h-4 w-4 mr-1" />
                            {t("exit")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handlePrintSale(sale)}
                            data-testid={`button-print-sale-${sale.id}`}
                          >
                            <Printer className="h-4 w-4 mr-1" />
                            {t("print")}
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

      {salesHistory.length > 0 && (
        <div className="flex justify-between items-center text-sm text-muted-foreground">
          <span>
            {salesHistory.length} {salesHistory.length === 1 ? "sale" : "sales"} found
          </span>
          <div className="flex gap-4">
            <span className="text-green-600">
              {t("paid")}: {salesHistory.filter(s => s.paymentStatus === "paid").length}
            </span>
            <span className="text-blue-600">
              {t("partial")}: {salesHistory.filter(s => s.paymentStatus === "partial").length}
            </span>
            <span className="text-amber-600">
              {t("due")}: {salesHistory.filter(s => s.paymentStatus === "due").length}
            </span>
          </div>
        </div>
      )}

      <EditSaleDialog 
        sale={editingSale}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
      />

      {printingSale && (
        <PrintBillDialog 
          sale={printingSale}
          open={printDialogOpen}
          onOpenChange={setPrintDialogOpen}
        />
      )}

      <ExitDialog 
        sale={exitingSale}
        open={exitDialogOpen}
        onOpenChange={setExitDialogOpen}
      />
    </div>
  );
}
