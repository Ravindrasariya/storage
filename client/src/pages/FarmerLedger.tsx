import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, authFetch } from "@/lib/queryClient";
import { Users, RefreshCw, Search, Archive, RotateCcw, Pencil, ArrowUpDown, Printer, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/components/Currency";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { format } from "date-fns";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { FarmerLedgerEntry, FarmerLedgerEditHistoryEntry } from "@shared/schema";

interface FarmerWithDues extends FarmerLedgerEntry {
  pyReceivables: number;
  selfDue: number;
  merchantDue: number;
  advanceDue: number;
  freightDue: number;
  totalDue: number;
}

interface FarmerLedgerData {
  farmers: FarmerWithDues[];
  summary: {
    totalFarmers: number;
    pyReceivables: number;
    selfDue: number;
    merchantDue: number;
    advanceDue: number;
    freightDue: number;
    totalDue: number;
  };
}

type SortField = 'farmerId' | 'name' | 'village' | 'contactNumber' | 'pyReceivables' | 'selfDue' | 'merchantDue' | 'totalDue';
type SortDirection = 'asc' | 'desc';

export default function FarmerLedger() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { canEdit, coldStorage } = useAuth();
  const coldStorageId = coldStorage?.id || "";

  const [nameSearch, setNameSearch] = useState("");
  const [villageSearch, setVillageSearch] = useState("");
  const [yearFilter, setYearFilter] = useState("all");
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [sortField, setSortField] = useState<SortField>('farmerId');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [editingFarmer, setEditingFarmer] = useState<FarmerWithDues | null>(null);
  const [editFormData, setEditFormData] = useState({
    name: "",
    contactNumber: "",
    village: "",
    tehsil: "",
    district: "",
    state: "",
  });
  const [mergeConfirmOpen, setMergeConfirmOpen] = useState(false);
  const [pendingMergeInfo, setPendingMergeInfo] = useState<{
    targetFarmer?: FarmerLedgerEntry;
    lotsCount: number;
    receivablesCount: number;
    salesCount: number;
    totalDues: number;
  } | null>(null);

  const { data: ledgerData, isLoading } = useQuery<FarmerLedgerData>({
    queryKey: ['/api/farmer-ledger', { includeArchived: showArchived }],
    queryFn: () => authFetch(`/api/farmer-ledger?includeArchived=${showArchived}`).then(res => res.json()),
    enabled: !!coldStorageId,
  });

  const { data: editHistory } = useQuery<FarmerLedgerEditHistoryEntry[]>({
    queryKey: ['/api/farmer-ledger', editingFarmer?.id, 'history'],
    queryFn: () => authFetch(`/api/farmer-ledger/${editingFarmer?.id}/history`).then(res => res.json()),
    enabled: !!editingFarmer?.id,
  });

  const syncMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/farmer-ledger/sync'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/farmer-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['/api/farmers/lookup'] });
      toast({ title: t("farmersSynced") });
    },
    onError: () => {
      toast({ title: t("farmersSyncFailed"), variant: "destructive" });
    },
  });

  const checkMergeMutation = useMutation({
    mutationFn: async (data: { id: string; updates: Partial<FarmerLedgerEntry> }) => {
      const response = await apiRequest('POST', `/api/farmer-ledger/${data.id}/check-merge`, data.updates);
      return response.json() as Promise<{
        willMerge: boolean;
        targetFarmer?: FarmerLedgerEntry;
        lotsCount: number;
        receivablesCount: number;
        salesCount: number;
        totalDues: number;
      }>;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; updates: Partial<FarmerLedgerEntry>; confirmMerge?: boolean }) => {
      const response = await apiRequest('PATCH', `/api/farmer-ledger/${data.id}`, { ...data.updates, confirmMerge: data.confirmMerge });
      return response.json() as Promise<{ merged: boolean; mergedFromId?: string; needsConfirmation?: boolean }>;
    },
    onSuccess: (result) => {
      if (result.needsConfirmation) {
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['/api/farmer-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['/api/farmers/lookup'] });
      if (result.merged) {
        toast({ title: t("mergedFrom") + " " + result.mergedFromId });
      } else {
        toast({ title: t("saved") });
      }
      setEditingFarmer(null);
      setMergeConfirmOpen(false);
      setPendingMergeInfo(null);
    },
    onError: () => {
      toast({ title: t("saveFailed"), variant: "destructive" });
    },
  });

  const flagMutation = useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/api/farmer-ledger/${id}/flag`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/farmer-ledger'] });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/api/farmer-ledger/${id}/archive`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/farmer-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['/api/farmers/lookup'] });
      toast({ title: t("farmerArchived") });
    },
  });

  const reinstateMutation = useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/api/farmer-ledger/${id}/reinstate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/farmer-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['/api/farmers/lookup'] });
      toast({ title: t("farmerReinstated") });
    },
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const filteredFarmers = useMemo(() => {
    if (!ledgerData?.farmers) return { active: [], archived: [] };

    let filtered = ledgerData.farmers
      .filter(farmer => {
        const matchesName = !nameSearch || 
          farmer.name.toLowerCase().includes(nameSearch.toLowerCase());
        const matchesVillage = !villageSearch || 
          farmer.village.toLowerCase().includes(villageSearch.toLowerCase());
        
        return matchesName && matchesVillage;
      });

    filtered = [...filtered].sort((a, b) => {
      let aVal: string | number = a[sortField] ?? 0;
      let bVal: string | number = b[sortField] ?? 0;
      
      if (sortField === 'farmerId') {
        const aMatch = (aVal as string).match(/FM(\d{8})(\d+)/);
        const bMatch = (bVal as string).match(/FM(\d{8})(\d+)/);
        if (aMatch && bMatch) {
          const aDate = aMatch[1];
          const bDate = bMatch[1];
          if (aDate !== bDate) {
            return sortDirection === 'asc' 
              ? aDate.localeCompare(bDate) 
              : bDate.localeCompare(aDate);
          }
          const aNum = parseInt(aMatch[2], 10);
          const bNum = parseInt(bMatch[2], 10);
          return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
        }
      }
      
      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = (bVal as string).toLowerCase();
      }
      
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return {
      active: filtered.filter(f => f.isArchived !== 1),
      archived: filtered.filter(f => f.isArchived === 1),
    };
  }, [ledgerData?.farmers, nameSearch, villageSearch, sortField, sortDirection]);

  const handleEditClick = (farmer: FarmerWithDues) => {
    setEditFormData({
      name: farmer.name,
      contactNumber: farmer.contactNumber,
      village: farmer.village,
      tehsil: farmer.tehsil || "",
      district: farmer.district || "",
      state: farmer.state || "",
    });
    setEditingFarmer(farmer);
  };

  const handleSaveEdit = async () => {
    if (!editingFarmer) return;
    
    try {
      // First check if this would cause a merge
      const mergeCheck = await checkMergeMutation.mutateAsync({
        id: editingFarmer.id,
        updates: editFormData,
      });
      
      if (mergeCheck.willMerge) {
        // Show confirmation dialog
        setPendingMergeInfo(mergeCheck);
        setMergeConfirmOpen(true);
        return;
      }
      
      // No merge needed, proceed with update
      updateMutation.mutate({
        id: editingFarmer.id,
        updates: editFormData,
      });
    } catch {
      toast({ title: t("saveFailed"), variant: "destructive" });
    }
  };

  const handleConfirmMerge = () => {
    if (!editingFarmer) return;
    updateMutation.mutate({
      id: editingFarmer.id,
      updates: editFormData,
      confirmMerge: true,
    });
  };

  const handleCancelMerge = () => {
    setMergeConfirmOpen(false);
    setPendingMergeInfo(null);
  };

  const summary = ledgerData?.summary || {
    totalFarmers: 0,
    pyReceivables: 0,
    selfDue: 0,
    merchantDue: 0,
    advanceDue: 0,
    freightDue: 0,
    totalDue: 0,
  };

  const nameSuggestions = useMemo(() => {
    if (!nameSearch || nameSearch.length < 1 || !ledgerData?.farmers) return [];
    const searchLower = nameSearch.toLowerCase();
    return ledgerData.farmers
      .filter(f => f.name.toLowerCase().includes(searchLower))
      .slice(0, 8);
  }, [nameSearch, ledgerData?.farmers]);

  const formatDueValue = (value: number | undefined | null): string => {
    const num = value ?? 0;
    if (isNaN(num)) return formatCurrency(0);
    return formatCurrency(num);
  };

  const getDueColorClass = (value: number | undefined | null): string => {
    const num = value ?? 0;
    if (isNaN(num) || num === 0) return "text-muted-foreground";
    if (num > 0) return "text-amber-600 dark:text-amber-500";
    return "text-rose-600 dark:text-rose-500";
  };

  const handlePrint = useCallback(() => {
    const farmersToExport = showArchived 
      ? [...filteredFarmers.active, ...filteredFarmers.archived]
      : filteredFarmers.active;

    if (farmersToExport.length === 0) {
      toast({ title: t("noFarmersFound"), variant: "destructive" });
      return;
    }

    const doc = new jsPDF({ orientation: 'landscape' });
    const pageWidth = doc.internal.pageSize.getWidth();
    
    doc.setFontSize(16);
    doc.text(t("farmerLedger"), pageWidth / 2, 15, { align: 'center' });
    
    doc.setFontSize(10);
    const filterInfo: string[] = [];
    if (nameSearch) filterInfo.push(`${t("name")}: ${nameSearch}`);
    if (villageSearch) filterInfo.push(`${t("village")}: ${villageSearch}`);
    if (yearFilter !== 'all') filterInfo.push(`${t("year")}: ${yearFilter}`);
    if (filterInfo.length > 0) {
      doc.text(filterInfo.join(' | '), pageWidth / 2, 22, { align: 'center' });
    }
    doc.text(`${t("farmers")}: ${farmersToExport.length} | ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, pageWidth / 2, filterInfo.length > 0 ? 28 : 22, { align: 'center' });

    const tableData = farmersToExport.map(farmer => [
      farmer.farmerId,
      farmer.name,
      farmer.village,
      farmer.contactNumber || '',
      formatDueValue(farmer.pyReceivables + (farmer.advanceDue || 0) + (farmer.freightDue || 0)),
      formatDueValue(farmer.selfDue),
      formatDueValue(farmer.merchantDue),
      formatDueValue(farmer.totalDue),
      farmer.isFlagged === 1 ? t("flagged") : ''
    ]);

    const totals = farmersToExport.reduce((acc, f) => ({
      pyReceivables: acc.pyReceivables + f.pyReceivables,
      selfDue: acc.selfDue + f.selfDue,
      merchantDue: acc.merchantDue + f.merchantDue,
      advanceDue: acc.advanceDue + (f.advanceDue || 0),
      freightDue: acc.freightDue + (f.freightDue || 0),
      totalDue: acc.totalDue + f.totalDue,
    }), { pyReceivables: 0, selfDue: 0, merchantDue: 0, advanceDue: 0, freightDue: 0, totalDue: 0 });

    tableData.push([
      '', t("total"), '', '',
      formatDueValue(totals.pyReceivables + (totals.advanceDue || 0) + (totals.freightDue || 0)),
      formatDueValue(totals.selfDue),
      formatDueValue(totals.merchantDue),
      formatDueValue(totals.totalDue),
      ''
    ]);

    autoTable(doc, {
      head: [[
        t("farmerId"), t("name"), t("village"), t("contact"),
        t("pyReceivables"), t("selfDue"), t("merchantDues"), t("totalDues"), t("status")
      ]],
      body: tableData,
      startY: filterInfo.length > 0 ? 32 : 26,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [59, 130, 246], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 30 },
        1: { cellWidth: 40 },
        2: { cellWidth: 30 },
        3: { cellWidth: 28 },
        4: { halign: 'right', cellWidth: 25 },
        5: { halign: 'right', cellWidth: 22 },
        6: { halign: 'right', cellWidth: 25 },
        7: { halign: 'right', cellWidth: 25 },
        8: { cellWidth: 20 },
      },
      didParseCell: (data) => {
        if (data.row.index === tableData.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [240, 240, 240];
        }
      }
    });

    doc.save(`farmer-ledger-${format(new Date(), 'yyyyMMdd-HHmm')}.pdf`);
    toast({ title: t("saved") });
  }, [filteredFarmers, showArchived, nameSearch, villageSearch, yearFilter, t, toast, formatDueValue]);

  const SortHeader = ({ field, children, className = "", center = false }: { field: SortField; children: React.ReactNode; className?: string; center?: boolean }) => (
    <th 
      className={`px-2 py-2 text-xs font-medium cursor-pointer hover:bg-muted/50 select-none ${center ? 'text-center' : 'text-left'} ${className}`}
      onClick={() => handleSort(field)}
      data-testid={`header-${field}`}
    >
      <div className={`flex items-center gap-1 ${center ? 'justify-center' : ''}`}>
        {children}
        <ArrowUpDown className={`w-3 h-3 shrink-0 ${sortField === field ? 'opacity-100' : 'opacity-40'}`} />
      </div>
    </th>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <h1 className="text-xl font-semibold">{t("farmerLedger")}</h1>
        <p className="text-sm text-muted-foreground">{t("trackFarmerDues")}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 px-4 py-2">
        <Card className="py-1">
          <CardHeader className="py-1 px-3">
            <CardTitle className="text-xs font-medium text-muted-foreground">{t("farmers")}</CardTitle>
          </CardHeader>
          <CardContent className="py-1 px-3">
            <div className="text-base font-bold" data-testid="text-farmer-count">{summary.totalFarmers}</div>
          </CardContent>
        </Card>
        <Popover>
          <PopoverTrigger asChild>
            <Card className="py-1 cursor-pointer">
              <CardHeader className="py-1 px-3">
                <CardTitle className="text-xs font-medium text-blue-600 dark:text-blue-400">{t("pyReceivables")}</CardTitle>
              </CardHeader>
              <CardContent className="py-1 px-3">
                <div className="text-base font-bold text-blue-600 dark:text-blue-400" data-testid="text-py-receivables">{formatDueValue(summary.pyReceivables + (summary.advanceDue || 0) + (summary.freightDue || 0))}</div>
              </CardContent>
            </Card>
          </PopoverTrigger>
          {((summary.advanceDue || 0) > 0 || (summary.freightDue || 0) > 0) && (
            <PopoverContent className="w-56 p-3" data-testid="hover-summary-receivable-breakup">
              <div className="text-xs font-semibold mb-2">{t("receivableBreakup")}</div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span>{t("receivableAmount")}</span>
                  <span className="font-medium">{formatDueValue(summary.pyReceivables)}</span>
                </div>
                {(summary.advanceDue || 0) > 0 && (
                  <div className="flex justify-between">
                    <span>{t("advanceTotal")}</span>
                    <span className="font-medium">{formatDueValue(summary.advanceDue)}</span>
                  </div>
                )}
                {(summary.freightDue || 0) > 0 && (
                  <div className="flex justify-between">
                    <span>{t("freightTotal")}</span>
                    <span className="font-medium">{formatDueValue(summary.freightDue)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-1 font-semibold">
                  <span>{t("total")}</span>
                  <span>{formatDueValue(summary.pyReceivables + (summary.advanceDue || 0) + (summary.freightDue || 0))}</span>
                </div>
              </div>
            </PopoverContent>
          )}
        </Popover>
        <Card className="py-1">
          <CardHeader className="py-1 px-3">
            <CardTitle className="text-xs font-medium text-orange-500 dark:text-orange-400">{t("selfDue")}</CardTitle>
          </CardHeader>
          <CardContent className="py-1 px-3">
            <div className="text-base font-bold text-orange-500 dark:text-orange-400" data-testid="text-self-due">{formatDueValue(summary.selfDue)}</div>
          </CardContent>
        </Card>
        <Card className="py-1">
          <CardHeader className="py-1 px-3">
            <CardTitle className="text-xs font-medium text-orange-700 dark:text-orange-500">{t("merchantDues")}</CardTitle>
          </CardHeader>
          <CardContent className="py-1 px-3">
            <div className="text-base font-bold text-orange-700 dark:text-orange-500" data-testid="text-merchant-due">{formatDueValue(summary.merchantDue)}</div>
          </CardContent>
        </Card>
        <Card className="py-1">
          <CardHeader className="py-1 px-3">
            <CardTitle className="text-xs font-medium text-red-600 dark:text-red-500">{t("totalDues")}</CardTitle>
          </CardHeader>
          <CardContent className="py-1 px-3">
            <div className="text-base font-bold text-red-600 dark:text-red-500" data-testid="text-total-due">{formatDueValue(summary.totalDue)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="px-4 pb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
        </div>
        <Select value={yearFilter} onValueChange={setYearFilter}>
          <SelectTrigger className="w-[120px]" data-testid="select-year-filter">
            <SelectValue placeholder={t("allYears")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allYears")}</SelectItem>
            <SelectItem value="2026">2026</SelectItem>
            <SelectItem value="2025">2025</SelectItem>
            <SelectItem value="2024">2024</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative">
          <Input
            placeholder={t("searchByName")}
            value={nameSearch}
            onChange={(e) => {
              setNameSearch(e.target.value);
              setShowNameSuggestions(true);
            }}
            onFocus={() => setShowNameSuggestions(true)}
            onBlur={() => setTimeout(() => setShowNameSuggestions(false), 200)}
            className="w-[160px]"
            data-testid="input-search-name"
          />
          {showNameSuggestions && nameSuggestions.length > 0 && (
            <div className="absolute top-full left-0 mt-1 w-[280px] max-w-[90vw] bg-popover border rounded-md shadow-lg z-50 max-h-64 overflow-y-auto">
              {nameSuggestions.map(farmer => (
                <div
                  key={farmer.id}
                  className="px-3 py-2 cursor-pointer hover:bg-accent border-b last:border-b-0"
                  onMouseDown={() => {
                    setNameSearch(farmer.name);
                    setShowNameSuggestions(false);
                  }}
                  data-testid={`suggestion-farmer-${farmer.id}`}
                >
                  <div className="font-medium text-sm">{farmer.name}</div>
                  <div className="text-xs text-muted-foreground flex gap-3">
                    <span>{farmer.contactNumber || '-'}</span>
                    <span>{farmer.village}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <Input
            placeholder={t("searchByVillage")}
            value={villageSearch}
            onChange={(e) => setVillageSearch(e.target.value)}
            className="w-[160px]"
            data-testid="input-search-village"
          />
        </div>
        {(nameSearch || villageSearch || yearFilter !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setNameSearch("");
              setVillageSearch("");
              setYearFilter("all");
            }}
            data-testid="button-clear-filters"
          >
            <X className="w-4 h-4 mr-1" />
            {t("clearFilters") || "Clear"}
          </Button>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <Switch
            id="archived-filter"
            checked={showArchived}
            onCheckedChange={setShowArchived}
            data-testid="switch-show-archived"
          />
          <Label htmlFor="archived-filter" className="text-sm cursor-pointer">{t("showArchived")}</Label>
        </div>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            data-testid="button-sync-farmers"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            {t("sync")}
          </Button>
        )}
        <Button variant="outline" size="icon" onClick={handlePrint} data-testid="button-print">
          <Printer className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col px-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredFarmers.active.length === 0 && filteredFarmers.archived.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground" data-testid="text-no-farmers">
            {t("noFarmersFound")}
          </div>
        ) : (
          <>
            {/* Mobile Card View - with vertical scroll */}
            <ScrollArea className="flex-1 md:hidden">
              <div className="pb-4 space-y-3">
              {filteredFarmers.active.map(farmer => (
                <Card key={farmer.id} className="p-3" data-testid={`card-farmer-${farmer.id}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">{farmer.farmerId}</span>
                      {farmer.isFlagged === 1 && (
                        <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4">{t("flagged")}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Switch
                        checked={farmer.isFlagged === 1}
                        onCheckedChange={() => flagMutation.mutate(farmer.id)}
                        data-testid={`switch-flag-mobile-${farmer.id}`}
                      />
                      <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => handleEditClick(farmer)}>
                        <Pencil className="w-3 h-3" />
                      </Button>
                      {canEdit && (
                        <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => archiveMutation.mutate(farmer.id)}>
                          <Archive className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="font-medium text-base mb-1">{farmer.name}</div>
                  <div className="text-sm text-muted-foreground mb-2">{farmer.village} | {farmer.contactNumber}</div>
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <Popover>
                      <PopoverTrigger asChild>
                        <div className="cursor-pointer">
                          <div className="text-blue-600 dark:text-blue-400 font-medium">{t("pyReceivables")}</div>
                          <div className="text-blue-600 dark:text-blue-400 font-bold">{formatDueValue(farmer.pyReceivables + farmer.advanceDue + farmer.freightDue)}</div>
                        </div>
                      </PopoverTrigger>
                      {(farmer.advanceDue > 0 || farmer.freightDue > 0) && (
                        <PopoverContent className="w-56 p-3" data-testid={`hover-receivable-breakup-${farmer.id}`}>
                          <div className="text-xs font-semibold mb-2">{t("receivableBreakup")}</div>
                          <div className="space-y-1 text-xs">
                            <div className="flex justify-between">
                              <span>{t("receivableAmount")}</span>
                              <span className="font-medium">{formatDueValue(farmer.pyReceivables)}</span>
                            </div>
                            {farmer.advanceDue > 0 && (
                              <div className="flex justify-between">
                                <span>{t("advanceTotal")}</span>
                                <span className="font-medium">{formatDueValue(farmer.advanceDue)}</span>
                              </div>
                            )}
                            {farmer.freightDue > 0 && (
                              <div className="flex justify-between">
                                <span>{t("freightTotal")}</span>
                                <span className="font-medium">{formatDueValue(farmer.freightDue)}</span>
                              </div>
                            )}
                            <div className="flex justify-between border-t pt-1 font-semibold">
                              <span>{t("total")}</span>
                              <span>{formatDueValue(farmer.pyReceivables + farmer.advanceDue + farmer.freightDue)}</span>
                            </div>
                          </div>
                        </PopoverContent>
                      )}
                    </Popover>
                    <div>
                      <div className="text-orange-500 dark:text-orange-400 font-medium">{t("selfDue")}</div>
                      <div className="text-orange-500 dark:text-orange-400 font-bold">{formatDueValue(farmer.selfDue)}</div>
                    </div>
                    <div>
                      <div className="text-orange-700 dark:text-orange-500 font-medium">{t("merchantDues")}</div>
                      <div className="text-orange-700 dark:text-orange-500 font-bold">{formatDueValue(farmer.merchantDue)}</div>
                    </div>
                    <div>
                      <div className="text-red-600 dark:text-red-500 font-medium">{t("totalDues")}</div>
                      <div className="text-red-600 dark:text-red-500 font-bold">{formatDueValue(farmer.totalDue)}</div>
                    </div>
                  </div>
                </Card>
              ))}
              {showArchived && filteredFarmers.archived.map(farmer => (
                <Card key={farmer.id} className="p-3 opacity-60 bg-muted/20" data-testid={`card-archived-farmer-${farmer.id}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">{farmer.farmerId}</span>
                      {farmer.isFlagged === 1 && (
                        <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4">{t("flagged")}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Switch checked={farmer.isFlagged === 1} disabled />
                      <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => handleEditClick(farmer)}>
                        <Pencil className="w-3 h-3" />
                      </Button>
                      {canEdit && (
                        <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => reinstateMutation.mutate(farmer.id)}>
                          <RotateCcw className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="font-medium text-base mb-1">{farmer.name}</div>
                  <div className="text-sm text-muted-foreground mb-2">{farmer.village} | {farmer.contactNumber}</div>
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <Popover>
                      <PopoverTrigger asChild>
                        <div className="cursor-pointer">
                          <div className="text-blue-600 dark:text-blue-400 font-medium">{t("pyReceivables")}</div>
                          <div className="text-blue-600 dark:text-blue-400 font-bold">{formatDueValue(farmer.pyReceivables + farmer.advanceDue + farmer.freightDue)}</div>
                        </div>
                      </PopoverTrigger>
                      {(farmer.advanceDue > 0 || farmer.freightDue > 0) && (
                        <PopoverContent className="w-56 p-3" data-testid={`hover-receivable-breakup-archived-card-${farmer.id}`}>
                          <div className="text-xs font-semibold mb-2">{t("receivableBreakup")}</div>
                          <div className="space-y-1 text-xs">
                            <div className="flex justify-between">
                              <span>{t("receivableAmount")}</span>
                              <span className="font-medium">{formatDueValue(farmer.pyReceivables)}</span>
                            </div>
                            {farmer.advanceDue > 0 && (
                              <div className="flex justify-between">
                                <span>{t("advanceTotal")}</span>
                                <span className="font-medium">{formatDueValue(farmer.advanceDue)}</span>
                              </div>
                            )}
                            {farmer.freightDue > 0 && (
                              <div className="flex justify-between">
                                <span>{t("freightTotal")}</span>
                                <span className="font-medium">{formatDueValue(farmer.freightDue)}</span>
                              </div>
                            )}
                            <div className="flex justify-between border-t pt-1 font-semibold">
                              <span>{t("total")}</span>
                              <span>{formatDueValue(farmer.pyReceivables + farmer.advanceDue + farmer.freightDue)}</span>
                            </div>
                          </div>
                        </PopoverContent>
                      )}
                    </Popover>
                    <div>
                      <div className="text-orange-500 dark:text-orange-400 font-medium">{t("selfDue")}</div>
                      <div className="text-orange-500 dark:text-orange-400 font-bold">{formatDueValue(farmer.selfDue)}</div>
                    </div>
                    <div>
                      <div className="text-orange-700 dark:text-orange-500 font-medium">{t("merchantDues")}</div>
                      <div className="text-orange-700 dark:text-orange-500 font-bold">{formatDueValue(farmer.merchantDue)}</div>
                    </div>
                    <div>
                      <div className="text-red-600 dark:text-red-500 font-medium">{t("totalDues")}</div>
                      <div className="text-red-600 dark:text-red-500 font-bold">{formatDueValue(farmer.totalDue)}</div>
                    </div>
                  </div>
                </Card>
              ))}
              </div>
            </ScrollArea>

            {/* Tablet/Desktop Table View - with both scrolls */}
            <div className="hidden md:flex flex-col flex-1 min-h-0 border rounded-lg overflow-auto pb-4">
              <table className="text-sm" style={{ minWidth: '1000px', width: '100%' }}>
                <colgroup>
                  <col className="w-10" />
                  <col className="w-[140px]" />
                  <col className="w-[180px]" />
                  <col className="w-[120px]" />
                  <col className="w-[100px]" />
                  <col className="w-[90px]" />
                  <col className="w-[80px]" />
                  <col className="w-[90px]" />
                  <col className="w-[80px]" />
                  <col className="w-[90px]" />
                </colgroup>
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground"></th>
                    <SortHeader field="farmerId" className="text-muted-foreground">{t("farmerId")}</SortHeader>
                    <SortHeader field="name" className="text-muted-foreground">{t("name")}</SortHeader>
                    <SortHeader field="village" className="text-muted-foreground">{t("village")}</SortHeader>
                    <SortHeader field="contactNumber" className="text-muted-foreground">{t("contact")}</SortHeader>
                    <SortHeader field="pyReceivables" className="text-blue-600 dark:text-blue-400" center>{t("pyReceivables")}</SortHeader>
                    <SortHeader field="selfDue" className="text-orange-500 dark:text-orange-400" center>{t("selfDue")}</SortHeader>
                    <SortHeader field="merchantDue" className="text-orange-700 dark:text-orange-500" center>{t("merchantDues")}</SortHeader>
                    <SortHeader field="totalDue" className="text-red-600 dark:text-red-500" center>{t("totalDues")}</SortHeader>
                    <th className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">{t("actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredFarmers.active.map(farmer => (
                    <tr key={farmer.id} className="hover:bg-muted/30" data-testid={`row-farmer-${farmer.id}`}>
                      <td className="px-2 py-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="w-6 h-6"
                          onClick={() => handleEditClick(farmer)}
                          data-testid={`button-edit-${farmer.id}`}
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                      </td>
                      <td className="px-2 py-2" data-testid={`text-farmer-id-${farmer.id}`}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-xs">{farmer.farmerId}</span>
                          {farmer.isFlagged === 1 && (
                            <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4">{t("flagged")}</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2 font-medium truncate" data-testid={`text-farmer-name-${farmer.id}`}>{farmer.name}</td>
                      <td className="px-2 py-2 text-muted-foreground truncate">{farmer.village}</td>
                      <td className="px-2 py-2 text-muted-foreground text-xs">{farmer.contactNumber}</td>
                      <td className="px-2 py-2 text-center text-blue-600 dark:text-blue-400">
                        {(farmer.advanceDue > 0 || farmer.freightDue > 0) ? (
                          <Popover>
                            <PopoverTrigger asChild>
                              <span className="cursor-pointer underline decoration-dotted">{formatDueValue(farmer.pyReceivables + (farmer.advanceDue || 0) + (farmer.freightDue || 0))}</span>
                            </PopoverTrigger>
                            <PopoverContent className="w-56 p-3" data-testid={`hover-receivable-breakup-table-${farmer.id}`}>
                              <div className="text-xs font-semibold mb-2">{t("receivableBreakup")}</div>
                              <div className="space-y-1 text-xs">
                                <div className="flex justify-between">
                                  <span>{t("receivableAmount")}</span>
                                  <span className="font-medium">{formatDueValue(farmer.pyReceivables)}</span>
                                </div>
                                {farmer.advanceDue > 0 && (
                                  <div className="flex justify-between">
                                    <span>{t("advanceTotal")}</span>
                                    <span className="font-medium">{formatDueValue(farmer.advanceDue)}</span>
                                  </div>
                                )}
                                {farmer.freightDue > 0 && (
                                  <div className="flex justify-between">
                                    <span>{t("freightTotal")}</span>
                                    <span className="font-medium">{formatDueValue(farmer.freightDue)}</span>
                                  </div>
                                )}
                                <div className="flex justify-between border-t pt-1 font-semibold">
                                  <span>{t("total")}</span>
                                  <span>{formatDueValue(farmer.pyReceivables + farmer.advanceDue + farmer.freightDue)}</span>
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                        ) : (
                          formatDueValue(farmer.pyReceivables + (farmer.advanceDue || 0) + (farmer.freightDue || 0))
                        )}
                      </td>
                      <td className="px-2 py-2 text-center text-orange-500 dark:text-orange-400">{formatDueValue(farmer.selfDue)}</td>
                      <td className="px-2 py-2 text-center text-orange-700 dark:text-orange-500">{formatDueValue(farmer.merchantDue)}</td>
                      <td className="px-2 py-2 text-center font-medium text-red-600 dark:text-red-500">{formatDueValue(farmer.totalDue)}</td>
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <Switch
                            checked={farmer.isFlagged === 1}
                            onCheckedChange={() => flagMutation.mutate(farmer.id)}
                            data-testid={`switch-flag-${farmer.id}`}
                          />
                          {canEdit && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="w-6 h-6"
                              onClick={() => archiveMutation.mutate(farmer.id)}
                              data-testid={`button-archive-${farmer.id}`}
                            >
                              <Archive className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {showArchived && filteredFarmers.archived.map(farmer => (
                    <tr key={farmer.id} className="hover:bg-muted/30 opacity-60 bg-muted/20" data-testid={`row-archived-farmer-${farmer.id}`}>
                      <td className="px-2 py-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="w-6 h-6"
                          onClick={() => handleEditClick(farmer)}
                          data-testid={`button-edit-archived-${farmer.id}`}
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-xs">{farmer.farmerId}</span>
                          {farmer.isFlagged === 1 && (
                            <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4">{t("flagged")}</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2 font-medium truncate">{farmer.name}</td>
                      <td className="px-2 py-2 text-muted-foreground truncate">{farmer.village}</td>
                      <td className="px-2 py-2 text-muted-foreground text-xs">{farmer.contactNumber}</td>
                      <td className="px-2 py-2 text-center text-blue-600 dark:text-blue-400">
                        {(farmer.advanceDue > 0 || farmer.freightDue > 0) ? (
                          <Popover>
                            <PopoverTrigger asChild>
                              <span className="cursor-pointer underline decoration-dotted">{formatDueValue(farmer.pyReceivables + (farmer.advanceDue || 0) + (farmer.freightDue || 0))}</span>
                            </PopoverTrigger>
                            <PopoverContent className="w-56 p-3" data-testid={`hover-receivable-breakup-archived-${farmer.id}`}>
                              <div className="text-xs font-semibold mb-2">{t("receivableBreakup")}</div>
                              <div className="space-y-1 text-xs">
                                <div className="flex justify-between">
                                  <span>{t("receivableAmount")}</span>
                                  <span className="font-medium">{formatDueValue(farmer.pyReceivables)}</span>
                                </div>
                                {farmer.advanceDue > 0 && (
                                  <div className="flex justify-between">
                                    <span>{t("advanceTotal")}</span>
                                    <span className="font-medium">{formatDueValue(farmer.advanceDue)}</span>
                                  </div>
                                )}
                                {farmer.freightDue > 0 && (
                                  <div className="flex justify-between">
                                    <span>{t("freightTotal")}</span>
                                    <span className="font-medium">{formatDueValue(farmer.freightDue)}</span>
                                  </div>
                                )}
                                <div className="flex justify-between border-t pt-1 font-semibold">
                                  <span>{t("total")}</span>
                                  <span>{formatDueValue(farmer.pyReceivables + farmer.advanceDue + farmer.freightDue)}</span>
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                        ) : (
                          formatDueValue(farmer.pyReceivables + (farmer.advanceDue || 0) + (farmer.freightDue || 0))
                        )}
                      </td>
                      <td className="px-2 py-2 text-center text-orange-500 dark:text-orange-400">{formatDueValue(farmer.selfDue)}</td>
                      <td className="px-2 py-2 text-center text-orange-700 dark:text-orange-500">{formatDueValue(farmer.merchantDue)}</td>
                      <td className="px-2 py-2 text-center font-medium text-red-600 dark:text-red-500">{formatDueValue(farmer.totalDue)}</td>
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <Switch
                            checked={farmer.isFlagged === 1}
                            disabled
                            data-testid={`switch-flag-archived-${farmer.id}`}
                          />
                          {canEdit && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="w-6 h-6"
                              onClick={() => reinstateMutation.mutate(farmer.id)}
                              data-testid={`button-reinstate-${farmer.id}`}
                            >
                              <RotateCcw className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <Dialog open={!!editingFarmer} onOpenChange={(open) => !open && setEditingFarmer(null)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("editFarmer")}</DialogTitle>
            <DialogDescription>
              {editingFarmer?.farmerId}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("farmerName")}</Label>
              <Input
                value={editFormData.name}
                onChange={(e) => setEditFormData(prev => ({ ...prev, name: e.target.value }))}
                data-testid="input-edit-name"
              />
            </div>
            <div>
              <Label>{t("contactNumber")}</Label>
              <Input
                value={editFormData.contactNumber}
                onChange={(e) => setEditFormData(prev => ({ ...prev, contactNumber: e.target.value }))}
                data-testid="input-edit-contact"
              />
            </div>
            <div>
              <Label>{t("village")}</Label>
              <Input
                value={editFormData.village}
                onChange={(e) => setEditFormData(prev => ({ ...prev, village: e.target.value }))}
                data-testid="input-edit-village"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("tehsil")}</Label>
                <Input
                  value={editFormData.tehsil}
                  onChange={(e) => setEditFormData(prev => ({ ...prev, tehsil: e.target.value }))}
                  data-testid="input-edit-tehsil"
                />
              </div>
              <div>
                <Label>{t("district")}</Label>
                <Input
                  value={editFormData.district}
                  onChange={(e) => setEditFormData(prev => ({ ...prev, district: e.target.value }))}
                  data-testid="input-edit-district"
                />
              </div>
            </div>
            <div>
              <Label>{t("state")}</Label>
              <Input
                value={editFormData.state}
                onChange={(e) => setEditFormData(prev => ({ ...prev, state: e.target.value }))}
                data-testid="input-edit-state"
              />
            </div>

            {editHistory && editHistory.length > 0 && (
              <div>
                <Label className="text-sm font-medium">{t("editHistory")}</Label>
                <ScrollArea className="max-h-32 mt-2 border rounded-md p-2">
                  {editHistory.map(entry => {
                    const fieldLabels: Record<string, string> = {
                      name: t("farmerName"),
                      contactNumber: t("contactNumber"),
                      village: t("village"),
                      tehsil: t("tehsil"),
                      district: t("district"),
                      state: t("state"),
                      isArchived: t("archived")
                    };
                    
                    let changes: { field: string; oldValue: string; newValue: string }[] = [];
                    if (entry.editType === 'edit' && entry.beforeValues && entry.afterValues) {
                      try {
                        const before = JSON.parse(entry.beforeValues);
                        const after = JSON.parse(entry.afterValues);
                        Object.keys(after).forEach(key => {
                          if (before[key] !== after[key]) {
                            const formatValue = (val: unknown): string => {
                              if (val === null || val === undefined) return '-';
                              if (typeof val === 'boolean') return val ? 'Yes' : 'No';
                              if (key === 'isArchived') return val ? t("yes") : t("no");
                              return String(val) || '-';
                            };
                            changes.push({
                              field: fieldLabels[key] || key,
                              oldValue: formatValue(before[key]),
                              newValue: formatValue(after[key])
                            });
                          }
                        });
                      } catch {
                        changes = [];
                      }
                    }
                    
                    return (
                      <div key={entry.id} className="text-xs mb-2 pb-2 border-b last:border-0">
                        <div className="flex justify-between text-muted-foreground mb-1">
                          <span className="font-medium">
                            {entry.editType === 'merge' ? t("merge") : t("edit")}
                            {entry.modifiedBy && <span className="ml-1">({entry.modifiedBy})</span>}
                          </span>
                          <span>{format(new Date(entry.modifiedAt), 'dd/MM/yyyy HH:mm')}</span>
                        </div>
                        {entry.editType === 'merge' && (entry.mergedFromFarmerId || entry.mergedFromId) && (
                          <div className="mt-1 p-2 bg-muted/50 rounded-md space-y-1">
                            <div className="font-medium text-destructive">
                              {t("mergedFrom")}: {entry.mergedFromFarmerId || entry.mergedFromId}
                            </div>
                            {(entry.mergedLotsCount !== null || entry.mergedReceivablesCount !== null || entry.mergedSalesCount !== null) && (
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                                {(entry.mergedLotsCount !== null && entry.mergedLotsCount > 0) && (
                                  <span>{t("lotsTransferred")}: {entry.mergedLotsCount}</span>
                                )}
                                {(entry.mergedReceivablesCount !== null && entry.mergedReceivablesCount > 0) && (
                                  <span>{t("receivablesTransferred")}: {entry.mergedReceivablesCount}</span>
                                )}
                                {(entry.mergedSalesCount !== null && entry.mergedSalesCount > 0) && (
                                  <span>{t("salesTransferred")}: {entry.mergedSalesCount}</span>
                                )}
                              </div>
                            )}
                            {entry.mergedTotalDues && parseFloat(entry.mergedTotalDues) > 0 && (
                              <div className="font-medium">
                                {t("totalDuesTransferred")}: ₹{parseFloat(entry.mergedTotalDues).toLocaleString('en-IN')}
                              </div>
                            )}
                          </div>
                        )}
                        {changes.length > 0 && (
                          <div className="mt-1 space-y-1">
                            {changes.map((change, idx) => (
                              <div key={idx} className="break-words">
                                <span className="font-medium">{change.field}:</span>{" "}
                                <span className="text-muted-foreground line-through break-all">{change.oldValue}</span>
                                <span className="mx-1">→</span>
                                <span className="font-semibold break-all">{change.newValue}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </ScrollArea>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingFarmer(null)} data-testid="button-cancel-edit">
                {t("cancel")}
              </Button>
              <Button 
                onClick={handleSaveEdit} 
                disabled={updateMutation.isPending || checkMergeMutation.isPending}
                data-testid="button-save-edit"
              >
                {(updateMutation.isPending || checkMergeMutation.isPending) ? t("saving") : t("save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Merge Confirmation Dialog */}
      <Dialog open={mergeConfirmOpen} onOpenChange={(open) => !open && handleCancelMerge()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("mergeConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("mergeConfirmMessage")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {pendingMergeInfo?.targetFarmer && (
              <div className="p-3 bg-muted rounded-md space-y-2">
                <div className="font-medium">
                  {t("existingFarmer")}: {pendingMergeInfo.targetFarmer.farmerId}
                </div>
                <div className="text-sm text-muted-foreground">
                  {pendingMergeInfo.targetFarmer.name} - {pendingMergeInfo.targetFarmer.village}
                </div>
              </div>
            )}
            
            <p className="text-sm">{t("mergeConfirmDetails")}</p>
            
            {pendingMergeInfo && (pendingMergeInfo.lotsCount > 0 || pendingMergeInfo.receivablesCount > 0 || pendingMergeInfo.salesCount > 0) && (
              <div className="p-3 bg-muted/50 rounded-md space-y-1 text-sm">
                {pendingMergeInfo.lotsCount > 0 && (
                  <div>{t("lotsTransferred")}: {pendingMergeInfo.lotsCount}</div>
                )}
                {pendingMergeInfo.receivablesCount > 0 && (
                  <div>{t("receivablesTransferred")}: {pendingMergeInfo.receivablesCount}</div>
                )}
                {pendingMergeInfo.salesCount > 0 && (
                  <div>{t("salesTransferred")}: {pendingMergeInfo.salesCount}</div>
                )}
                {pendingMergeInfo.totalDues > 0 && (
                  <div className="font-medium mt-2">
                    {t("combinedDues")}: ₹{pendingMergeInfo.totalDues.toLocaleString('en-IN')}
                  </div>
                )}
              </div>
            )}
            
            <p className="font-medium">{t("mergeConfirmAsk")}</p>
            
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleCancelMerge} data-testid="button-cancel-merge">
                {t("no")}
              </Button>
              <Button 
                onClick={handleConfirmMerge}
                disabled={updateMutation.isPending}
                data-testid="button-confirm-merge"
              >
                {updateMutation.isPending ? t("saving") : t("yes")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
