import { useState, useEffect, useRef } from "react";
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

  const [editForm, setEditForm] = useState({
    farmerName: "",
    village: "",
    tehsil: "",
    district: "",
    contactNumber: "",
    remarks: "",
  });

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
      farmerName: lot.farmerName,
      village: lot.village,
      tehsil: lot.tehsil,
      district: lot.district,
      contactNumber: lot.contactNumber,
      remarks: lot.remarks || "",
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
    if (!selectedLot) return;
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label>{t("farmerName")}</Label>
              <Input
                value={editForm.farmerName}
                onChange={(e) =>
                  setEditForm({ ...editForm, farmerName: e.target.value })
                }
                data-testid="input-edit-farmer-name"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("contactNumber")}</Label>
              <Input
                value={editForm.contactNumber}
                onChange={(e) =>
                  setEditForm({ ...editForm, contactNumber: e.target.value })
                }
                data-testid="input-edit-contact"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("village")}</Label>
              <Input
                value={editForm.village}
                onChange={(e) =>
                  setEditForm({ ...editForm, village: e.target.value })
                }
                data-testid="input-edit-village"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("tehsil")}</Label>
              <Input
                value={editForm.tehsil}
                onChange={(e) =>
                  setEditForm({ ...editForm, tehsil: e.target.value })
                }
                data-testid="input-edit-tehsil"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>{t("district")}</Label>
              <Input
                value={editForm.district}
                onChange={(e) =>
                  setEditForm({ ...editForm, district: e.target.value })
                }
                data-testid="input-edit-district"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>{t("remarks")}</Label>
              <Input
                value={editForm.remarks}
                onChange={(e) =>
                  setEditForm({ ...editForm, remarks: e.target.value })
                }
                data-testid="input-edit-remarks"
              />
            </div>
          </div>

          {selectedLot && ((selectedLot.totalDueCharge || 0) > 0 || (selectedLot.totalPaidCharge || 0) > 0) && (
            <div className="border-t pt-4 space-y-3">
              {(selectedLot.totalDueCharge || 0) > 0 && (
                <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">{t("coldChargesDue")}</p>
                      <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                        Rs. {(selectedLot.totalDueCharge || 0).toLocaleString()}
                      </p>
                    </div>
                    <Button
                      variant="default"
                      onClick={() => {
                        updateLotMutation.mutate({
                          id: selectedLot.id,
                          updates: { 
                            totalPaidCharge: (selectedLot.totalPaidCharge || 0) + (selectedLot.totalDueCharge || 0),
                            totalDueCharge: 0,
                          },
                          silent: false,
                        });
                      }}
                      disabled={updateLotMutation.isPending}
                      data-testid="button-mark-as-paid"
                    >
                      {t("markAsPaid")}
                    </Button>
                  </div>
                </div>
              )}
              {(selectedLot.totalPaidCharge || 0) > 0 && (
                <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                  <div>
                    <p className="text-sm text-muted-foreground">{t("coldChargesPaid")}</p>
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                      Rs. {(selectedLot.totalPaidCharge || 0).toLocaleString()}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="border-t pt-4">
            <h3 className="font-semibold mb-3">{t("editHistory")}</h3>
            <EditHistoryAccordion history={editHistory} />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              onClick={handleEditSubmit}
              disabled={updateLotMutation.isPending}
              data-testid="button-save-edit"
            >
              {updateLotMutation.isPending ? t("loading") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
