import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LotCard } from "@/components/LotCard";
import { EditHistoryAccordion } from "@/components/EditHistoryAccordion";
import { PrintEntryReceiptDialog } from "@/components/PrintEntryReceiptDialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, authFetch } from "@/lib/queryClient";
import { ArrowLeft, Search, Phone, Package, Filter, User, ArrowUpDown, X, Download, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import type { Lot, Chamber, LotEditHistory, SalesHistory } from "@shared/schema";
import { calculateTotalColdCharges } from "@shared/schema";
import { capitalizeFirstLetter } from "@/lib/utils";
import { Currency } from "@/components/Currency";

// Helper to get saved search state from sessionStorage
const getSavedSearchState = () => {
  try {
    const saved = sessionStorage.getItem("stockRegisterState");
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    // Ignore parse errors
  }
  return null;
};

export default function StockRegister() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { canEdit } = useAuth();
  const currentYear = new Date().getFullYear();
  
  // Load initial state from sessionStorage if available
  const savedState = getSavedSearchState();
  
  const [selectedYear, setSelectedYear] = useState<number>(savedState?.selectedYear || currentYear);

  // Fetch available years for filtering
  const { data: availableYears } = useQuery<number[]>({
    queryKey: ["/api/analytics/years"],
  });

  // Generate year options: available years + current year
  const yearOptions = availableYears 
    ? Array.from(new Set([...availableYears, currentYear])).sort((a, b) => b - a)
    : [currentYear];

  const [searchType, setSearchType] = useState<"phone" | "lotNoSize" | "filter" | "farmerName">(
    savedState?.searchType || "phone"
  );
  const [farmerNameQuery, setFarmerNameQuery] = useState(savedState?.farmerNameQuery || "");
  const [selectedFarmerVillage, setSelectedFarmerVillage] = useState(savedState?.selectedFarmerVillage || "");
  const [selectedFarmerMobile, setSelectedFarmerMobile] = useState(savedState?.selectedFarmerMobile || "");
  const [searchQuery, setSearchQuery] = useState(savedState?.searchQuery || "");
  const [lotNoFrom, setLotNoFrom] = useState(savedState?.lotNoFrom || "");
  const [lotNoTo, setLotNoTo] = useState(savedState?.lotNoTo || "");
  const [sizeQuery, setSizeQuery] = useState(savedState?.sizeQuery || "");
  const [qualityFilter, setQualityFilter] = useState<string>(savedState?.qualityFilter || "all");
  const [potatoTypeFilter, setPotatoTypeFilter] = useState<string>(savedState?.potatoTypeFilter || "all");
  const [paymentDueFilter, setPaymentDueFilter] = useState(savedState?.paymentDueFilter || false);
  const [bagTypeFilter, setBagTypeFilter] = useState<"all" | "wafer" | "Ration" | "seed">(savedState?.bagTypeFilter || "all");
  const [searchResults, setSearchResults] = useState<Lot[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [sortBy, setSortBy] = useState<"lotNo" | "chargeDue" | "remainingBags">("lotNo");

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedLot, setSelectedLot] = useState<Lot | null>(null);
  const [editHistory, setEditHistory] = useState<LotEditHistory[]>([]);
  const [printReceiptDialogOpen, setPrintReceiptDialogOpen] = useState(false);
  const [printReceiptLot, setPrintReceiptLot] = useState<Lot | null>(null);

  const [editForm, setEditForm] = useState<{
    chamberId: string;
    floor: number;
    position: string;
    quality: string;
    netWeight?: number;
    lotNo: string;
    farmerName: string;
    village: string;
    tehsil: string;
    district: string;
    state: string;
    contactNumber: string;
  } | null>(null);
  const [lotNoError, setLotNoError] = useState<string | null>(null);

  // Autocomplete state for search fields
  const [showPhoneSuggestions, setShowPhoneSuggestions] = useState(false);
  const [showFarmerNameSuggestions, setShowFarmerNameSuggestions] = useState(false);

  // Farmer records for autocomplete
  type FarmerRecord = {
    farmerName: string;
    village: string;
    tehsil: string;
    district: string;
    state: string;
    contactNumber: string;
  };

  const { data: farmerRecords } = useQuery<FarmerRecord[]>({
    queryKey: ["/api/farmers/lookup"],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const { data: chambers } = useQuery<Chamber[]>({
    queryKey: ["/api/chambers"],
  });

  // Fetch cold storage settings to get rates
  type ColdStorageSettings = {
    name: string;
    waferRate: number;
    seedRate: number;
    waferColdCharge: number;
    waferHammali: number;
    seedColdCharge: number;
    seedHammali: number;
    chargeUnit: "bag" | "quintal";
  };
  const { data: coldStorage } = useQuery<ColdStorageSettings>({
    queryKey: ["/api/cold-storage"],
  });

  // Infinite scroll state
  const PAGE_SIZE = 50;
  const [displayedLots, setDisplayedLots] = useState<Lot[]>([]);
  const [totalLotCount, setTotalLotCount] = useState<number>(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loaderRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Fetch initial lots sorted by lot number for display before any search
  const { data: initialLotsData, isLoading: isLoadingInitial } = useQuery<{ lots: Lot[], totalCount: number }>({
    queryKey: ["/api/lots", { sort: "lotNo", limit: PAGE_SIZE, offset: 0 }],
    queryFn: async () => {
      const response = await authFetch(`/api/lots?sort=lotNo&limit=${PAGE_SIZE}&offset=0`);
      if (!response.ok) throw new Error("Failed to fetch initial lots");
      return response.json();
    },
  });

  // Update displayedLots when initial data loads or when search is cleared
  useEffect(() => {
    if (initialLotsData && !hasSearched) {
      // Reset to initial data when not searching
      setDisplayedLots(initialLotsData.lots);
      setTotalLotCount(initialLotsData.totalCount);
    }
  }, [initialLotsData, hasSearched]);

  // Load more lots for infinite scroll
  const loadMoreLots = useCallback(async () => {
    if (isLoadingMore || hasSearched || displayedLots.length >= totalLotCount) return;
    
    setIsLoadingMore(true);
    try {
      const offset = displayedLots.length;
      const response = await authFetch(`/api/lots?sort=lotNo&limit=${PAGE_SIZE}&offset=${offset}`);
      if (!response.ok) throw new Error("Failed to fetch more lots");
      const data: { lots: Lot[], totalCount: number } = await response.json();
      setDisplayedLots(prev => [...prev, ...data.lots]);
      setTotalLotCount(data.totalCount);
    } catch (error) {
      console.error("Failed to load more lots:", error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasSearched, displayedLots.length, totalLotCount]);

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (hasSearched) return; // Don't use infinite scroll when search results are shown
    
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && displayedLots.length < totalLotCount) {
          loadMoreLots();
        }
      },
      { 
        threshold: 0.1,
        root: scrollContainerRef.current // Use scroll container as root for proper detection
      }
    );

    const currentLoader = loaderRef.current;
    if (currentLoader) {
      observer.observe(currentLoader);
    }

    return () => {
      if (currentLoader) {
        observer.unobserve(currentLoader);
      }
    };
  }, [hasSearched, displayedLots.length, totalLotCount, loadMoreLots]);

  // For backward compatibility - alias to keep existing code working
  const initialLots = displayedLots;

  // Fetch all sales to calculate charges from sales history (same as Analytics)
  const { data: allSalesHistory } = useQuery<SalesHistory[]>({
    queryKey: ["/api/sales-history"],
  });

  // Fetch summary totals for ALL lots (used when no filter is applied)
  const { data: allLotsSummary } = useQuery<{
    totalBags: number;
    remainingBags: number;
    chargesPaid: number;
    chargesDue: number;
    expectedColdCharges: number;
  }>({
    queryKey: ["/api/lots/summary"],
  });

  // Calculate charges for selected lot from sales history (same calculation as Analytics)
  const selectedLotCharges = useMemo(() => {
    if (!selectedLot || !allSalesHistory) return { totalPaid: 0, totalDue: 0 };
    
    const lotSales = allSalesHistory.filter(s => s.lotId === selectedLot.id);
    
    let totalPaid = 0;
    let totalDue = 0;
    
    for (const sale of lotSales) {
      const totalCharges = calculateTotalColdCharges(sale);
      
      if (sale.paymentStatus === "paid") {
        totalPaid += totalCharges;
      } else if (sale.paymentStatus === "due") {
        totalDue += totalCharges;
      } else if (sale.paymentStatus === "partial") {
        // Use paidAmount from sale, calculate due as remainder to ensure consistency
        const paidAmount = sale.paidAmount || 0;
        totalPaid += paidAmount;
        totalDue += Math.max(0, totalCharges - paidAmount);
      }
    }
    
    return { totalPaid, totalDue };
  }, [selectedLot, allSalesHistory]);

  const isInitialMount = useRef(true);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced auto-search effect
  useEffect(() => {
    if (isInitialMount.current) return;
    
    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    // Check if we have enough input to search
    const hasInput = 
      (searchType === "phone" && searchQuery.trim().length >= 3) ||
      (searchType === "farmerName" && farmerNameQuery.trim().length >= 2) ||
      (searchType === "lotNoSize" && (lotNoFrom.trim() || lotNoTo.trim() || sizeQuery.trim())) ||
      (searchType === "filter" && (qualityFilter !== "all" || potatoTypeFilter !== "all" || paymentDueFilter));
    
    if (hasInput) {
      // Debounce search by 300ms
      searchTimeoutRef.current = setTimeout(() => {
        handleSearch();
      }, 300);
    }
    
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, farmerNameQuery, selectedFarmerVillage, selectedFarmerMobile, lotNoFrom, lotNoTo, sizeQuery, searchType, qualityFilter, potatoTypeFilter, paymentDueFilter, selectedYear]);

  // Save search input state to sessionStorage (not results or hasSearched - those reset on page load)
  useEffect(() => {
    const stateToSave = {
      searchType,
      farmerNameQuery,
      selectedFarmerVillage,
      selectedFarmerMobile,
      searchQuery,
      lotNoFrom,
      lotNoTo,
      sizeQuery,
      qualityFilter,
      potatoTypeFilter,
      paymentDueFilter,
      bagTypeFilter,
      selectedYear,
    };
    sessionStorage.setItem("stockRegisterState", JSON.stringify(stateToSave));
  }, [searchType, farmerNameQuery, selectedFarmerVillage, selectedFarmerMobile, searchQuery, lotNoFrom, lotNoTo, sizeQuery, qualityFilter, potatoTypeFilter, paymentDueFilter, bagTypeFilter, selectedYear]);
  
  // Mark initial mount as complete after first render and trigger search if there's saved state
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      
      // Check if we have saved search state that should trigger a search
      // Use savedState directly to avoid closure issues
      const saved = getSavedSearchState();
      if (saved) {
        const hasValidQuery = 
          (saved.searchType === "phone" && saved.searchQuery?.trim().length >= 3) ||
          (saved.searchType === "farmerName" && saved.farmerNameQuery?.trim().length >= 2) ||
          (saved.searchType === "lotNoSize" && (saved.lotNoFrom?.trim() || saved.lotNoTo?.trim() || saved.sizeQuery?.trim())) ||
          (saved.searchType === "filter" && (saved.qualityFilter !== "all" || saved.potatoTypeFilter !== "all" || saved.paymentDueFilter));
        
        if (hasValidQuery) {
          // Trigger search with saved state - use setTimeout to ensure state is fully initialized
          setTimeout(() => handleSearch(), 0);
        }
      }
    }
  }, []);

  // Reset to initial view when search inputs are cleared
  useEffect(() => {
    if (hasSearched) {
      const inputEmpty = 
        (searchType === "phone" && !searchQuery.trim()) ||
        (searchType === "farmerName" && !farmerNameQuery.trim()) ||
        (searchType === "lotNoSize" && !lotNoFrom.trim() && !lotNoTo.trim() && !sizeQuery.trim()) ||
        (searchType === "filter" && qualityFilter === "all" && potatoTypeFilter === "all" && !paymentDueFilter);
      
      if (inputEmpty) {
        setHasSearched(false);
        setSearchResults([]);
        // Also clear farmer-specific filter when resetting
        if (searchType === "farmerName") {
          setSelectedFarmerVillage("");
          setSelectedFarmerMobile("");
        }
      }
    }
  }, [searchQuery, farmerNameQuery, selectedFarmerVillage, selectedFarmerMobile, lotNoFrom, lotNoTo, sizeQuery, qualityFilter, paymentDueFilter, searchType, hasSearched]);


  const chamberMap = chambers?.reduce((acc, chamber) => {
    acc[chamber.id] = chamber.name;
    return acc;
  }, {} as Record<string, string>) || {};

  // Get unique potato types from all lots for the filter dropdown
  const uniquePotatoTypes = useMemo(() => {
    const lots = initialLots || [];
    const types = new Set<string>();
    for (const lot of lots) {
      if (lot.type) types.add(lot.type);
    }
    return Array.from(types).sort();
  }, [initialLots]);

  // Filtered suggestions for phone number search
  const getPhoneSuggestions = useMemo(() => {
    if (!farmerRecords || farmerRecords.length === 0 || !searchQuery.trim()) return [];
    const phoneVal = searchQuery.trim();
    return farmerRecords
      .filter(farmer => farmer.contactNumber.includes(phoneVal))
      .slice(0, 8);
  }, [farmerRecords, searchQuery]);

  // Filtered suggestions for farmer name search
  const getFarmerNameSuggestions = useMemo(() => {
    if (!farmerRecords || farmerRecords.length === 0 || !farmerNameQuery.trim()) return [];
    const nameVal = farmerNameQuery.toLowerCase().trim();
    return farmerRecords
      .filter(farmer => farmer.farmerName.toLowerCase().includes(nameVal))
      .slice(0, 8);
  }, [farmerRecords, farmerNameQuery]);

  // Select a farmer from suggestions and populate search field
  const selectPhoneSuggestion = (farmer: FarmerRecord) => {
    setSearchQuery(farmer.contactNumber);
    setShowPhoneSuggestions(false);
  };

  const selectFarmerNameSuggestion = (farmer: FarmerRecord) => {
    setFarmerNameQuery(farmer.farmerName);
    setSelectedFarmerVillage(farmer.village);
    setSelectedFarmerMobile(farmer.contactNumber);
    setShowFarmerNameSuggestions(false);
  };

  // Helper to get rate for a lot based on bag type (Ration uses seed rates)
  const getRateForLot = (lot: Lot) => {
    if (!coldStorage) return 0;
    const useWaferRate = lot.bagType === "wafer";
    return useWaferRate ? coldStorage.waferRate : coldStorage.seedRate;
  };

  // Calculate summary totals from sales history for consistency with Analytics
  const summaryTotals = useMemo(() => {
    // When no filter is active (no search, bagType = all), use the API summary for ALL lots
    const noFilterActive = !hasSearched && bagTypeFilter === "all";
    if (noFilterActive && allLotsSummary) {
      return allLotsSummary;
    }
    
    // Use search results if searched, otherwise use initial lots
    const baseLots = hasSearched ? searchResults : (initialLots || []);
    if (baseLots.length === 0) return null;
    
    // Apply bag type filter for summary calculation
    const filteredResults = bagTypeFilter === "all" 
      ? baseLots 
      : baseLots.filter(lot => lot.bagType === bagTypeFilter);
    
    if (filteredResults.length === 0) return null;
    
    const lotIds = new Set(filteredResults.map(lot => lot.id));
    
    let chargesPaid = 0;
    let chargesDue = 0;
    
    // Calculate from sales history using persisted values (same as API summary endpoint)
    if (allSalesHistory) {
      for (const sale of allSalesHistory) {
        if (!lotIds.has(sale.lotId)) continue;
        chargesPaid += sale.paidAmount || 0;
        chargesDue += sale.dueAmount || 0;
      }
    }
    
    // Calculate expected cold charges based on charge unit mode
    const expectedColdCharges = filteredResults.reduce((sum, lot) => {
      const useWaferRate = lot.bagType === "wafer";
      const coldChargeRate = useWaferRate 
        ? (coldStorage?.waferColdCharge || 0) 
        : (coldStorage?.seedColdCharge || 0);
      const hammaliRate = useWaferRate
        ? (coldStorage?.waferHammali || 0)
        : (coldStorage?.seedHammali || 0);
      // For quintal mode: cold charge (per quintal) + hammali (per bag)
      // For bag mode: (coldCharge + hammali) × lot.size
      let lotCharge: number;
      if (coldStorage?.chargeUnit === "quintal") {
        const coldChargeQuintal = lot.netWeight ? (lot.netWeight * coldChargeRate) / 100 : 0;
        const hammaliPerBag = lot.size * hammaliRate;
        lotCharge = coldChargeQuintal + hammaliPerBag;
      } else {
        lotCharge = lot.size * (coldChargeRate + hammaliRate);
      }
      return sum + lotCharge;
    }, 0);
    
    return {
      totalBags: filteredResults.reduce((sum, lot) => sum + lot.size, 0),
      remainingBags: filteredResults.reduce((sum, lot) => sum + lot.remainingSize, 0),
      chargesPaid,
      chargesDue,
      expectedColdCharges,
    };
  }, [hasSearched, searchResults, initialLots, allSalesHistory, bagTypeFilter, coldStorage, allLotsSummary]);

  // Detect if any filter/search is active
  const isFilterActive = useMemo(() => {
    if (hasSearched) return true;
    if (bagTypeFilter !== "all") return true;
    return false;
  }, [hasSearched, bagTypeFilter]);

  // Get the currently displayed lots for export
  const getDisplayedLots = useMemo(() => {
    const rawLots = hasSearched ? searchResults : (initialLots || []);
    return bagTypeFilter === "all" 
      ? rawLots 
      : rawLots.filter(lot => lot.bagType === bagTypeFilter);
  }, [hasSearched, searchResults, initialLots, bagTypeFilter]);

  // Export filtered results to CSV
  const [isExporting, setIsExporting] = useState(false);
  
  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      // When no filter is applied, fetch ALL lots for export (not just displayed ones)
      let lots: Lot[];
      if (!hasSearched && bagTypeFilter === "all") {
        // Fetch all lots without limit for export
        const response = await authFetch("/api/lots?sort=lotNo");
        if (!response.ok) throw new Error("Failed to fetch lots for export");
        const data = await response.json();
        lots = data.lots;
      } else {
        // Use the displayed/filtered lots
        lots = getDisplayedLots;
      }
      
      if (lots.length === 0) {
        toast({
          title: t("noResults"),
          variant: "destructive",
        });
        return;
      }

      // Build CSV content
      const headers = [
        "Lot No",
        "Farmer Name",
        "Contact Number",
        "Village",
        "Tehsil",
        "District",
        "Chamber",
        "Floor",
        "Position",
        "Potato Type",
        "Potato Variety",
        "Bag type",
        "Quality",
        "Potato Size",
        "Original Size",
        "Remaining Size",
        "Sale Status",
        "Expected Cold Charges",
        "Cold Storage Charges",
        "Paid Cold Charges",
        "Due Cold Charges",
      ];

      const rows = lots.map(lot => {
        // Calculate expected cold charge based on charge unit mode
        const useWaferRate = lot.bagType === "wafer";
        const coldChargeRate = useWaferRate 
          ? (coldStorage?.waferColdCharge || 0) 
          : (coldStorage?.seedColdCharge || 0);
        const hammaliRate = useWaferRate
          ? (coldStorage?.waferHammali || 0)
          : (coldStorage?.seedHammali || 0);
        // For quintal mode: cold charge (per quintal) + hammali (per bag)
        // For bag mode: (coldCharge + hammali) × lot.size
        let expectedColdCharge: number;
        if (coldStorage?.chargeUnit === "quintal") {
          const coldChargeQuintal = lot.netWeight ? (lot.netWeight * coldChargeRate) / 100 : 0;
          const hammaliPerBag = lot.size * hammaliRate;
          expectedColdCharge = coldChargeQuintal + hammaliPerBag;
        } else {
          expectedColdCharge = lot.size * (coldChargeRate + hammaliRate);
        }
        
        const paidCharge = lot.totalPaidCharge || 0;
        const dueCharge = lot.totalDueCharge || 0;
        const totalBilledCharge = paidCharge + dueCharge;
        return [
          lot.lotNo,
          lot.farmerName,
          lot.contactNumber,
          lot.village,
          lot.tehsil,
          lot.district,
          chamberMap[lot.chamberId] || lot.chamberId,
          lot.floor,
          lot.position,
          lot.bagType,
          lot.type,
          lot.bagTypeLabel || "",
          lot.quality,
          lot.potatoSize,
          lot.size,
          lot.remainingSize,
          lot.saleStatus || "stored",
          expectedColdCharge.toFixed(1),
          totalBilledCharge.toFixed(1),
          paidCharge.toFixed(1),
          dueCharge.toFixed(1),
        ];
      });

      const csvContent = [
        headers.join(","),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      ].join("\n");

      // Trigger download
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `stock_register_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: t("downloadSuccess") || "Download successful",
        description: `${lots.length} ${t("lots")} exported`,
      });
    } catch (error) {
      console.error("Export failed:", error);
      toast({
        title: t("error") || "Error",
        description: t("exportFailed") || "Failed to export data",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrintFiltered = () => {
    const lots = getDisplayedLots;
    if (lots.length === 0 || !summaryTotals) {
      toast({
        title: t("noResults"),
        variant: "destructive",
      });
      return;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast({
        title: "Unable to open print window",
        variant: "destructive",
      });
      return;
    }

    const coldStoreName = coldStorage?.name || "Cold Storage";
    const formatCurrency = (amount: number) => `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

    const lotCards = lots.map((lot) => {
      let lotPaidCharge = 0;
      let lotDueCharge = 0;
      if (allSalesHistory) {
        const lotSales = allSalesHistory.filter(s => s.lotId === lot.id);
        for (const sale of lotSales) {
          const totalCharges = calculateTotalColdCharges(sale);
          if (sale.paymentStatus === "paid") {
            lotPaidCharge += totalCharges;
          } else if (sale.paymentStatus === "due") {
            lotDueCharge += totalCharges;
          } else if (sale.paymentStatus === "partial") {
            const paidAmount = sale.paidAmount || 0;
            lotPaidCharge += paidAmount;
            lotDueCharge += Math.max(0, totalCharges - paidAmount);
          }
        }
      }
      const useWaferRate = lot.bagType === "wafer";
      const coldChargeRate = useWaferRate 
        ? (coldStorage?.waferColdCharge || 0) 
        : (coldStorage?.seedColdCharge || 0);
      const hammaliRate = useWaferRate
        ? (coldStorage?.waferHammali || 0)
        : (coldStorage?.seedHammali || 0);
      let expectedColdCharge: number;
      if (coldStorage?.chargeUnit === "quintal") {
        const coldChargeQuintal = lot.netWeight ? (lot.netWeight * coldChargeRate) / 100 : 0;
        const hammaliPerBag = lot.size * hammaliRate;
        expectedColdCharge = coldChargeQuintal + hammaliPerBag;
      } else {
        expectedColdCharge = lot.size * (coldChargeRate + hammaliRate);
      }
      const chamberName = chamberMap[lot.chamberId] || "Unknown";

      return `
        <div class="lot-card">
          <div class="lot-header">
            <span class="farmer-name">${lot.farmerName}</span>
            <span class="lot-badges">
              ${lot.quality ? `<span class="badge quality-${lot.quality}">${t(lot.quality) || lot.quality}</span>` : ''}
              ${lot.bagType ? `<span class="badge">${lot.bagTypeLabel || t(lot.bagType) || lot.bagType}</span>` : ''}
              ${lot.potatoSize ? `<span class="badge">${t(lot.potatoSize) || lot.potatoSize}</span>` : ''}
            </span>
          </div>
          <div class="lot-details">
            <div class="detail-row">
              <span class="label">Lot No:</span>
              <span class="value">${lot.lotNo}</span>
              <span class="label">Phone:</span>
              <span class="value">${lot.contactNumber || "-"}</span>
            </div>
            <div class="detail-row">
              <span class="label">Village:</span>
              <span class="value">${lot.village || "-"}</span>
              <span class="label">Chamber:</span>
              <span class="value">${chamberName} - Floor ${lot.floor}, Pos ${lot.position}</span>
            </div>
            <div class="detail-row">
              <span class="label">Potato Variety:</span>
              <span class="value">${lot.type || "-"}</span>
              <span class="label">Bag Type:</span>
              <span class="value">${lot.bagTypeLabel || lot.bagType || "-"}</span>
            </div>
            <div class="detail-row">
              <span class="label">Original Size:</span>
              <span class="value">${lot.size} bags</span>
              <span class="label">Remaining:</span>
              <span class="value">${lot.remainingSize} bags</span>
            </div>
            <div class="charges-row">
              <span><strong>Expected Charges:</strong> <span class="blue">${formatCurrency(expectedColdCharge)}</span></span>
              <span><strong>Paid:</strong> <span class="green">${formatCurrency(lotPaidCharge)}</span></span>
              <span><strong>Due:</strong> <span class="red">${formatCurrency(lotDueCharge)}</span></span>
            </div>
          </div>
        </div>
      `;
    }).join("");

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${coldStoreName} - Farmer Lot Details</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 20px; color: #333; }
          .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 15px; }
          .main-title { font-size: 24px; font-weight: bold; margin-bottom: 5px; }
          .sub-title { font-size: 16px; color: #666; }
          .print-date { font-size: 12px; color: #999; margin-top: 5px; }
          .summary-card { background: #f5f5f5; border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin-bottom: 20px; }
          .summary-title { font-weight: bold; margin-bottom: 10px; }
          .summary-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; text-align: center; }
          .summary-item { display: flex; flex-direction: column; }
          .summary-label { font-size: 12px; color: #666; }
          .summary-value { font-size: 16px; font-weight: bold; }
          .blue { color: #2563eb; }
          .green { color: #16a34a; }
          .red { color: #dc2626; }
          .lot-card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin-bottom: 12px; page-break-inside: avoid; }
          .lot-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
          .farmer-name { font-size: 16px; font-weight: bold; }
          .lot-badges { display: flex; gap: 5px; }
          .badge { background: #e5e7eb; padding: 2px 8px; border-radius: 4px; font-size: 11px; text-transform: capitalize; }
          .quality-good { background: #dcfce7; color: #166534; }
          .quality-medium { background: #fef3c7; color: #92400e; }
          .quality-poor { background: #fee2e2; color: #991b1b; }
          .lot-details { font-size: 13px; }
          .detail-row { display: grid; grid-template-columns: 100px 1fr 100px 1fr; gap: 5px; margin-bottom: 5px; }
          .label { color: #666; }
          .value { font-weight: 500; }
          .charges-row { display: flex; gap: 20px; margin-top: 10px; padding-top: 8px; border-top: 1px solid #eee; font-size: 13px; }
          @media print {
            body { padding: 10px; }
            .lot-card { break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="main-title">${coldStoreName}</div>
          <div class="sub-title">Farmer Lot Details</div>
          <div class="print-date">Printed On: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN')}</div>
        </div>
        
        <div class="summary-card">
          <div class="summary-title">Search Summary:</div>
          <div class="summary-grid">
            <div class="summary-item">
              <span class="summary-label">Total Bags</span>
              <span class="summary-value">${summaryTotals.totalBags.toLocaleString('en-IN')}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Remaining Bags</span>
              <span class="summary-value">${summaryTotals.remainingBags.toLocaleString('en-IN')}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Total Expected Billed Charges</span>
              <span class="summary-value blue">${formatCurrency(summaryTotals.expectedColdCharges)}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Charges Paid</span>
              <span class="summary-value green">${formatCurrency(summaryTotals.chargesPaid)}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Charges Due</span>
              <span class="summary-value red">${formatCurrency(summaryTotals.chargesDue)}</span>
            </div>
          </div>
        </div>

        <div class="lots-container">
          ${lotCards}
        </div>

        <script>
          window.onload = function() {
            window.print();
          }
        </script>
      </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  const handleSearch = async () => {
    if (searchType === "phone" && !searchQuery.trim()) return;
    if (searchType === "lotNoSize" && !lotNoFrom.trim() && !lotNoTo.trim() && !sizeQuery.trim()) return;
    if (searchType === "filter" && qualityFilter === "all" && potatoTypeFilter === "all" && !paymentDueFilter) return;
    if (searchType === "farmerName" && !farmerNameQuery.trim()) return;
    
    setIsSearching(true);
    setHasSearched(true);
    
    try {
      let url: string;
      if (searchType === "filter") {
        url = `/api/lots/search?type=filter&year=${selectedYear}`;
      } else if (searchType === "lotNoSize") {
        url = `/api/lots/search?type=lotNoSize&lotNoFrom=${encodeURIComponent(lotNoFrom)}&lotNoTo=${encodeURIComponent(lotNoTo)}&size=${encodeURIComponent(sizeQuery)}&year=${selectedYear}`;
      } else if (searchType === "farmerName") {
        url = `/api/lots/search?type=farmerName&query=${encodeURIComponent(farmerNameQuery)}&year=${selectedYear}`;
        if (selectedFarmerVillage) {
          url += `&village=${encodeURIComponent(selectedFarmerVillage)}`;
        }
        if (selectedFarmerMobile) {
          url += `&contactNumber=${encodeURIComponent(selectedFarmerMobile)}`;
        }
      } else {
        url = `/api/lots/search?type=${searchType}&query=${encodeURIComponent(searchQuery)}&year=${selectedYear}`;
      }
      
      if (qualityFilter && qualityFilter !== "all") {
        url += `&quality=${encodeURIComponent(qualityFilter)}`;
      }
      if (potatoTypeFilter && potatoTypeFilter !== "all") {
        url += `&potatoType=${encodeURIComponent(potatoTypeFilter)}`;
      }
      if (paymentDueFilter) {
        url += `&paymentDue=true`;
      }
      
      const response = await authFetch(url);
      if (response.ok) {
        const data = await response.json();
        const sortedData = [...data].sort((a: Lot, b: Lot) => {
          const lotNoA = parseInt(a.lotNo, 10) || 0;
          const lotNoB = parseInt(b.lotNo, 10) || 0;
          return lotNoA - lotNoB;
        });
        setSearchResults(sortedData);
      } else {
        setSearchResults([]);
      }
    } catch (error) {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleEditClick = async (lot: Lot) => {
    setSelectedLot(lot);
    setEditForm({
      chamberId: lot.chamberId,
      floor: lot.floor,
      position: lot.position || "",
      quality: lot.quality,
      netWeight: lot.netWeight || undefined,
      lotNo: lot.lotNo,
      farmerName: lot.farmerName,
      village: lot.village || "",
      tehsil: lot.tehsil || "",
      district: lot.district || "",
      state: lot.state || "",
      contactNumber: lot.contactNumber || "",
    });
    setLotNoError(null);

    try {
      const response = await authFetch(`/api/lots/${lot.id}/history`);
      if (response.ok) {
        const data = await response.json();
        setEditHistory(data);
      }
    } catch (error) {
      setEditHistory([]);
    }

    setEditDialogOpen(true);
  };

  const updateLotMutation = useMutation({
    mutationFn: async (data: { id: string; updates: Partial<Lot>; silent?: boolean }) => {
      return apiRequest("PATCH", `/api/lots/${data.id}`, data.updates);
    },
    onSuccess: async (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/lots"] });
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("/api/dashboard/stats") });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/merchants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/quality"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/chambers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/farmers/lookup"] });
      queryClient.invalidateQueries({ queryKey: ["/api/up-for-sale"] });
      if (!variables.silent) {
        toast({
          title: t("success"),
          description: "Lot updated successfully",
          variant: "success",
        });
        // Update the selected lot with new values to reflect changes in the dialog
        if (selectedLot && editForm) {
          setSelectedLot({ ...selectedLot, ...editForm });
          // Refresh edit history
          try {
            const response = await authFetch(`/api/lots/${selectedLot.id}/history`);
            if (response.ok) {
              const data = await response.json();
              setEditHistory(data);
            }
          } catch (error) {
            // Ignore history fetch errors
          }
        }
      }
      handleSearch();
    },
    onError: (error: Error) => {
      toast({
        title: t("error"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleToggleSale = (lot: Lot, upForSale: boolean) => {
    updateLotMutation.mutate({
      id: lot.id,
      updates: { upForSale: upForSale ? 1 : 0 },
      silent: true,
    });
  };

  const handleEditSubmit = async () => {
    if (!selectedLot || !editForm) return;
    
    // Validate lot number if it changed
    if (editForm.lotNo !== selectedLot.lotNo) {
      const newLotNo = parseInt(editForm.lotNo, 10);
      if (isNaN(newLotNo) || newLotNo < 1) {
        setLotNoError(t("invalidLotNumber") || "Invalid lot number");
        return;
      }
      
      // Check for duplicates - same lot number, same bag type category, different lot
      try {
        const response = await authFetch(`/api/lots/check-lot-number?lotNo=${newLotNo}&bagType=${selectedLot.bagType}&excludeId=${selectedLot.id}`);
        if (response.ok) {
          const result = await response.json();
          if (result.isDuplicate) {
            setLotNoError(t("duplicateLotNumber") || `Lot #${newLotNo} already exists for this bag type`);
            return;
          }
        }
      } catch (error) {
        console.error("Error checking lot number:", error);
      }
    }
    
    updateLotMutation.mutate({
      id: selectedLot.id,
      updates: editForm,
    });
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">{t("stockRegister")}</h1>
            <p className="text-muted-foreground mt-1">
              Find and manage lot details
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={selectedYear.toString()}
            onValueChange={(value) => setSelectedYear(parseInt(value, 10))}
          >
            <SelectTrigger className="w-24" data-testid="select-year-filter">
              <SelectValue placeholder={t("year") || "Year"} />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((year) => (
                <SelectItem key={year} value={year.toString()}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToggleGroup
            type="single"
            value={bagTypeFilter}
            onValueChange={(value) => value && setBagTypeFilter(value as typeof bagTypeFilter)}
            className="w-full sm:w-auto justify-between sm:justify-end bg-muted rounded-md p-1"
          >
          <ToggleGroupItem 
            value="all" 
            size="sm" 
            data-testid="toggle-bagtype-all"
            className="flex-1 sm:flex-none data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            {t("all")}
          </ToggleGroupItem>
          <ToggleGroupItem 
            value="wafer" 
            size="sm" 
            data-testid="toggle-bagtype-wafer"
            className="flex-1 sm:flex-none data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            {t("wafer")}
          </ToggleGroupItem>
          <ToggleGroupItem 
            value="Ration" 
            size="sm" 
            data-testid="toggle-bagtype-ration"
            className="flex-1 sm:flex-none data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            {t("ration")}
          </ToggleGroupItem>
          <ToggleGroupItem 
            value="seed" 
            size="sm" 
            data-testid="toggle-bagtype-seed"
            className="flex-1 sm:flex-none data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            {t("seed")}
          </ToggleGroupItem>
        </ToggleGroup>
        </div>
      </div>

      <Card className="p-4 sm:p-6">
        <Tabs value={searchType} onValueChange={(v) => setSearchType(v as typeof searchType)}>
          <TabsList className="grid w-full grid-cols-4 mb-4">
            <TabsTrigger value="phone" className="gap-2" data-testid="tab-search-phone">
              <Phone className="h-4 w-4" />
              <span className="hidden sm:inline">{t("phoneNumber")}</span>
            </TabsTrigger>
            <TabsTrigger value="farmerName" className="gap-2" data-testid="tab-search-farmer">
              <User className="h-4 w-4" />
              <span className="hidden sm:inline">{t("farmerName")}</span>
            </TabsTrigger>
            <TabsTrigger value="lotNoSize" className="gap-2" data-testid="tab-search-lot">
              <Package className="h-4 w-4" />
              <span className="hidden sm:inline">{t("lotNumber")} x {t("size")}</span>
            </TabsTrigger>
            <TabsTrigger value="filter" className="gap-2" data-testid="tab-search-filter">
              <Filter className="h-4 w-4" />
              <span className="hidden sm:inline">{t("filters")}</span>
            </TabsTrigger>
          </TabsList>

          {searchType === "phone" ? (
            <div className="flex flex-col sm:flex-row sm:flex-nowrap gap-2 sm:gap-3">
              <div className="flex gap-2 flex-1">
                <div className="relative flex-1">
                  <Input
                    placeholder="Enter phone number..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value.replace(/\D/g, ""));
                      setShowPhoneSuggestions(true);
                    }}
                    onFocus={() => setShowPhoneSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowPhoneSuggestions(false), 200)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    autoComplete="off"
                    data-testid="input-search-phone"
                  />
                  {showPhoneSuggestions && getPhoneSuggestions.length > 0 && searchQuery && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                      {getPhoneSuggestions.map((farmer, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className="w-full px-3 py-2 text-left hover-elevate text-sm flex flex-col"
                          onClick={() => selectPhoneSuggestion(farmer)}
                          data-testid={`suggestion-phone-${idx}`}
                        >
                          <span className="font-medium">{farmer.contactNumber}</span>
                          <span className="text-xs text-muted-foreground">{farmer.farmerName} • {farmer.village}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {isSearching && <div className="flex items-center"><Search className="h-4 w-4 animate-pulse text-muted-foreground" /></div>}
              </div>
              <div className="flex items-center gap-2 sm:border-l sm:pl-2">
                <ArrowUpDown className="h-4 w-4 text-muted-foreground hidden sm:block" />
                <Label className="text-sm text-muted-foreground whitespace-nowrap">{t("sortBy")}:</Label>
                <Select value={sortBy} onValueChange={(value) => setSortBy(value as "lotNo" | "chargeDue" | "remainingBags")}>
                  <SelectTrigger className="w-36" data-testid="select-sort-by">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lotNo" data-testid="select-sort-lotno">{t("sortByLotNo")}</SelectItem>
                    <SelectItem value="chargeDue" data-testid="select-sort-chargedue">{t("sortByChargeDue")}</SelectItem>
                    <SelectItem value="remainingBags" data-testid="select-sort-remainingbags">{t("sortByRemainingBags")}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleExportCSV}
                  title={t("download") || "Download CSV"}
                  data-testid="button-export-csv"
                >
                  <Download className="h-4 w-4" />
                </Button>
                {isFilterActive && (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handlePrintFiltered}
                    title={t("print") || "Print"}
                    data-testid="button-print-filtered"
                  >
                    <Printer className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ) : searchType === "farmerName" ? (
            <div className="flex flex-col sm:flex-row sm:flex-nowrap gap-2 sm:gap-3">
              <div className="flex gap-2 flex-1">
                <div className="relative flex-1">
                  <Input
                    placeholder={t("enterFarmerName") || "Enter farmer name..."}
                    value={farmerNameQuery}
                    onChange={(e) => {
                      setFarmerNameQuery(capitalizeFirstLetter(e.target.value));
                      setSelectedFarmerVillage("");
                      setSelectedFarmerMobile("");
                      setShowFarmerNameSuggestions(true);
                    }}
                    onFocus={() => setShowFarmerNameSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowFarmerNameSuggestions(false), 200)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    autoComplete="off"
                    data-testid="input-search-farmer"
                  />
                  {showFarmerNameSuggestions && getFarmerNameSuggestions.length > 0 && farmerNameQuery && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                      {getFarmerNameSuggestions.map((farmer, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className="w-full px-3 py-2 text-left hover-elevate text-sm flex flex-col"
                          onClick={() => selectFarmerNameSuggestion(farmer)}
                          data-testid={`suggestion-farmer-${idx}`}
                        >
                          <span className="font-medium">{farmer.farmerName}</span>
                          <span className="text-xs text-muted-foreground">{farmer.contactNumber} • {farmer.village}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {isSearching && <div className="flex items-center"><Search className="h-4 w-4 animate-pulse text-muted-foreground" /></div>}
              </div>
              {selectedFarmerVillage && selectedFarmerMobile && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="text-xs">
                    {selectedFarmerVillage} • {selectedFarmerMobile}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFarmerNameQuery("");
                      setSelectedFarmerVillage("");
                      setSelectedFarmerMobile("");
                    }}
                    data-testid="button-clear-specific-farmer"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}
              <div className="flex items-center gap-2 sm:border-l sm:pl-2">
                <ArrowUpDown className="h-4 w-4 text-muted-foreground hidden sm:block" />
                <Label className="text-sm text-muted-foreground whitespace-nowrap">{t("sortBy")}:</Label>
                <Select value={sortBy} onValueChange={(value) => setSortBy(value as "lotNo" | "chargeDue" | "remainingBags")}>
                  <SelectTrigger className="w-36" data-testid="select-sort-by">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lotNo" data-testid="select-sort-lotno">{t("sortByLotNo")}</SelectItem>
                    <SelectItem value="chargeDue" data-testid="select-sort-chargedue">{t("sortByChargeDue")}</SelectItem>
                    <SelectItem value="remainingBags" data-testid="select-sort-remainingbags">{t("sortByRemainingBags")}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleExportCSV}
                  title={t("download") || "Download CSV"}
                  data-testid="button-export-csv"
                >
                  <Download className="h-4 w-4" />
                </Button>
                {isFilterActive && (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handlePrintFiltered}
                    title={t("print") || "Print"}
                    data-testid="button-print-filtered"
                  >
                    <Printer className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ) : searchType === "lotNoSize" ? (
            <div className="flex flex-col sm:flex-row sm:flex-nowrap gap-2 sm:gap-3">
              <div className="flex flex-wrap items-center gap-2 flex-1">
                <Input
                  placeholder={`${t("fromLotNo")}`}
                  value={lotNoFrom}
                  onChange={(e) => setLotNoFrom(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="flex-1 min-w-[80px]"
                  data-testid="input-search-lotno-from"
                />
                <span className="text-sm font-medium text-muted-foreground">–</span>
                <Input
                  placeholder={`${t("toLotNo")}`}
                  value={lotNoTo}
                  onChange={(e) => setLotNoTo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="flex-1 min-w-[80px]"
                  data-testid="input-search-lotno-to"
                />
                <span className="text-sm font-medium text-muted-foreground">{t("or") || "or"}</span>
                <Input
                  placeholder={`${t("size")} (${t("optional")})`}
                  value={sizeQuery}
                  onChange={(e) => setSizeQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="flex-1 min-w-[80px]"
                  data-testid="input-search-size"
                />
                {isSearching && <div className="flex items-center"><Search className="h-4 w-4 animate-pulse text-muted-foreground" /></div>}
              </div>
              <div className="flex items-center gap-2 sm:border-l sm:pl-2">
                <ArrowUpDown className="h-4 w-4 text-muted-foreground hidden sm:block" />
                <Label className="text-sm text-muted-foreground whitespace-nowrap">{t("sortBy")}:</Label>
                <Select value={sortBy} onValueChange={(value) => setSortBy(value as "lotNo" | "chargeDue" | "remainingBags")}>
                  <SelectTrigger className="w-36" data-testid="select-sort-by">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lotNo" data-testid="select-sort-lotno">{t("sortByLotNo")}</SelectItem>
                    <SelectItem value="chargeDue" data-testid="select-sort-chargedue">{t("sortByChargeDue")}</SelectItem>
                    <SelectItem value="remainingBags" data-testid="select-sort-remainingbags">{t("sortByRemainingBags")}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleExportCSV}
                  title={t("download") || "Download CSV"}
                  data-testid="button-export-csv"
                >
                  <Download className="h-4 w-4" />
                </Button>
                {isFilterActive && (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handlePrintFiltered}
                    title={t("print") || "Print"}
                    data-testid="button-print-filtered"
                  >
                    <Printer className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:flex-nowrap gap-2 sm:gap-3 sm:items-center">
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 flex-1">
                <div className="flex items-center gap-1">
                  <Label className="text-sm">{t("quality")}:</Label>
                  <Select value={qualityFilter} onValueChange={setQualityFilter}>
                    <SelectTrigger className="w-28" data-testid="select-quality-filter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("all")}</SelectItem>
                      <SelectItem value="poor">{t("poor")}</SelectItem>
                      <SelectItem value="medium">{t("medium")}</SelectItem>
                      <SelectItem value="good">{t("good")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1">
                  <Label className="text-sm">{t("type")}:</Label>
                  <Select value={potatoTypeFilter} onValueChange={setPotatoTypeFilter}>
                    <SelectTrigger className="w-28" data-testid="select-potato-type-filter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("all")}</SelectItem>
                      {uniquePotatoTypes.map((type) => (
                        <SelectItem key={type} value={type}>{type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1">
                  <Checkbox
                    id="payment-due-filter-main"
                    checked={paymentDueFilter}
                    onCheckedChange={(checked) => setPaymentDueFilter(checked === true)}
                    data-testid="checkbox-payment-due-main"
                  />
                  <Label htmlFor="payment-due-filter-main" className="text-sm cursor-pointer whitespace-nowrap">
                    {t("coldChargesDue")}
                  </Label>
                </div>
                {isSearching && <div className="flex items-center"><Search className="h-4 w-4 animate-pulse text-muted-foreground" /></div>}
              </div>
              <div className="flex items-center gap-2 sm:border-l sm:pl-2">
                <ArrowUpDown className="h-4 w-4 text-muted-foreground hidden sm:block" />
                <Label className="text-sm text-muted-foreground whitespace-nowrap">{t("sortBy")}:</Label>
                <Select value={sortBy} onValueChange={(value) => setSortBy(value as "lotNo" | "chargeDue" | "remainingBags")}>
                  <SelectTrigger className="w-36" data-testid="select-sort-by">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lotNo" data-testid="select-sort-lotno">{t("sortByLotNo")}</SelectItem>
                    <SelectItem value="chargeDue" data-testid="select-sort-chargedue">{t("sortByChargeDue")}</SelectItem>
                    <SelectItem value="remainingBags" data-testid="select-sort-remainingbags">{t("sortByRemainingBags")}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleExportCSV}
                  title={t("download") || "Download CSV"}
                  data-testid="button-export-csv"
                >
                  <Download className="h-4 w-4" />
                </Button>
                {isFilterActive && (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handlePrintFiltered}
                    title={t("print") || "Print"}
                    data-testid="button-print-filtered"
                  >
                    <Printer className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          )}
        </Tabs>
      </Card>

      {summaryTotals && (
        <Card className="p-3 bg-muted/50">
          <div className="flex flex-col gap-2">
            <span className="font-semibold text-xs md:text-sm">{t("searchSummary")}:</span>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <div className="flex flex-col items-center">
                <span className="text-xs text-muted-foreground text-center">{t("totalBags")}</span>
                <span className="font-bold text-sm md:text-base" data-testid="text-total-bags">{summaryTotals.totalBags.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-xs text-muted-foreground text-center">{t("totalRemainingBags")}</span>
                <span className="font-bold text-sm md:text-base" data-testid="text-total-remaining">{summaryTotals.remainingBags.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-xs text-muted-foreground text-center">{t("totalExpectedColdCharges")}</span>
                <span className="font-bold text-sm md:text-base text-blue-600" data-testid="text-total-expected"><Currency amount={summaryTotals.expectedColdCharges} /></span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-xs text-muted-foreground text-center">{t("totalChargesPaid")}</span>
                <span className="font-bold text-sm md:text-base text-green-600" data-testid="text-total-paid"><Currency amount={summaryTotals.chargesPaid} /></span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-xs text-muted-foreground text-center">{t("totalChargesDue")}</span>
                <span className="font-bold text-sm md:text-base text-red-600" data-testid="text-total-due"><Currency amount={summaryTotals.chargesDue} /></span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {isSearching || isLoadingInitial ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : (
        (() => {
          // Use search results if searched, otherwise show initial lots
          const rawLots = hasSearched ? searchResults : (initialLots || []);
          
          // Apply bag type filter
          const baseLots = bagTypeFilter === "all" 
            ? rawLots 
            : rawLots.filter(lot => lot.bagType === bagTypeFilter);
          
          // Pre-calculate charges for each lot for sorting and display
          const lotsWithCharges = baseLots.map((lot) => {
            let lotPaidCharge = 0;
            let lotDueCharge = 0;
            if (allSalesHistory) {
              const lotSales = allSalesHistory.filter(s => s.lotId === lot.id);
              for (const sale of lotSales) {
                const totalCharges = calculateTotalColdCharges(sale);
                if (sale.paymentStatus === "paid") {
                  lotPaidCharge += totalCharges;
                } else if (sale.paymentStatus === "due") {
                  lotDueCharge += totalCharges;
                } else if (sale.paymentStatus === "partial") {
                  const paidAmount = sale.paidAmount || 0;
                  lotPaidCharge += paidAmount;
                  lotDueCharge += Math.max(0, totalCharges - paidAmount);
                }
              }
            }
            // Calculate expected cold charge based on charge unit mode
            const useWaferRate = lot.bagType === "wafer";
            const coldChargeRate = useWaferRate 
              ? (coldStorage?.waferColdCharge || 0) 
              : (coldStorage?.seedColdCharge || 0);
            const hammaliRate = useWaferRate
              ? (coldStorage?.waferHammali || 0)
              : (coldStorage?.seedHammali || 0);
            // For quintal mode: cold charge (per quintal) + hammali (per bag)
            // For bag mode: (coldCharge + hammali) × lot.size
            let expectedColdCharge: number;
            if (coldStorage?.chargeUnit === "quintal") {
              const coldChargeQuintal = lot.netWeight ? (lot.netWeight * coldChargeRate) / 100 : 0;
              const hammaliPerBag = lot.size * hammaliRate;
              expectedColdCharge = coldChargeQuintal + hammaliPerBag;
            } else {
              expectedColdCharge = lot.size * (coldChargeRate + hammaliRate);
            }
            return { lot, lotPaidCharge, lotDueCharge, expectedColdCharge };
          });
          
          // Sort based on selected sort option
          const sortedLots = [...lotsWithCharges].sort((a, b) => {
            if (sortBy === "chargeDue") {
              return b.lotDueCharge - a.lotDueCharge; // High to low
            } else if (sortBy === "remainingBags") {
              return b.lot.remainingSize - a.lot.remainingSize; // High to low
            } else {
              // Default: sort by lot number
              const lotNoA = parseInt(a.lot.lotNo, 10) || 0;
              const lotNoB = parseInt(b.lot.lotNo, 10) || 0;
              return lotNoA - lotNoB;
            }
          });
          
          if (sortedLots.length === 0) {
            return hasSearched ? (
              <Card className="p-8 text-center" data-testid="card-no-results">
                <p className="text-muted-foreground">{t("noResults")}</p>
              </Card>
            ) : null;
          }
          
          return (
            <div className="space-y-4 max-h-[70vh] overflow-y-auto" ref={scrollContainerRef}>
              {sortedLots.map(({ lot, lotPaidCharge, lotDueCharge, expectedColdCharge }) => (
                  <LotCard
                    key={lot.id}
                    lot={lot}
                    chamberName={chamberMap[lot.chamberId] || "Unknown"}
                    onEdit={handleEditClick}
                    onToggleSale={handleToggleSale}
                    onPrintReceipt={(lot) => {
                      setPrintReceiptLot(lot);
                      setPrintReceiptDialogOpen(true);
                    }}
                    calculatedPaidCharge={lotPaidCharge}
                    calculatedDueCharge={lotDueCharge}
                    expectedColdCharge={expectedColdCharge}
                    canEdit={canEdit}
                  />
                ))}
              {/* Infinite scroll loader */}
              {!hasSearched && displayedLots.length < totalLotCount && (
                <div ref={loaderRef} className="flex items-center justify-center py-4">
                  {isLoadingMore ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">{t("loadingMore") || "Loading more..."}</span>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">{t("scrollForMore") || "Scroll for more"}</span>
                  )}
                </div>
              )}
            </div>
          );
        })()
      )}

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{t("edit")} - {selectedLot?.farmerName}</DialogTitle>
            <DialogDescription>
              {t("lotNo")}: {selectedLot?.lotNo}
            </DialogDescription>
          </DialogHeader>

          {/* Farmer Details (Read-only - edit via Farmer Ledger) */}
          <div className="space-y-4">
            <h4 className="font-semibold text-sm text-muted-foreground">{t("farmerDetails")}</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 bg-muted/50 rounded-lg">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("farmerName")}</Label>
                <p className="font-medium text-sm" data-testid="text-farmer-name">{selectedLot?.farmerName}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("contactNumber")}</Label>
                <p className="font-medium text-sm" data-testid="text-contact-number">{selectedLot?.contactNumber}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("village")}</Label>
                <p className="font-medium text-sm" data-testid="text-village">{selectedLot?.village}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("tehsil")}</Label>
                <p className="font-medium text-sm" data-testid="text-tehsil">{selectedLot?.tehsil}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("district")}</Label>
                <p className="font-medium text-sm" data-testid="text-district">{selectedLot?.district}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("state")}</Label>
                <p className="font-medium text-sm" data-testid="text-state">{selectedLot?.state}</p>
              </div>
            </div>
          </div>

          {/* Lot Information - Lot No is editable */}
          <div className="space-y-4 border-t pt-4">
            <h4 className="font-semibold text-sm text-muted-foreground">{t("lotInformation")}</h4>
            <div className="grid grid-cols-3 gap-3 p-3 bg-muted/50 rounded-lg">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("lotNo")}</Label>
                {editForm && canEdit ? (
                  <div>
                    <Input
                      type="number"
                      min={1}
                      value={editForm.lotNo}
                      onChange={(e) => {
                        setEditForm({ ...editForm, lotNo: e.target.value });
                        setLotNoError(null);
                      }}
                      className={lotNoError ? "border-destructive" : ""}
                      data-testid="input-edit-lot-no"
                    />
                    {lotNoError && (
                      <p className="text-xs text-destructive mt-1">{lotNoError}</p>
                    )}
                  </div>
                ) : (
                  <p className="font-medium text-sm">{selectedLot?.lotNo}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("originalSize")}</p>
                <p className="font-medium text-sm">{selectedLot?.size} {t("bags")}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("remainingBags")}</p>
                <p className="font-medium text-sm">{selectedLot?.remainingSize} {t("bags")}</p>
              </div>
            </div>
          </div>

          {/* Read-only Cold Storage Charges - calculated from sales history */}
          {selectedLot && (selectedLotCharges.totalDue > 0 || selectedLotCharges.totalPaid > 0) && (
            <div className="border-t pt-4 space-y-3">
              <h4 className="font-semibold text-sm text-muted-foreground">{t("totalColdStorageCharges")}</h4>
              <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 mb-3">
                <p className="text-xs text-muted-foreground">{t("total")}</p>
                <p className="text-xl font-bold text-blue-600 dark:text-blue-400">
                  <Currency amount={selectedLotCharges.totalPaid + selectedLotCharges.totalDue} />
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {selectedLotCharges.totalPaid > 0 && (
                  <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                    <p className="text-xs text-muted-foreground">{t("coldChargesPaid")}</p>
                    <p className="text-lg font-bold text-green-600 dark:text-green-400">
                      <Currency amount={selectedLotCharges.totalPaid} />
                    </p>
                  </div>
                )}
                {selectedLotCharges.totalDue > 0 && (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    <p className="text-xs text-muted-foreground">{t("coldChargesDue")}</p>
                    <p className="text-lg font-bold text-amber-600 dark:text-amber-400">
                      <Currency amount={selectedLotCharges.totalDue} />
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Editable Location & Quality */}
          {editForm && (
            <div className="border-t pt-4 space-y-4">
              <h4 className="font-semibold text-sm">{t("editableFields")}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("chamber")}</Label>
                  <Select
                    value={editForm.chamberId}
                    onValueChange={(value) => setEditForm({ ...editForm, chamberId: value })}
                  >
                    <SelectTrigger data-testid="select-edit-chamber">
                      <SelectValue placeholder={t("selectChamber")} />
                    </SelectTrigger>
                    <SelectContent>
                      {chambers?.map((chamber) => (
                        <SelectItem key={chamber.id} value={chamber.id}>
                          {chamber.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("floor")}</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={editForm.floor === 0 ? "" : editForm.floor}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "");
                      setEditForm({ ...editForm, floor: val === "" ? 0 : parseInt(val, 10) });
                    }}
                    data-testid="input-edit-floor"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("position")}</Label>
                  <Input
                    value={editForm.position}
                    onChange={(e) => setEditForm({ ...editForm, position: e.target.value })}
                    data-testid="input-edit-position"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("quality")}</Label>
                  <Select
                    value={editForm.quality}
                    onValueChange={(value) => setEditForm({ ...editForm, quality: value })}
                  >
                    <SelectTrigger data-testid="select-edit-quality">
                      <SelectValue placeholder={t("selectQuality")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="poor">{t("poor")}</SelectItem>
                      <SelectItem value="medium">{t("medium")}</SelectItem>
                      <SelectItem value="good">{t("good")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {coldStorage?.chargeUnit === "quintal" && (
                  <div className="space-y-2">
                    <Label>{t("netWeightQtl")}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      placeholder="0.00"
                      value={editForm.netWeight === undefined || editForm.netWeight === 0 ? "" : editForm.netWeight}
                      onChange={(e) => setEditForm({ ...editForm, netWeight: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
                      data-testid="input-edit-net-weight"
                    />
                  </div>
                )}
              </div>
              
              {coldStorage?.chargeUnit === "quintal" && editForm.netWeight && editForm.netWeight > 0 && selectedLot && (
                <div className="mt-4 p-3 bg-muted rounded-md">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{t("expectedCharge")}:</span>
                    <span className="font-semibold">
                      <Currency 
                        amount={
                          ((editForm.netWeight * (
                            selectedLot.bagType === "wafer"
                              ? coldStorage.waferColdCharge
                              : coldStorage.seedColdCharge
                          )) / 100) + 
                          ((selectedLot.bagType === "wafer"
                              ? coldStorage.waferHammali
                              : coldStorage.seedHammali
                          ) * selectedLot.size)
                        } 
                      />
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    ({editForm.netWeight} {t("kg")} × <Currency amount={selectedLot.bagType === "wafer" 
                      ? coldStorage.waferColdCharge 
                      : coldStorage.seedColdCharge
                    } />) / 100 + (<Currency amount={selectedLot.bagType === "wafer" 
                      ? coldStorage.waferHammali 
                      : coldStorage.seedHammali
                    } /> × {selectedLot.size} {t("bags")})
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {t("cancel")}
            </Button>
            {canEdit && (
              <Button
                onClick={handleEditSubmit}
                disabled={updateLotMutation.isPending || !editForm}
                data-testid="button-save-edit"
              >
                {updateLotMutation.isPending ? t("loading") : t("save")}
              </Button>
            )}
          </div>

          <div className="border-t pt-4">
            <h3 className="font-semibold mb-3">{t("editHistory")}</h3>
            <EditHistoryAccordion 
              history={editHistory} 
              onReverse={editHistory.length > 0 && editHistory[0].changeType === "edit" ? async () => {
                const latestEdit = editHistory[0];
                try {
                  await apiRequest("POST", `/api/lots/${selectedLot?.id}/reverse-edit`, { historyId: latestEdit.id });
                  toast({
                    title: t("success"),
                    description: t("editReversed"),
                    variant: "success",
                  });
                  // Refresh the lot and history
                  if (selectedLot) {
                    const lotResponse = await authFetch(`/api/lots/${selectedLot.id}`);
                    if (lotResponse.ok) {
                      const updatedLot = await lotResponse.json();
                      setSelectedLot(updatedLot);
                      setEditForm({
                        chamberId: updatedLot.chamberId,
                        floor: updatedLot.floor,
                        position: updatedLot.position || "",
                        quality: updatedLot.quality,
                        netWeight: updatedLot.netWeight || undefined,
                        lotNo: updatedLot.lotNo,
                        farmerName: updatedLot.farmerName,
                        village: updatedLot.village || "",
                        tehsil: updatedLot.tehsil || "",
                        district: updatedLot.district || "",
                        state: updatedLot.state || "",
                        contactNumber: updatedLot.contactNumber || "",
                      });
                      setLotNoError(null);
                    }
                    const historyResponse = await authFetch(`/api/lots/${selectedLot.id}/history`);
                    if (historyResponse.ok) {
                      setEditHistory(await historyResponse.json());
                    }
                  }
                  queryClient.invalidateQueries({ queryKey: ["/api/lots"] });
                  queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("/api/dashboard/stats") });
                  handleSearch();
                } catch (error: any) {
                  toast({
                    title: t("error"),
                    description: error.message || "Failed to reverse edit",
                    variant: "destructive",
                  });
                }
              } : undefined}
            />
          </div>
        </DialogContent>
      </Dialog>

      {printReceiptLot && (
        <PrintEntryReceiptDialog
          lot={printReceiptLot}
          open={printReceiptDialogOpen}
          onOpenChange={(open) => {
            setPrintReceiptDialogOpen(open);
            if (!open) setPrintReceiptLot(null);
          }}
        />
      )}
    </div>
  );
}
