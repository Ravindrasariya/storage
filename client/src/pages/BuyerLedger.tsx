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
import { Users, RefreshCw, Search, Archive, RotateCcw, Pencil, ArrowUpDown, Printer, ShoppingCart } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/components/Currency";
import { format } from "date-fns";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { BuyerLedgerEntry, BuyerLedgerEditHistoryEntry } from "@shared/schema";

interface BuyerWithDues extends BuyerLedgerEntry {
  pyReceivables: number;
  dueTransferOut: number;
  dueTransferIn: number;
  salesDue: number;
  netDue: number;
}

interface BuyerLedgerData {
  buyers: BuyerWithDues[];
  summary: {
    totalBuyers: number;
    pyReceivables: number;
    dueTransferOut: number;
    dueTransferIn: number;
    salesDue: number;
    netDue: number;
  };
}

type SortField = 'buyerId' | 'buyerName' | 'address' | 'pyReceivables' | 'salesDue' | 'dueTransferIn' | 'netDue';
type SortDirection = 'asc' | 'desc';

export default function BuyerLedger() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { canEdit, coldStorage } = useAuth();
  const coldStorageId = coldStorage?.id || "";

  const [nameSearch, setNameSearch] = useState("");
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>('buyerId');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [editingBuyer, setEditingBuyer] = useState<BuyerWithDues | null>(null);
  const [editFormData, setEditFormData] = useState({
    buyerName: "",
    address: "",
    contactNumber: "",
  });
  const [mergeConfirmOpen, setMergeConfirmOpen] = useState(false);
  const [pendingMergeInfo, setPendingMergeInfo] = useState<{
    targetBuyer?: BuyerLedgerEntry;
    salesCount: number;
    transfersCount: number;
    totalDues: number;
  } | null>(null);

  const { data: ledgerData, isLoading } = useQuery<BuyerLedgerData>({
    queryKey: ['/api/buyer-ledger', { includeArchived: showArchived }],
    queryFn: () => authFetch(`/api/buyer-ledger?includeArchived=${showArchived}`).then(res => res.json()),
    enabled: !!coldStorageId,
  });

  const { data: editHistory } = useQuery<BuyerLedgerEditHistoryEntry[]>({
    queryKey: ['/api/buyer-ledger', editingBuyer?.id, 'history'],
    queryFn: () => authFetch(`/api/buyer-ledger/${editingBuyer?.id}/history`).then(res => res.json()),
    enabled: !!editingBuyer?.id,
  });

  const syncMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/buyer-ledger/sync'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/buyer-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['/api/buyers/lookup'] });
      toast({ title: t("buyersSynced") });
    },
    onError: () => {
      toast({ title: t("buyersSyncFailed"), variant: "destructive" });
    },
  });

  const checkMergeMutation = useMutation({
    mutationFn: async (data: { id: string; updates: Partial<BuyerLedgerEntry> }) => {
      const response = await apiRequest('POST', `/api/buyer-ledger/${data.id}/check-merge`, data.updates);
      return response.json() as Promise<{
        willMerge: boolean;
        targetBuyer?: BuyerLedgerEntry;
        salesCount: number;
        transfersCount: number;
        totalDues: number;
      }>;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; updates: Partial<BuyerLedgerEntry>; confirmMerge?: boolean }) => {
      const response = await apiRequest('PATCH', `/api/buyer-ledger/${data.id}`, { ...data.updates, confirmMerge: data.confirmMerge });
      return response.json() as Promise<{ merged: boolean; mergedFromId?: string; needsConfirmation?: boolean }>;
    },
    onSuccess: (result) => {
      if (result.needsConfirmation) {
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['/api/buyer-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['/api/buyers/lookup'] });
      if (result.merged) {
        toast({ title: t("mergedFrom") + " " + result.mergedFromId });
      } else {
        toast({ title: t("saved") });
      }
      setEditingBuyer(null);
      setMergeConfirmOpen(false);
      setPendingMergeInfo(null);
    },
    onError: () => {
      toast({ title: t("saveFailed"), variant: "destructive" });
    },
  });

  const flagMutation = useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/api/buyer-ledger/${id}/flag`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/buyer-ledger'] });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/api/buyer-ledger/${id}/archive`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/buyer-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['/api/buyers/lookup'] });
      toast({ title: t("buyerArchived") });
    },
  });

  const reinstateMutation = useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/api/buyer-ledger/${id}/reinstate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/buyer-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['/api/buyers/lookup'] });
      toast({ title: t("buyerReinstated") });
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

  const availableYears = useMemo(() => {
    if (!ledgerData?.buyers) return [];
    const years = new Set<number>();
    ledgerData.buyers.forEach(buyer => {
      if (buyer.createdAt) {
        const year = new Date(buyer.createdAt).getFullYear();
        years.add(year);
      }
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [ledgerData?.buyers]);

  const filteredBuyers = useMemo(() => {
    if (!ledgerData?.buyers) return { active: [], archived: [] };

    let filtered = ledgerData.buyers
      .filter(buyer => {
        const matchesName = !nameSearch || 
          buyer.buyerName.toLowerCase().includes(nameSearch.toLowerCase());
        
        const matchesYear = yearFilter === "all" || 
          (buyer.createdAt && new Date(buyer.createdAt).getFullYear().toString() === yearFilter);
        
        return matchesName && matchesYear;
      });

    filtered = [...filtered].sort((a, b) => {
      let aVal: string | number = a[sortField] ?? 0;
      let bVal: string | number = b[sortField] ?? 0;
      
      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = (bVal as string).toLowerCase();
      }
      
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return {
      active: filtered.filter(b => b.isArchived !== 1),
      archived: filtered.filter(b => b.isArchived === 1),
    };
  }, [ledgerData?.buyers, nameSearch, yearFilter, sortField, sortDirection]);

  const handleEditClick = (buyer: BuyerWithDues) => {
    setEditFormData({
      buyerName: buyer.buyerName,
      address: buyer.address || "",
      contactNumber: buyer.contactNumber || "",
    });
    setEditingBuyer(buyer);
  };

  const handleSaveEdit = async () => {
    if (!editingBuyer) return;
    
    try {
      const mergeCheck = await checkMergeMutation.mutateAsync({
        id: editingBuyer.id,
        updates: editFormData,
      });
      
      if (mergeCheck.willMerge) {
        setPendingMergeInfo(mergeCheck);
        setMergeConfirmOpen(true);
        return;
      }
      
      updateMutation.mutate({
        id: editingBuyer.id,
        updates: editFormData,
      });
    } catch {
      toast({ title: t("saveFailed"), variant: "destructive" });
    }
  };

  const handleConfirmMerge = () => {
    if (!editingBuyer) return;
    updateMutation.mutate({
      id: editingBuyer.id,
      updates: editFormData,
      confirmMerge: true,
    });
  };

  const handleCancelMerge = () => {
    setMergeConfirmOpen(false);
    setPendingMergeInfo(null);
  };

  const summary = useMemo(() => {
    const displayedBuyers = [...filteredBuyers.active, ...(showArchived ? filteredBuyers.archived : [])];
    return {
      totalBuyers: displayedBuyers.length,
      pyReceivables: displayedBuyers.reduce((sum, b) => sum + (b.pyReceivables || 0), 0),
      dueTransferIn: displayedBuyers.reduce((sum, b) => sum + (b.dueTransferIn || 0), 0),
      salesDue: displayedBuyers.reduce((sum, b) => sum + (b.salesDue || 0), 0),
      netDue: displayedBuyers.reduce((sum, b) => sum + (b.netDue || 0), 0),
    };
  }, [filteredBuyers, showArchived]);

  const nameSuggestions = useMemo(() => {
    if (!nameSearch || nameSearch.length < 1 || !ledgerData?.buyers) return [];
    const searchLower = nameSearch.toLowerCase();
    return ledgerData.buyers
      .filter(b => b.buyerName.toLowerCase().includes(searchLower))
      .slice(0, 8);
  }, [nameSearch, ledgerData?.buyers]);

  const formatDueValue = (value: number | undefined | null): string => {
    const num = value ?? 0;
    if (isNaN(num)) return formatCurrency(0);
    return formatCurrency(num);
  };

  const getTransferInColor = (value: number | undefined | null): string => {
    const num = value ?? 0;
    if (num < 0) return "text-red-600 dark:text-red-500";
    if (num > 0) return "text-green-600 dark:text-green-400";
    return "text-muted-foreground";
  };

  const getDueColorClass = (value: number | undefined | null): string => {
    const num = value ?? 0;
    if (isNaN(num) || num === 0) return "text-muted-foreground";
    if (num > 0) return "text-amber-600 dark:text-amber-500";
    return "text-rose-600 dark:text-rose-500";
  };

  const handlePrint = useCallback(() => {
    const buyersToExport = showArchived 
      ? [...filteredBuyers.active, ...filteredBuyers.archived]
      : filteredBuyers.active;

    if (buyersToExport.length === 0) {
      toast({ title: t("noBuyersFound"), variant: "destructive" });
      return;
    }

    const doc = new jsPDF({ orientation: 'landscape' });
    const pageWidth = doc.internal.pageSize.getWidth();
    
    doc.setFontSize(16);
    doc.text(t("buyerLedger"), pageWidth / 2, 15, { align: 'center' });
    doc.setFontSize(10);
    doc.text(`${t("coldStorage")}: ${coldStorage?.name || ''}`, pageWidth / 2, 22, { align: 'center' });
    doc.text(`${t("date")}: ${format(new Date(), 'dd/MM/yyyy')}`, pageWidth / 2, 28, { align: 'center' });

    const tableData = buyersToExport.map(buyer => [
      buyer.buyerId,
      buyer.buyerName,
      buyer.address || '-',
      buyer.contactNumber || '-',
      formatDueValue(buyer.pyReceivables),
      formatDueValue(buyer.salesDue),
      formatDueValue(buyer.dueTransferIn),
      formatDueValue(buyer.netDue),
    ]);

    tableData.push([
      '',
      t("total"),
      '',
      '',
      formatDueValue(summary.pyReceivables),
      formatDueValue(summary.salesDue),
      formatDueValue(summary.dueTransferIn),
      formatDueValue(summary.netDue),
    ]);

    autoTable(doc, {
      head: [[
        t("buyerId"),
        t("buyerName"),
        t("address"),
        t("contact"),
        t("pyReceivables"),
        t("salesDue"),
        t("transferIn"),
        t("netDue"),
      ]],
      body: tableData,
      startY: 35,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [59, 130, 246] },
    });

    doc.save(`buyer-ledger-${format(new Date(), 'yyyyMMdd')}.pdf`);
  }, [filteredBuyers, showArchived, coldStorage?.name, summary, t, toast]);

  const SortButton = ({ field, label, align, colorClass }: { field: SortField; label: string; align?: 'left' | 'right' | 'center'; colorClass?: string }) => (
    <Button
      variant="ghost"
      size="sm"
      className={`font-bold gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'} ${colorClass || ''}`}
      onClick={() => handleSort(field)}
      data-testid={`button-sort-${field}`}
    >
      {label}
      {sortField === field && (
        <ArrowUpDown className="h-3 w-3" />
      )}
    </Button>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <ShoppingCart className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold" data-testid="text-buyer-ledger-title">{t("buyerLedger")}</h1>
        <Badge variant="outline" className="ml-2">{summary.totalBuyers} {t("buyers")}</Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 pt-3">
        <Card className="py-1">
          <CardHeader className="py-1 px-3">
            <CardTitle className="text-xs font-medium text-blue-600 dark:text-blue-400">{t("pyReceivables")}</CardTitle>
          </CardHeader>
          <CardContent className="py-1 px-3">
            <div className="text-base font-bold text-blue-600 dark:text-blue-400" data-testid="text-py-receivables">{formatDueValue(summary.pyReceivables)}</div>
          </CardContent>
        </Card>
        <Card className="py-1">
          <CardHeader className="py-1 px-3">
            <CardTitle className="text-xs font-medium text-green-600 dark:text-green-400">{t("salesDue")}</CardTitle>
          </CardHeader>
          <CardContent className="py-1 px-3">
            <div className="text-base font-bold text-green-600 dark:text-green-400" data-testid="text-sales-due">{formatDueValue(summary.salesDue)}</div>
          </CardContent>
        </Card>
        <Card className="py-1">
          <CardHeader className="py-1 px-3">
            <CardTitle className={`text-xs font-medium ${getTransferInColor(summary.dueTransferIn)}`}>{t("transferIn")}</CardTitle>
          </CardHeader>
          <CardContent className="py-1 px-3">
            <div className={`text-base font-bold ${getTransferInColor(summary.dueTransferIn)}`} data-testid="text-transfer-in">{formatDueValue(summary.dueTransferIn)}</div>
          </CardContent>
        </Card>
        <Card className="py-1">
          <CardHeader className="py-1 px-3">
            <CardTitle className="text-xs font-medium text-red-600 dark:text-red-500">{t("netDue")}</CardTitle>
          </CardHeader>
          <CardContent className="py-1 px-3">
            <div className="text-base font-bold text-red-600 dark:text-red-500" data-testid="text-net-due">{formatDueValue(summary.netDue)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="px-4 pb-3 pt-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <ShoppingCart className="w-4 h-4 text-muted-foreground" />
        </div>
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
            className="w-[200px]"
            data-testid="input-search-name"
          />
          {showNameSuggestions && nameSuggestions.length > 0 && (
            <div className="absolute top-full left-0 mt-1 w-[280px] max-w-[90vw] bg-popover border rounded-md shadow-lg z-50 max-h-64 overflow-y-auto">
              {nameSuggestions.map(buyer => (
                <div
                  key={buyer.id}
                  className="px-3 py-2 cursor-pointer hover:bg-accent border-b last:border-b-0"
                  onMouseDown={() => {
                    setNameSearch(buyer.buyerName);
                    setShowNameSuggestions(false);
                  }}
                  data-testid={`suggestion-buyer-${buyer.id}`}
                >
                  <div className="font-medium text-sm">{buyer.buyerName}</div>
                  <div className="text-xs text-muted-foreground flex gap-3">
                    <span>{buyer.contactNumber || '-'}</span>
                    <span>{buyer.address || '-'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <Select value={yearFilter} onValueChange={setYearFilter}>
          <SelectTrigger className="w-[120px]" data-testid="select-year-filter">
            <SelectValue placeholder={t("allYears")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allYears")}</SelectItem>
            {availableYears.map(year => (
              <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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
            data-testid="button-sync-buyers"
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
        ) : filteredBuyers.active.length === 0 && filteredBuyers.archived.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground" data-testid="text-no-buyers">
            {t("noBuyersFound")}
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1 md:hidden">
              <div className="pb-4 space-y-3">
              {filteredBuyers.active.map(buyer => (
                <Card key={buyer.id} className="p-3" data-testid={`card-buyer-${buyer.id}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">{buyer.buyerId}</span>
                      {buyer.isFlagged === 1 && (
                        <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4">{t("flagged")}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Switch
                        checked={buyer.isFlagged === 1}
                        onCheckedChange={() => flagMutation.mutate(buyer.id)}
                        data-testid={`switch-flag-mobile-${buyer.id}`}
                      />
                      <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => handleEditClick(buyer)}>
                        <Pencil className="w-3 h-3" />
                      </Button>
                      {canEdit && (
                        <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => archiveMutation.mutate(buyer.id)}>
                          <Archive className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="font-medium text-base mb-1">{buyer.buyerName}</div>
                  <div className="text-sm text-muted-foreground mb-2">{buyer.address || '-'} | {buyer.contactNumber || '-'}</div>
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div>
                      <div className="text-blue-600 dark:text-blue-400 font-medium">{t("pyReceivables")}</div>
                      <div className="text-blue-600 dark:text-blue-400 font-bold">{formatDueValue(buyer.pyReceivables)}</div>
                    </div>
                    <div>
                      <div className="text-green-600 dark:text-green-400 font-medium">{t("salesDue")}</div>
                      <div className="text-green-600 dark:text-green-400 font-bold">{formatDueValue(buyer.salesDue)}</div>
                    </div>
                    <div>
                      <div className={`${getTransferInColor(buyer.dueTransferIn)} font-medium`}>{t("transferIn")}</div>
                      <div className={`${getTransferInColor(buyer.dueTransferIn)} font-bold`}>{formatDueValue(buyer.dueTransferIn)}</div>
                    </div>
                    <div>
                      <div className="text-red-600 dark:text-red-500 font-medium">{t("netDue")}</div>
                      <div className="text-red-600 dark:text-red-500 font-bold">{formatDueValue(buyer.netDue)}</div>
                    </div>
                  </div>
                </Card>
              ))}
              {showArchived && filteredBuyers.archived.length > 0 && (
                <>
                  <div className="text-sm font-medium text-muted-foreground py-2">{t("archivedBuyers")}</div>
                  {filteredBuyers.archived.map(buyer => (
                    <Card key={buyer.id} className="p-3 opacity-60" data-testid={`card-buyer-archived-${buyer.id}`}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs text-muted-foreground">{buyer.buyerId}</span>
                          <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">{t("archived")}</Badge>
                        </div>
                        {canEdit && (
                          <Button size="sm" variant="ghost" onClick={() => reinstateMutation.mutate(buyer.id)}>
                            <RotateCcw className="w-3 h-3 mr-1" />
                            {t("reinstate")}
                          </Button>
                        )}
                      </div>
                      <div className="font-medium text-base mb-1">{buyer.buyerName}</div>
                      <div className="text-sm text-muted-foreground">{buyer.address || '-'}</div>
                    </Card>
                  ))}
                </>
              )}
              </div>
            </ScrollArea>

            <div className="hidden md:flex flex-col flex-1 overflow-hidden border rounded-lg">
              <div className="flex-1 overflow-auto">
                <table className="w-full min-w-[950px] text-sm">
                  <thead className="bg-muted/50 sticky top-0 z-10">
                    <tr className="border-b">
                      <th className="w-8 p-2"></th>
                      <th className="w-24 p-2 text-left"><SortButton field="buyerId" label={t("buyerId")} /></th>
                      <th className="min-w-[150px] p-2 text-left"><SortButton field="buyerName" label={t("buyerName")} /></th>
                      <th className="min-w-[120px] p-2 text-left font-bold">{t("address")}</th>
                      <th className="min-w-[110px] p-2 text-left font-bold">{t("contact")}</th>
                      <th className="w-24 p-2"><SortButton field="pyReceivables" label={t("pyReceivables")} align="center" colorClass="text-blue-600 dark:text-blue-400" /></th>
                      <th className="w-20 p-2"><SortButton field="salesDue" label={t("salesDue")} align="center" colorClass="text-green-600 dark:text-green-400" /></th>
                      <th className="w-24 p-2"><SortButton field="dueTransferIn" label={t("transferIn")} align="center" colorClass="text-purple-600 dark:text-purple-400" /></th>
                      <th className="w-20 p-2"><SortButton field="netDue" label={t("netDue")} align="center" colorClass="text-red-600 dark:text-red-500" /></th>
                      <th className="w-24 p-2 text-center font-bold">{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBuyers.active.map(buyer => (
                      <tr key={buyer.id} className="border-b hover:bg-muted/30" data-testid={`row-buyer-${buyer.id}`}>
                        <td className="p-2">
                          <Button size="icon" variant="ghost" className="w-6 h-6" onClick={() => handleEditClick(buyer)} data-testid={`button-edit-${buyer.id}`}>
                            <Pencil className="w-3 h-3" />
                          </Button>
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-xs text-muted-foreground">{buyer.buyerId}</span>
                            {buyer.isFlagged === 1 && (
                              <Badge variant="destructive" className="text-[8px] px-1 py-0 h-3">!</Badge>
                            )}
                          </div>
                        </td>
                        <td className="p-2 font-medium">{buyer.buyerName}</td>
                        <td className="p-2 text-muted-foreground text-xs">{buyer.address || '-'}</td>
                        <td className="p-2 text-muted-foreground text-xs">{buyer.contactNumber || '-'}</td>
                        <td className="p-2 text-center font-medium text-blue-600 dark:text-blue-400">{formatDueValue(buyer.pyReceivables)}</td>
                        <td className="p-2 text-center font-medium text-green-600 dark:text-green-400">{formatDueValue(buyer.salesDue)}</td>
                        <td className="p-2 text-center font-medium" style={{color: buyer.dueTransferIn > 0 ? 'rgb(147, 51, 234)' : buyer.dueTransferIn < 0 ? 'rgb(239, 68, 68)' : undefined}}>{formatDueValue(buyer.dueTransferIn)}</td>
                        <td className="p-2 text-center font-medium text-red-600 dark:text-red-500">{formatDueValue(buyer.netDue)}</td>
                        <td className="p-2">
                          <div className="flex items-center justify-center gap-1">
                            <Switch
                              checked={buyer.isFlagged === 1}
                              onCheckedChange={() => flagMutation.mutate(buyer.id)}
                              className="scale-75"
                              data-testid={`switch-flag-${buyer.id}`}
                            />
                            {canEdit && (
                              <Button size="icon" variant="ghost" className="w-6 h-6" onClick={() => archiveMutation.mutate(buyer.id)} data-testid={`button-archive-${buyer.id}`}>
                                <Archive className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}

                    {showArchived && filteredBuyers.archived.length > 0 && (
                      <>
                        <tr><td colSpan={10} className="p-2 bg-muted/30 text-sm font-medium text-muted-foreground">{t("archivedBuyers")}</td></tr>
                        {filteredBuyers.archived.map(buyer => (
                          <tr key={buyer.id} className="border-b opacity-60" data-testid={`row-buyer-archived-${buyer.id}`}>
                            <td className="p-2"></td>
                            <td className="p-2 font-mono text-xs text-muted-foreground">{buyer.buyerId}</td>
                            <td className="p-2 font-medium">{buyer.buyerName}</td>
                            <td className="p-2 text-muted-foreground text-xs">{buyer.address || '-'}</td>
                            <td className="p-2 text-muted-foreground text-xs">{buyer.contactNumber || '-'}</td>
                            <td className="p-2 text-center text-muted-foreground">-</td>
                            <td className="p-2 text-center text-muted-foreground">-</td>
                            <td className="p-2 text-center text-muted-foreground">-</td>
                            <td className="p-2 text-center text-muted-foreground">-</td>
                            <td className="p-2 text-center">
                              {canEdit && (
                                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => reinstateMutation.mutate(buyer.id)}>
                                  <RotateCcw className="w-3 h-3" />
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      <Dialog open={!!editingBuyer} onOpenChange={(open) => !open && setEditingBuyer(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("editBuyer")}</DialogTitle>
            <DialogDescription>
              {t("editBuyerDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="buyerName">{t("buyerName")}</Label>
              <Input
                id="buyerName"
                value={editFormData.buyerName}
                onChange={(e) => setEditFormData(prev => ({ ...prev, buyerName: e.target.value }))}
                data-testid="input-edit-buyer-name"
              />
            </div>
            <div>
              <Label htmlFor="address">{t("address")}</Label>
              <Input
                id="address"
                value={editFormData.address}
                onChange={(e) => setEditFormData(prev => ({ ...prev, address: e.target.value }))}
                data-testid="input-edit-address"
              />
            </div>
            <div>
              <Label htmlFor="contactNumber">{t("contact")}</Label>
              <Input
                id="contactNumber"
                value={editFormData.contactNumber}
                onChange={(e) => setEditFormData(prev => ({ ...prev, contactNumber: e.target.value }))}
                data-testid="input-edit-contact"
              />
            </div>
            {editHistory && editHistory.length > 0 && (
              <div className="border-t pt-3">
                <Label className="text-sm font-medium">{t("editHistory")}</Label>
                <ScrollArea className="h-32 mt-2">
                  <div className="space-y-2 text-xs">
                    {editHistory.map(entry => (
                      <div key={entry.id} className="p-2 bg-muted rounded">
                        <div className="flex justify-between text-muted-foreground">
                          <span>{entry.modifiedBy}</span>
                          <span>{format(new Date(entry.modifiedAt), 'dd/MM/yy HH:mm')}</span>
                        </div>
                        <div className="mt-1">
                          {entry.editType === 'merge' ? (
                            <span className="text-orange-600">{t("mergedFrom")} {entry.mergedFromBuyerId}</span>
                          ) : (
                            <span>{t("edited")}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditingBuyer(null)} data-testid="button-cancel-edit">
              {t("cancel")}
            </Button>
            <Button onClick={handleSaveEdit} disabled={updateMutation.isPending} data-testid="button-save-edit">
              {updateMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : t("save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={mergeConfirmOpen} onOpenChange={setMergeConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("confirmMerge")}</DialogTitle>
            <DialogDescription>
              {t("mergeWarning")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>{t("salesRecords")}:</span>
                <span className="font-medium">{pendingMergeInfo?.salesCount || 0}</span>
              </div>
              <div className="flex justify-between">
                <span>{t("transferRecords")}:</span>
                <span className="font-medium">{pendingMergeInfo?.transfersCount || 0}</span>
              </div>
              <div className="flex justify-between">
                <span>{t("totalDues")}:</span>
                <span className="font-medium">{formatDueValue(pendingMergeInfo?.totalDues)}</span>
              </div>
            </div>
            <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950 rounded-md text-sm">
              <span className="font-medium text-amber-800 dark:text-amber-200">{t("willMergeInto")}:</span>
              <div className="mt-1 text-amber-700 dark:text-amber-300">
                {pendingMergeInfo?.targetBuyer?.buyerName}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleCancelMerge} data-testid="button-cancel-merge">
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={handleConfirmMerge} disabled={updateMutation.isPending} data-testid="button-confirm-merge">
              {updateMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : t("confirmMerge")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
