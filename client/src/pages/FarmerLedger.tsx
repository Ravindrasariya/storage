import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, authFetch } from "@/lib/queryClient";
import { Users, RefreshCw, Search, Archive, RotateCcw, Pencil, ArrowUpDown, Printer } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/components/Currency";
import { format } from "date-fns";
import type { FarmerLedgerEntry, FarmerLedgerEditHistoryEntry } from "@shared/schema";

interface FarmerWithDues extends FarmerLedgerEntry {
  pyReceivables: number;
  selfDue: number;
  merchantDue: number;
  totalDue: number;
}

interface FarmerLedgerData {
  farmers: FarmerWithDues[];
  summary: {
    totalFarmers: number;
    totalPyReceivables: number;
    totalSelfDue: number;
    totalMerchantDue: number;
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
      toast({ title: t("farmersSynced") });
    },
    onError: () => {
      toast({ title: t("farmersSyncFailed"), variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; updates: Partial<FarmerLedgerEntry> }) => {
      const response = await apiRequest('PATCH', `/api/farmer-ledger/${data.id}`, data.updates);
      return response.json() as Promise<{ merged: boolean; mergedFromId?: string }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/farmer-ledger'] });
      if (result.merged) {
        toast({ title: t("mergedFrom") + " " + result.mergedFromId });
      } else {
        toast({ title: t("saved") });
      }
      setEditingFarmer(null);
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
      toast({ title: t("farmerArchived") });
    },
  });

  const reinstateMutation = useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/api/farmer-ledger/${id}/reinstate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/farmer-ledger'] });
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

    let filtered = ledgerData.farmers.filter(farmer => {
      const matchesName = !nameSearch || 
        farmer.name.toLowerCase().includes(nameSearch.toLowerCase());
      const matchesVillage = !villageSearch || 
        farmer.village.toLowerCase().includes(villageSearch.toLowerCase());
      
      return matchesName && matchesVillage;
    });

    filtered = [...filtered].sort((a, b) => {
      let aVal: string | number = a[sortField];
      let bVal: string | number = b[sortField];
      
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

  const handleSaveEdit = () => {
    if (!editingFarmer) return;
    updateMutation.mutate({
      id: editingFarmer.id,
      updates: editFormData,
    });
  };

  const summary = ledgerData?.summary || {
    totalFarmers: 0,
    totalPyReceivables: 0,
    totalSelfDue: 0,
    totalMerchantDue: 0,
    totalDue: 0,
  };

  const formatDueValue = (value: number | undefined | null): string => {
    const num = value ?? 0;
    if (isNaN(num)) return formatCurrency(0);
    return formatCurrency(num);
  };

  const getDueColorClass = (value: number | undefined | null): string => {
    const num = value ?? 0;
    if (isNaN(num) || num === 0) return "";
    if (num > 0) return "text-green-600";
    return "text-red-600";
  };

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <th 
      className="px-3 py-2 text-left text-xs font-medium text-muted-foreground cursor-pointer hover:bg-muted/50 select-none"
      onClick={() => handleSort(field)}
      data-testid={`header-${field}`}
    >
      <div className="flex items-center gap-1">
        {children}
        <ArrowUpDown className={`w-3 h-3 ${sortField === field ? 'text-foreground' : 'text-muted-foreground/50'}`} />
      </div>
    </th>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <h1 className="text-xl font-semibold">{t("farmerLedger")}</h1>
        <p className="text-sm text-muted-foreground">{t("trackFarmerDues")}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 p-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("farmers")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-farmer-count">{summary.totalFarmers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("pyReceivables")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-py-receivables">{formatDueValue(summary.totalPyReceivables)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("harvestDue")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600" data-testid="text-harvest-due">{formatDueValue(summary.totalMerchantDue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("seedDue")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600" data-testid="text-seed-due">{formatDueValue(summary.totalSelfDue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("coldDue")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600" data-testid="text-cold-due">{formatDueValue(0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("netDue")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600" data-testid="text-net-due">{formatDueValue(summary.totalDue)}</div>
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
            onChange={(e) => setNameSearch(e.target.value)}
            className="w-[160px]"
            data-testid="input-search-name"
          />
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
        <Button variant="outline" size="icon" data-testid="button-print">
          <Printer className="w-4 h-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 px-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredFarmers.active.length === 0 && filteredFarmers.archived.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground" data-testid="text-no-farmers">
            {t("noFarmersFound")}
          </div>
        ) : (
          <div className="pb-4">
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-8"></th>
                    <SortHeader field="farmerId">{t("farmerId")}</SortHeader>
                    <SortHeader field="name">{t("name")}</SortHeader>
                    <SortHeader field="village">{t("village")}</SortHeader>
                    <SortHeader field="contactNumber">{t("contact")}</SortHeader>
                    <SortHeader field="pyReceivables">{t("pyReceivables")}</SortHeader>
                    <SortHeader field="merchantDue"><span className="text-green-600">{t("harvestDue")}</span></SortHeader>
                    <SortHeader field="selfDue"><span className="text-red-600">{t("seedDue")}</span></SortHeader>
                    <SortHeader field="totalDue">{t("netDue")}</SortHeader>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{t("coldDue")}</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground">{t("actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredFarmers.active.map(farmer => (
                    <tr key={farmer.id} className="hover:bg-muted/30" data-testid={`row-farmer-${farmer.id}`}>
                      <td className="px-3 py-2">
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
                      <td className="px-3 py-2 font-mono text-xs" data-testid={`text-farmer-id-${farmer.id}`}>{farmer.farmerId}</td>
                      <td className="px-3 py-2 font-medium" data-testid={`text-farmer-name-${farmer.id}`}>{farmer.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{farmer.village}</td>
                      <td className="px-3 py-2 text-muted-foreground">{farmer.contactNumber}</td>
                      <td className="px-3 py-2 text-right">{formatDueValue(farmer.pyReceivables)}</td>
                      <td className={`px-3 py-2 text-right ${getDueColorClass(farmer.merchantDue)}`}>{formatDueValue(farmer.merchantDue)}</td>
                      <td className={`px-3 py-2 text-right ${getDueColorClass(-farmer.selfDue)}`}>{formatDueValue(farmer.selfDue)}</td>
                      <td className={`px-3 py-2 text-right font-medium ${getDueColorClass(farmer.totalDue)}`}>{formatDueValue(farmer.totalDue)}</td>
                      <td className="px-3 py-2 text-right">{formatDueValue(0)}</td>
                      <td className="px-3 py-2">
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
                      <td className="px-3 py-2">
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
                      <td className="px-3 py-2 font-mono text-xs">{farmer.farmerId}</td>
                      <td className="px-3 py-2 font-medium">{farmer.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{farmer.village}</td>
                      <td className="px-3 py-2 text-muted-foreground">{farmer.contactNumber}</td>
                      <td className="px-3 py-2 text-right">{formatDueValue(farmer.pyReceivables)}</td>
                      <td className={`px-3 py-2 text-right ${getDueColorClass(farmer.merchantDue)}`}>{formatDueValue(farmer.merchantDue)}</td>
                      <td className={`px-3 py-2 text-right ${getDueColorClass(-farmer.selfDue)}`}>{formatDueValue(farmer.selfDue)}</td>
                      <td className={`px-3 py-2 text-right font-medium ${getDueColorClass(farmer.totalDue)}`}>{formatDueValue(farmer.totalDue)}</td>
                      <td className="px-3 py-2 text-right">{formatDueValue(0)}</td>
                      <td className="px-3 py-2">
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
          </div>
        )}
      </ScrollArea>

      <Dialog open={!!editingFarmer} onOpenChange={(open) => !open && setEditingFarmer(null)}>
        <DialogContent className="max-w-md">
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
                <ScrollArea className="h-32 mt-2 border rounded-md p-2">
                  {editHistory.map(entry => (
                    <div key={entry.id} className="text-xs mb-2 pb-2 border-b last:border-0">
                      <div className="flex justify-between text-muted-foreground">
                        <span>{entry.editType}</span>
                        <span>{format(new Date(entry.modifiedAt), 'dd/MM/yyyy HH:mm')}</span>
                      </div>
                      {entry.mergedFromId && (
                        <div className="text-destructive">{t("mergedFrom")}: {entry.mergedFromId}</div>
                      )}
                    </div>
                  ))}
                </ScrollArea>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingFarmer(null)} data-testid="button-cancel-edit">
                {t("cancel")}
              </Button>
              <Button 
                onClick={handleSaveEdit} 
                disabled={updateMutation.isPending}
                data-testid="button-save-edit"
              >
                {updateMutation.isPending ? t("saving") : t("save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
