import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/components/Currency";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  Calculator,
  IndianRupee,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import type { Asset, AssetDepreciationLog } from "@shared/schema";
import { getFinancialYear } from "@shared/schema";

const ASSET_CATEGORIES = [
  { value: "building", depRate: 10 },
  { value: "plant_machinery", depRate: 15 },
  { value: "furniture", depRate: 10 },
  { value: "vehicles", depRate: 15 },
  { value: "computers", depRate: 40 },
  { value: "electrical_fittings", depRate: 10 },
  { value: "other", depRate: 10 },
] as const;

function getCategoryDepRate(category: string): number {
  return ASSET_CATEGORIES.find((c) => c.value === category)?.depRate ?? 10;
}

function generateFYOptions(): string[] {
  const now = new Date();
  const currentFY = getFinancialYear(now);
  const startYear = parseInt(currentFY.split("-")[0]);
  const options: string[] = [];
  for (let y = startYear + 1; y >= startYear - 5; y--) {
    const end = (y + 1) % 100;
    options.push(`${y}-${String(end).padStart(2, "0")}`);
  }
  return options;
}

export default function AssetRegister() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { canEdit } = useAuth();

  const [categoryFilter, setCategoryFilter] = useState("all");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [disposeDialogAsset, setDisposeDialogAsset] = useState<Asset | null>(null);
  const [selectedFY, setSelectedFY] = useState(getFinancialYear(new Date()));

  const [formData, setFormData] = useState({
    assetName: "",
    assetCategory: "building",
    purchaseDate: format(new Date(), "yyyy-MM-dd"),
    originalCost: "",
    currentBookValue: "",
    depreciationRate: "10",
    remarks: "",
  });

  const [disposeData, setDisposeData] = useState({
    disposalAmount: "",
    disposedAt: format(new Date(), "yyyy-MM-dd"),
  });

  const { data: assets, isLoading } = useQuery<Asset[]>({
    queryKey: ["/api/assets"],
  });

  const { data: depreciationLog, isLoading: depLogLoading } = useQuery<AssetDepreciationLog[]>({
    queryKey: ["/api/assets/depreciation", selectedFY],
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiRequest("POST", "/api/assets", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      toast({ title: t("assetAdded") });
      setAddDialogOpen(false);
      resetForm();
    },
    onError: () => {
      toast({ title: t("saveFailed"), variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Record<string, unknown> }) =>
      apiRequest("PATCH", `/api/assets/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      toast({ title: t("saved") });
      setEditingAsset(null);
      resetForm();
    },
    onError: () => {
      toast({ title: t("saveFailed"), variant: "destructive" });
    },
  });

  const disposeMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiRequest("POST", `/api/assets/${id}/dispose`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      toast({ title: t("assetDisposed") });
      setDisposeDialogAsset(null);
    },
    onError: () => {
      toast({ title: t("saveFailed"), variant: "destructive" });
    },
  });

  const depreciationMutation = useMutation({
    mutationFn: (financialYear: string) =>
      apiRequest("POST", "/api/assets/depreciation", { financialYear }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets/depreciation", selectedFY] });
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      toast({ title: t("depreciationCalculated") });
    },
    onError: () => {
      toast({ title: t("saveFailed"), variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      assetName: "",
      assetCategory: "building",
      purchaseDate: format(new Date(), "yyyy-MM-dd"),
      originalCost: "",
      currentBookValue: "",
      depreciationRate: "10",
      remarks: "",
    });
  };

  const handleCategoryChange = (category: string) => {
    const rate = getCategoryDepRate(category);
    setFormData((prev) => ({
      ...prev,
      assetCategory: category,
      depreciationRate: String(rate),
    }));
  };

  const handleAddSubmit = () => {
    if (!formData.assetName || !formData.originalCost) return;
    const cost = parseFloat(formData.originalCost);
    const bookValue = formData.currentBookValue
      ? parseFloat(formData.currentBookValue)
      : cost;
    createMutation.mutate({
      assetName: formData.assetName,
      assetCategory: formData.assetCategory,
      purchaseDate: new Date(formData.purchaseDate).toISOString(),
      originalCost: cost,
      currentBookValue: bookValue,
      depreciationRate: parseFloat(formData.depreciationRate),
      depreciationMethod: "wdv",
      isOpening: 1,
      remarks: formData.remarks || null,
    });
  };

  const handleEditOpen = (asset: Asset) => {
    setFormData({
      assetName: asset.assetName,
      assetCategory: asset.assetCategory,
      purchaseDate: format(new Date(asset.purchaseDate), "yyyy-MM-dd"),
      originalCost: String(asset.originalCost),
      currentBookValue: String(asset.currentBookValue),
      depreciationRate: String(asset.depreciationRate),
      remarks: asset.remarks || "",
    });
    setEditingAsset(asset);
  };

  const handleEditSubmit = () => {
    if (!editingAsset || !formData.assetName || !formData.originalCost) return;
    updateMutation.mutate({
      id: editingAsset.id,
      updates: {
        assetName: formData.assetName,
        assetCategory: formData.assetCategory,
        purchaseDate: new Date(formData.purchaseDate).toISOString(),
        originalCost: parseFloat(formData.originalCost),
        currentBookValue: parseFloat(formData.currentBookValue || formData.originalCost),
        depreciationRate: parseFloat(formData.depreciationRate),
        remarks: formData.remarks || null,
      },
    });
  };

  const handleDisposeSubmit = () => {
    if (!disposeDialogAsset || !disposeData.disposalAmount) return;
    disposeMutation.mutate({
      id: disposeDialogAsset.id,
      data: {
        disposalAmount: parseFloat(disposeData.disposalAmount),
        disposedAt: new Date(disposeData.disposedAt).toISOString(),
      },
    });
  };

  const filteredAssets = useMemo(() => {
    if (!assets) return [];
    if (categoryFilter === "all") return assets;
    return assets.filter((a) => a.assetCategory === categoryFilter);
  }, [assets, categoryFilter]);

  const summaryByCategory = useMemo(() => {
    if (!assets) return {};
    const summary: Record<string, { count: number; totalValue: number }> = {};
    for (const a of assets) {
      if (a.isDisposed === 1) continue;
      if (!summary[a.assetCategory]) {
        summary[a.assetCategory] = { count: 0, totalValue: 0 };
      }
      summary[a.assetCategory].count++;
      summary[a.assetCategory].totalValue += a.currentBookValue;
    }
    return summary;
  }, [assets]);

  const grandTotal = useMemo(() => {
    return Object.values(summaryByCategory).reduce((sum, s) => sum + s.totalValue, 0);
  }, [summaryByCategory]);

  const fyOptions = useMemo(() => generateFYOptions(), []);

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const assetFormDialog = (
    isEdit: boolean,
    open: boolean,
    onClose: () => void,
    onSubmit: () => void,
    isPending: boolean,
  ) => (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid={isEdit ? "text-edit-asset-title" : "text-add-asset-title"}>
            {isEdit ? t("editAsset") : t("addOpeningAsset")}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? t("editAssetDesc") : t("addOpeningAssetDesc")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>{t("assetName")}</Label>
            <Input
              value={formData.assetName}
              onChange={(e) =>
                setFormData((p) => ({ ...p, assetName: e.target.value }))
              }
              data-testid="input-asset-name"
            />
          </div>
          <div>
            <Label>{t("assetCategory")}</Label>
            <Select
              value={formData.assetCategory}
              onValueChange={handleCategoryChange}
            >
              <SelectTrigger data-testid="select-asset-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSET_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {t(`cat_${c.value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("purchaseDate")}</Label>
            <Input
              type="date"
              value={formData.purchaseDate}
              onChange={(e) =>
                setFormData((p) => ({ ...p, purchaseDate: e.target.value }))
              }
              data-testid="input-purchase-date"
            />
          </div>
          <div>
            <Label>{t("originalCost")}</Label>
            <Input
              type="number"
              value={formData.originalCost}
              onChange={(e) =>
                setFormData((p) => ({ ...p, originalCost: e.target.value }))
              }
              data-testid="input-original-cost"
            />
          </div>
          <div>
            <Label>{t("currentBookValue")}</Label>
            <Input
              type="number"
              value={formData.currentBookValue}
              onChange={(e) =>
                setFormData((p) => ({ ...p, currentBookValue: e.target.value }))
              }
              placeholder={formData.originalCost || ""}
              data-testid="input-current-book-value"
            />
          </div>
          <div>
            <Label>{t("depreciationRate")} (%)</Label>
            <Input
              type="number"
              value={formData.depreciationRate}
              onChange={(e) =>
                setFormData((p) => ({ ...p, depreciationRate: e.target.value }))
              }
              data-testid="input-depreciation-rate"
            />
          </div>
          <div>
            <Label>{t("remarks")}</Label>
            <Textarea
              value={formData.remarks}
              onChange={(e) =>
                setFormData((p) => ({ ...p, remarks: e.target.value }))
              }
              className="resize-none"
              data-testid="input-asset-remarks"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} data-testid="button-cancel-asset">
              {t("cancel")}
            </Button>
            <Button
              onClick={onSubmit}
              disabled={isPending || !formData.assetName || !formData.originalCost}
              data-testid="button-save-asset"
            >
              {isPending ? t("saving") : t("save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="flex flex-col h-full overflow-x-hidden">
      <div className="p-4 border-b flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-asset-register-title">
            {t("assetRegister")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("assetRegisterDesc")}</p>
        </div>
        {canEdit && (
          <Button
            onClick={() => {
              resetForm();
              setAddDialogOpen(true);
            }}
            data-testid="button-add-opening-asset"
          >
            <Plus className="w-4 h-4 mr-1" />
            {t("addOpeningAsset")}
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {ASSET_CATEGORIES.filter((c) => summaryByCategory[c.value]).map((c) => (
              <Card key={c.value} className="py-1">
                <CardHeader className="py-1 px-3">
                  <CardTitle className="text-xs font-medium text-muted-foreground">
                    {t(`cat_${c.value}`)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="py-1 px-3">
                  <div className="text-base font-bold" data-testid={`text-category-value-${c.value}`}>
                    <IndianRupee className="inline h-3 w-3" />
                    {formatCurrency(summaryByCategory[c.value]?.totalValue || 0)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {summaryByCategory[c.value]?.count || 0} {t("assets")}
                  </div>
                </CardContent>
              </Card>
            ))}
            <Card className="py-1 border-primary/30">
              <CardHeader className="py-1 px-3">
                <CardTitle className="text-xs font-medium text-primary">
                  {t("grandTotal")}
                </CardTitle>
              </CardHeader>
              <CardContent className="py-1 px-3">
                <div className="text-base font-bold text-primary" data-testid="text-grand-total-value">
                  <IndianRupee className="inline h-3 w-3" />
                  {formatCurrency(grandTotal)}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-category-filter">
                <SelectValue placeholder={t("allCategories")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allCategories")}</SelectItem>
                {ASSET_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {t(`cat_${c.value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-sm text-muted-foreground">
              {filteredAssets.length} {t("assets")}
            </div>
          </div>

          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-3 py-2 text-left font-medium whitespace-nowrap">{t("assetName")}</th>
                      <th className="px-3 py-2 text-left font-medium whitespace-nowrap">{t("assetCategory")}</th>
                      <th className="px-3 py-2 text-left font-medium whitespace-nowrap">{t("purchaseDate")}</th>
                      <th className="px-3 py-2 text-right font-medium whitespace-nowrap">{t("originalCost")}</th>
                      <th className="px-3 py-2 text-right font-medium whitespace-nowrap">{t("currentBookValue")}</th>
                      <th className="px-3 py-2 text-right font-medium whitespace-nowrap">{t("depRate")}</th>
                      <th className="px-3 py-2 text-center font-medium whitespace-nowrap">{t("status")}</th>
                      {canEdit && (
                        <th className="px-3 py-2 text-center font-medium">{t("actions")}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAssets.length === 0 && (
                      <tr>
                        <td colSpan={canEdit ? 8 : 7} className="px-3 py-8 text-center text-muted-foreground">
                          {t("noAssetsFound")}
                        </td>
                      </tr>
                    )}
                    {filteredAssets.map((asset) => (
                      <tr
                        key={asset.id}
                        className="border-b last:border-b-0"
                        data-testid={`row-asset-${asset.id}`}
                      >
                        <td className="px-3 py-2 font-medium whitespace-nowrap" data-testid={`text-asset-name-${asset.id}`}>
                          {asset.assetName}
                          {asset.isOpening === 1 && (
                            <Badge variant="outline" className="ml-1 text-[10px]">
                              {t("opening")}
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{t(`cat_${asset.assetCategory}`)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {format(new Date(asset.purchaseDate), "dd/MM/yyyy")}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {formatCurrency(asset.originalCost)}
                        </td>
                        <td className="px-3 py-2 text-right font-medium whitespace-nowrap" data-testid={`text-book-value-${asset.id}`}>
                          {formatCurrency(asset.currentBookValue)}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">{asset.depreciationRate}%</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap">
                          {asset.isDisposed === 1 ? (
                            <Badge variant="secondary" data-testid={`badge-status-${asset.id}`}>
                              {t("disposed")}
                            </Badge>
                          ) : (
                            <Badge variant="default" data-testid={`badge-status-${asset.id}`}>
                              {t("active")}
                            </Badge>
                          )}
                        </td>
                        {canEdit && (
                          <td className="px-3 py-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleEditOpen(asset)}
                                disabled={asset.isDisposed === 1}
                                data-testid={`button-edit-asset-${asset.id}`}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              {asset.isDisposed !== 1 && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => {
                                    setDisposeData({
                                      disposalAmount: "",
                                      disposedAt: format(new Date(), "yyyy-MM-dd"),
                                    });
                                    setDisposeDialogAsset(asset);
                                  }}
                                  data-testid={`button-dispose-asset-${asset.id}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Calculator className="w-4 h-4" />
                {t("depreciation")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Select value={selectedFY} onValueChange={setSelectedFY}>
                  <SelectTrigger className="w-[160px]" data-testid="select-fy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {fyOptions.map((fy) => (
                      <SelectItem key={fy} value={fy}>
                        FY {fy}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {canEdit && (
                  <Button
                    onClick={() => depreciationMutation.mutate(selectedFY)}
                    disabled={depreciationMutation.isPending}
                    data-testid="button-run-depreciation"
                  >
                    <Calculator className="w-4 h-4 mr-1" />
                    {depreciationMutation.isPending
                      ? t("calculating")
                      : t("runDepreciation")}
                  </Button>
                )}
              </div>

              {depLogLoading ? (
                <Skeleton className="h-32" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[500px]">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-3 py-2 text-left font-medium whitespace-nowrap">{t("assetName")}</th>
                        <th className="px-3 py-2 text-right font-medium whitespace-nowrap">{t("openingValue")}</th>
                        <th className="px-3 py-2 text-center font-medium whitespace-nowrap">{t("monthsUsed")}</th>
                        <th className="px-3 py-2 text-right font-medium whitespace-nowrap">{t("depreciationAmount")}</th>
                        <th className="px-3 py-2 text-right font-medium whitespace-nowrap">{t("closingValue")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(!depreciationLog || depreciationLog.length === 0) && (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                            {t("noDepreciationLog")}
                          </td>
                        </tr>
                      )}
                      {depreciationLog?.map((log) => {
                        const assetInfo = assets?.find((a) => a.id === log.assetId);
                        return (
                          <tr
                            key={log.id}
                            className="border-b last:border-b-0"
                            data-testid={`row-dep-log-${log.id}`}
                          >
                            <td className="px-3 py-2 whitespace-nowrap">{assetInfo?.assetName || log.assetId}</td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              {formatCurrency(log.openingValue)}
                            </td>
                            <td className="px-3 py-2 text-center whitespace-nowrap">{log.monthsUsed}</td>
                            <td className="px-3 py-2 text-right text-red-600 dark:text-red-400 whitespace-nowrap">
                              {formatCurrency(log.depreciationAmount)}
                            </td>
                            <td className="px-3 py-2 text-right font-medium whitespace-nowrap">
                              {formatCurrency(log.closingValue)}
                            </td>
                          </tr>
                        );
                      })}
                      {depreciationLog && depreciationLog.length > 0 && (
                        <tr className="border-t-2 bg-muted/20">
                          <td className="px-3 py-2 font-semibold">{t("total")}</td>
                          <td className="px-3 py-2 text-right font-semibold">
                            {formatCurrency(
                              depreciationLog.reduce((s, l) => s + l.openingValue, 0)
                            )}
                          </td>
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2 text-right font-semibold text-red-600 dark:text-red-400">
                            {formatCurrency(
                              depreciationLog.reduce((s, l) => s + l.depreciationAmount, 0)
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold">
                            {formatCurrency(
                              depreciationLog.reduce((s, l) => s + l.closingValue, 0)
                            )}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>

      {assetFormDialog(
        false,
        addDialogOpen,
        () => setAddDialogOpen(false),
        handleAddSubmit,
        createMutation.isPending
      )}

      {assetFormDialog(
        true,
        !!editingAsset,
        () => {
          setEditingAsset(null);
          resetForm();
        },
        handleEditSubmit,
        updateMutation.isPending
      )}

      <Dialog
        open={!!disposeDialogAsset}
        onOpenChange={(v) => !v && setDisposeDialogAsset(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle data-testid="text-dispose-title">{t("disposeAsset")}</DialogTitle>
            <DialogDescription>
              {disposeDialogAsset?.assetName} - {t("currentBookValue")}:{" "}
              {formatCurrency(disposeDialogAsset?.currentBookValue || 0)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("disposalAmount")}</Label>
              <Input
                type="number"
                value={disposeData.disposalAmount}
                onChange={(e) =>
                  setDisposeData((p) => ({ ...p, disposalAmount: e.target.value }))
                }
                data-testid="input-disposal-amount"
              />
            </div>
            <div>
              <Label>{t("disposalDate")}</Label>
              <Input
                type="date"
                value={disposeData.disposedAt}
                onChange={(e) =>
                  setDisposeData((p) => ({ ...p, disposedAt: e.target.value }))
                }
                data-testid="input-disposal-date"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setDisposeDialogAsset(null)}
                data-testid="button-cancel-dispose"
              >
                {t("cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={handleDisposeSubmit}
                disabled={disposeMutation.isPending || !disposeData.disposalAmount}
                data-testid="button-confirm-dispose"
              >
                {disposeMutation.isPending ? t("saving") : t("disposeAsset")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
