import { useState, useEffect, useRef, useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
import { LotCard } from "@/components/LotCard";
import { EditHistoryAccordion } from "@/components/EditHistoryAccordion";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowLeft, Search, Phone, Package, Filter, User } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import type { Lot, Chamber, LotEditHistory } from "@shared/schema";

export default function SearchEdit() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [searchType, setSearchType] = useState<"phone" | "lotNoSize" | "filter" | "farmerName">("phone");
  const [farmerNameQuery, setFarmerNameQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [lotNoQuery, setLotNoQuery] = useState("");
  const [sizeQuery, setSizeQuery] = useState("");
  const [qualityFilter, setQualityFilter] = useState<string>("all");
  const [paymentDueFilter, setPaymentDueFilter] = useState(false);
  const [searchResults, setSearchResults] = useState<Lot[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedLot, setSelectedLot] = useState<Lot | null>(null);
  const [editHistory, setEditHistory] = useState<LotEditHistory[]>([]);

  const [editForm, setEditForm] = useState<{
    chamberId: string;
    floor: number;
    position: string;
    quality: string;
  } | null>(null);

  const { data: chambers } = useQuery<Chamber[]>({
    queryKey: ["/api/chambers"],
  });

  const isInitialMount = useRef(true);
  
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (hasSearched) {
      handleSearch();
    }
  }, [qualityFilter, paymentDueFilter]);

  const chamberMap = chambers?.reduce((acc, chamber) => {
    acc[chamber.id] = chamber.name;
    return acc;
  }, {} as Record<string, string>) || {};

  const summaryTotals = useMemo(() => {
    if (searchResults.length === 0) return null;
    return {
      totalBags: searchResults.reduce((sum, lot) => sum + lot.size, 0),
      remainingBags: searchResults.reduce((sum, lot) => sum + lot.remainingSize, 0),
      chargesPaid: searchResults.reduce((sum, lot) => sum + (lot.totalPaidCharge || 0), 0),
      chargesDue: searchResults.reduce((sum, lot) => sum + (lot.totalDueCharge || 0), 0),
    };
  }, [searchResults]);

  const handleSearch = async () => {
    if (searchType === "phone" && !searchQuery.trim()) return;
    if (searchType === "lotNoSize" && !lotNoQuery.trim() && !sizeQuery.trim()) return;
    if (searchType === "filter" && qualityFilter === "all" && !paymentDueFilter) return;
    if (searchType === "farmerName" && !farmerNameQuery.trim()) return;
    
    setIsSearching(true);
    setHasSearched(true);
    
    try {
      let url: string;
      if (searchType === "filter") {
        url = `/api/lots/search?type=filter`;
      } else if (searchType === "lotNoSize") {
        url = `/api/lots/search?type=lotNoSize&lotNo=${encodeURIComponent(lotNoQuery)}&size=${encodeURIComponent(sizeQuery)}`;
      } else if (searchType === "farmerName") {
        url = `/api/lots/search?type=farmerName&query=${encodeURIComponent(farmerNameQuery)}`;
      } else {
        url = `/api/lots/search?type=${searchType}&query=${encodeURIComponent(searchQuery)}`;
      }
      
      if (qualityFilter && qualityFilter !== "all") {
        url += `&quality=${encodeURIComponent(qualityFilter)}`;
      }
      if (paymentDueFilter) {
        url += `&paymentDue=true`;
      }
      
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setSearchResults(data);
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
    });

    try {
      const response = await fetch(`/api/lots/${lot.id}/history`);
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
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/lots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      if (!variables.silent) {
        toast({
          title: t("success"),
          description: "Lot updated successfully",
        });
        setEditDialogOpen(false);
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

  const handleEditSubmit = () => {
    if (!selectedLot || !editForm) return;
    updateLotMutation.mutate({
      id: selectedLot.id,
      updates: editForm,
    });
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
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
          <h1 className="text-2xl sm:text-3xl font-bold">{t("searchEdit")}</h1>
          <p className="text-muted-foreground mt-1">
            Find and manage lot details
          </p>
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
            <div className="flex gap-2">
              <Input
                placeholder="Enter phone number..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="flex-1"
                data-testid="input-search-phone"
              />
              <Button onClick={handleSearch} disabled={isSearching} data-testid="button-search">
                <Search className="h-4 w-4 mr-2" />
                {t("search")}
              </Button>
            </div>
          ) : searchType === "farmerName" ? (
            <div className="flex gap-2">
              <Input
                placeholder={t("enterFarmerName") || "Enter farmer name..."}
                value={farmerNameQuery}
                onChange={(e) => setFarmerNameQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="flex-1"
                data-testid="input-search-farmer"
              />
              <Button onClick={handleSearch} disabled={isSearching} data-testid="button-search-farmer">
                <Search className="h-4 w-4 mr-2" />
                {t("search")}
              </Button>
            </div>
          ) : searchType === "lotNoSize" ? (
            <div className="flex items-center gap-2">
              <Input
                placeholder={t("lotNumber")}
                value={lotNoQuery}
                onChange={(e) => setLotNoQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="flex-1"
                data-testid="input-search-lotno"
              />
              <span className="text-lg font-semibold text-muted-foreground">x</span>
              <Input
                placeholder={t("size")}
                value={sizeQuery}
                onChange={(e) => setSizeQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="flex-1"
                data-testid="input-search-size"
              />
              <Button onClick={handleSearch} disabled={isSearching} data-testid="button-search">
                <Search className="h-4 w-4 mr-2" />
                {t("search")}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <Label className="text-sm">{t("quality")}:</Label>
                  <Select value={qualityFilter} onValueChange={setQualityFilter}>
                    <SelectTrigger className="w-32" data-testid="select-quality-filter">
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
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="payment-due-filter-main"
                    checked={paymentDueFilter}
                    onCheckedChange={(checked) => setPaymentDueFilter(checked === true)}
                    data-testid="checkbox-payment-due-main"
                  />
                  <Label htmlFor="payment-due-filter-main" className="text-sm cursor-pointer">
                    {t("coldChargesDue")}
                  </Label>
                </div>
              </div>
              <Button onClick={handleSearch} disabled={isSearching || (qualityFilter === "all" && !paymentDueFilter)} data-testid="button-search-filter">
                <Search className="h-4 w-4 mr-2" />
                {t("search")}
              </Button>
            </div>
          )}
        </Tabs>
      </Card>

      {isSearching ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : hasSearched ? (
        searchResults.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-muted-foreground">{t("noResults")}</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {searchResults.map((lot) => (
              <LotCard
                key={lot.id}
                lot={lot}
                chamberName={chamberMap[lot.chamberId] || "Unknown"}
                onEdit={handleEditClick}
                onToggleSale={handleToggleSale}
              />
            ))}
            
            {summaryTotals && (
              <Card className="p-4 bg-muted/50">
                <h3 className="font-semibold mb-3">{t("searchSummary")}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">{t("totalBags")}</p>
                    <p className="text-lg font-bold" data-testid="text-total-bags">{summaryTotals.totalBags.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("totalRemainingBags")}</p>
                    <p className="text-lg font-bold" data-testid="text-total-remaining">{summaryTotals.remainingBags.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("totalChargesPaid")}</p>
                    <p className="text-lg font-bold text-green-600" data-testid="text-total-paid">₹{summaryTotals.chargesPaid.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("totalChargesDue")}</p>
                    <p className="text-lg font-bold text-red-600" data-testid="text-total-due">₹{summaryTotals.chargesDue.toLocaleString()}</p>
                  </div>
                </div>
              </Card>
            )}
          </div>
        )
      ) : null}

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("edit")} - {selectedLot?.farmerName}</DialogTitle>
            <DialogDescription>
              {t("lotNo")}: {selectedLot?.lotNo}
            </DialogDescription>
          </DialogHeader>

          {/* Read-only Farmer Details */}
          <div className="space-y-4">
            <h4 className="font-semibold text-sm text-muted-foreground">{t("farmerDetails")}</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 bg-muted/50 rounded-lg">
              <div>
                <p className="text-xs text-muted-foreground">{t("farmerName")}</p>
                <p className="font-medium text-sm">{selectedLot?.farmerName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("contactNumber")}</p>
                <p className="font-medium text-sm">{selectedLot?.contactNumber}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("village")}</p>
                <p className="font-medium text-sm">{selectedLot?.village}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("tehsil")}</p>
                <p className="font-medium text-sm">{selectedLot?.tehsil}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("district")}</p>
                <p className="font-medium text-sm">{selectedLot?.district}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("state")}</p>
                <p className="font-medium text-sm">{selectedLot?.state}</p>
              </div>
            </div>
          </div>

          {/* Read-only Lot Information */}
          <div className="space-y-4 border-t pt-4">
            <h4 className="font-semibold text-sm text-muted-foreground">{t("lotInformation")}</h4>
            <div className="grid grid-cols-3 gap-3 p-3 bg-muted/50 rounded-lg">
              <div>
                <p className="text-xs text-muted-foreground">{t("lotNo")}</p>
                <p className="font-medium text-sm">{selectedLot?.lotNo}</p>
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

          {/* Read-only Cold Storage Charges */}
          {selectedLot && ((selectedLot.totalDueCharge || 0) > 0 || (selectedLot.totalPaidCharge || 0) > 0) && (
            <div className="border-t pt-4 space-y-3">
              <h4 className="font-semibold text-sm text-muted-foreground">{t("totalColdStorageCharges")}</h4>
              <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 mb-3">
                <p className="text-xs text-muted-foreground">{t("total")}</p>
                <p className="text-xl font-bold text-blue-600 dark:text-blue-400">
                  Rs. {((selectedLot.totalPaidCharge || 0) + (selectedLot.totalDueCharge || 0)).toLocaleString()}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(selectedLot.totalPaidCharge || 0) > 0 && (
                  <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                    <p className="text-xs text-muted-foreground">{t("coldChargesPaid")}</p>
                    <p className="text-lg font-bold text-green-600 dark:text-green-400">
                      Rs. {(selectedLot.totalPaidCharge || 0).toLocaleString()}
                    </p>
                  </div>
                )}
                {(selectedLot.totalDueCharge || 0) > 0 && (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    <p className="text-xs text-muted-foreground">{t("coldChargesDue")}</p>
                    <p className="text-lg font-bold text-amber-600 dark:text-amber-400">
                      Rs. {(selectedLot.totalDueCharge || 0).toLocaleString()}
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
                    type="number"
                    min={1}
                    value={editForm.floor}
                    onChange={(e) => setEditForm({ ...editForm, floor: parseInt(e.target.value) || 0 })}
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
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              onClick={handleEditSubmit}
              disabled={updateLotMutation.isPending || !editForm}
              data-testid="button-save-edit"
            >
              {updateLotMutation.isPending ? t("loading") : t("save")}
            </Button>
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
                  });
                  // Refresh the lot and history
                  if (selectedLot) {
                    const lotResponse = await fetch(`/api/lots/${selectedLot.id}`);
                    if (lotResponse.ok) {
                      const updatedLot = await lotResponse.json();
                      setSelectedLot(updatedLot);
                      setEditForm({
                        chamberId: updatedLot.chamberId,
                        floor: updatedLot.floor,
                        position: updatedLot.position || "",
                        quality: updatedLot.quality,
                      });
                    }
                    const historyResponse = await fetch(`/api/lots/${selectedLot.id}/history`);
                    if (historyResponse.ok) {
                      setEditHistory(await historyResponse.json());
                    }
                  }
                  queryClient.invalidateQueries({ queryKey: ["/api/lots"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
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
    </div>
  );
}
