import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, authFetch } from "@/lib/queryClient";
import { Users, RefreshCw, Search, Flag, Archive, RotateCcw, Pencil, ChevronDown, ChevronUp, Filter, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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

export default function FarmerLedger() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { canEdit, coldStorage } = useAuth();
  const coldStorageId = coldStorage?.id || "";

  const [searchTerm, setSearchTerm] = useState("");
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const [showWithDuesOnly, setShowWithDuesOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
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

  const filteredFarmers = useMemo(() => {
    if (!ledgerData?.farmers) return { active: [], archived: [] };

    const filtered = ledgerData.farmers.filter(farmer => {
      const matchesSearch = !searchTerm || 
        farmer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        farmer.village.toLowerCase().includes(searchTerm.toLowerCase()) ||
        farmer.farmerId.toLowerCase().includes(searchTerm.toLowerCase()) ||
        farmer.contactNumber.includes(searchTerm);
      
      const matchesFlagged = !showFlaggedOnly || farmer.isFlagged === 1;
      const matchesDues = !showWithDuesOnly || farmer.totalDue > 0;
      
      return matchesSearch && matchesFlagged && matchesDues;
    });

    return {
      active: filtered.filter(f => f.isArchived !== 1),
      archived: filtered.filter(f => f.isArchived === 1),
    };
  }, [ledgerData?.farmers, searchTerm, showFlaggedOnly, showWithDuesOnly]);

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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Users className="w-5 h-5" />
          {t("farmerLedger")}
        </h1>
        {canEdit && (
          <Button
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            data-testid="button-sync-farmers"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            {syncMutation.isPending ? t("syncingFarmers") : t("syncFarmers")}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4">
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
            <div className="text-2xl font-bold" data-testid="text-py-receivables">{formatCurrency(summary.totalPyReceivables)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("selfDue")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-self-due">{formatCurrency(summary.totalSelfDue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("merchantDue")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-merchant-due">{formatCurrency(summary.totalMerchantDue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("totalDue")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary" data-testid="text-total-due">{formatCurrency(summary.totalDue)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="px-4 pb-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={t("searchFarmers")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
            data-testid="input-search-farmers"
          />
          {searchTerm && (
            <Button
              size="icon"
              variant="ghost"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
              onClick={() => setSearchTerm("")}
              data-testid="button-clear-search"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="flagged-filter"
            checked={showFlaggedOnly}
            onCheckedChange={setShowFlaggedOnly}
            data-testid="switch-flagged-only"
          />
          <Label htmlFor="flagged-filter" className="text-sm cursor-pointer">{t("showFlaggedOnly")}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="dues-filter"
            checked={showWithDuesOnly}
            onCheckedChange={setShowWithDuesOnly}
            data-testid="switch-dues-only"
          />
          <Label htmlFor="dues-filter" className="text-sm cursor-pointer">{t("showWithDuesOnly")}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="archived-filter"
            checked={showArchived}
            onCheckedChange={setShowArchived}
            data-testid="switch-show-archived"
          />
          <Label htmlFor="archived-filter" className="text-sm cursor-pointer">{t("archivedFarmers")}</Label>
        </div>
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
          <div className="space-y-4 pb-4">
            <div className="space-y-2">
              <h3 className="font-medium text-sm text-muted-foreground">{t("activeFarmers")} ({filteredFarmers.active.length})</h3>
              {filteredFarmers.active.map(farmer => (
                <Card key={farmer.id} className="hover-elevate" data-testid={`card-farmer-${farmer.id}`}>
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium" data-testid={`text-farmer-name-${farmer.id}`}>{farmer.name}</span>
                          <Badge variant="outline" className="text-xs" data-testid={`badge-farmer-id-${farmer.id}`}>{farmer.farmerId}</Badge>
                          {farmer.isFlagged === 1 && (
                            <Badge variant="destructive" className="text-xs" data-testid={`badge-flagged-${farmer.id}`}>
                              <Flag className="w-3 h-3 mr-1" />
                              {t("flagged")}
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {farmer.village}{farmer.district && `, ${farmer.district}`} | {farmer.contactNumber}
                        </div>
                        <div className="flex flex-wrap gap-4 mt-2 text-sm">
                          <span>{t("pyReceivables")}: <span className="font-medium">{formatCurrency(farmer.pyReceivables)}</span></span>
                          <span>{t("selfDue")}: <span className="font-medium">{formatCurrency(farmer.selfDue)}</span></span>
                          <span>{t("merchantDue")}: <span className="font-medium">{formatCurrency(farmer.merchantDue)}</span></span>
                          <span className="text-primary">{t("totalDue")}: <span className="font-bold">{formatCurrency(farmer.totalDue)}</span></span>
                        </div>
                      </div>
                      {canEdit && (
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => flagMutation.mutate(farmer.id)}
                            data-testid={`button-flag-${farmer.id}`}
                          >
                            <Flag className={`w-4 h-4 ${farmer.isFlagged === 1 ? 'text-destructive' : ''}`} />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleEditClick(farmer)}
                            data-testid={`button-edit-${farmer.id}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => archiveMutation.mutate(farmer.id)}
                            data-testid={`button-archive-${farmer.id}`}
                          >
                            <Archive className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {showArchived && filteredFarmers.archived.length > 0 && (
              <Collapsible defaultOpen={false}>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" className="w-full justify-between" data-testid="button-toggle-archived">
                    <span>{t("archivedFarmers")} ({filteredFarmers.archived.length})</span>
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 pt-2">
                  {filteredFarmers.archived.map(farmer => (
                    <Card key={farmer.id} className="opacity-70" data-testid={`card-archived-farmer-${farmer.id}`}>
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{farmer.name}</span>
                              <Badge variant="secondary" className="text-xs">{farmer.farmerId}</Badge>
                              <Badge variant="outline" className="text-xs">{t("archived")}</Badge>
                            </div>
                            <div className="text-sm text-muted-foreground mt-1">
                              {farmer.village}{farmer.district && `, ${farmer.district}`} | {farmer.contactNumber}
                            </div>
                          </div>
                          {canEdit && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => reinstateMutation.mutate(farmer.id)}
                              data-testid={`button-reinstate-${farmer.id}`}
                            >
                              <RotateCcw className="w-4 h-4 mr-2" />
                              {t("reinstateFarmer")}
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}
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
