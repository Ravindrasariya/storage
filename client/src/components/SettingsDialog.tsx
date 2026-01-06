import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Settings, Save, Plus, Trash2, RefreshCcw, AlertTriangle } from "lucide-react";
import type { Chamber } from "@shared/schema";

interface ColdStorageSettings {
  id: string;
  name: string;
  totalCapacity: number;
  waferRate: number;
  seedRate: number;
}

export function SettingsDialog() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { data: coldStorage } = useQuery<ColdStorageSettings>({
    queryKey: ["/api/cold-storage"],
  });

  const { data: chambers } = useQuery<Chamber[]>({
    queryKey: ["/api/chambers"],
  });

  const [settings, setSettings] = useState<ColdStorageSettings | null>(null);
  const [chamberEdits, setChamberEdits] = useState<Chamber[]>([]);

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen && coldStorage) {
      setSettings({ ...coldStorage });
      setChamberEdits(chambers ? [...chambers] : []);
    }
  };

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: Partial<ColdStorageSettings>) => {
      return apiRequest("PATCH", "/api/cold-storage", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cold-storage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });

  const updateChamberMutation = useMutation({
    mutationFn: async (chamber: Chamber) => {
      return apiRequest("PATCH", `/api/chambers/${chamber.id}`, chamber);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chambers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });

  const addChamberMutation = useMutation({
    mutationFn: async (data: { name: string; capacity: number; coldStorageId: string }) => {
      return apiRequest("POST", "/api/chambers", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chambers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });

  const deleteChamberMutation = useMutation({
    mutationFn: async (chamberId: string) => {
      return apiRequest("DELETE", `/api/chambers/${chamberId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chambers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });

  const resetSeasonMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/reset-season");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chambers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics"] });
      toast({
        title: t("success"),
        description: t("resetSuccess"),
      });
      setOpen(false);
    },
    onError: () => {
      toast({
        title: t("error"),
        description: t("resetCannotProceed"),
        variant: "destructive",
      });
    },
  });

  const handleResetSeason = async () => {
    try {
      const response = await fetch("/api/reset-season/check");
      const eligibility = await response.json();
      
      if (!eligibility.canReset) {
        toast({
          title: t("error"),
          description: `${t("resetCannotProceed")} (${eligibility.remainingLots} ${t("remainingLots")}, ${eligibility.remainingBags} ${t("remainingBags")})`,
          variant: "destructive",
        });
        return;
      }
      
      await resetSeasonMutation.mutateAsync();
    } catch (error) {
      toast({
        title: t("error"),
        description: t("resetCannotProceed"),
        variant: "destructive",
      });
    }
  };

  const handleSave = async () => {
    if (!settings) return;

    try {
      await updateSettingsMutation.mutateAsync({
        name: settings.name,
        totalCapacity: settings.totalCapacity,
        waferRate: settings.waferRate,
        seedRate: settings.seedRate,
      });

      for (const chamber of chamberEdits) {
        const original = chambers?.find((c) => c.id === chamber.id);
        if (original && (original.name !== chamber.name || original.capacity !== chamber.capacity)) {
          await updateChamberMutation.mutateAsync(chamber);
        }
      }

      toast({
        title: t("success"),
        description: "Settings saved successfully",
      });
      setOpen(false);
    } catch (error) {
      toast({
        title: t("error"),
        description: "Failed to save settings",
        variant: "destructive",
      });
    }
  };

  const handleAddChamber = async () => {
    if (!coldStorage) return;
    const newChamberNumber = (chambers?.length || 0) + 1;
    try {
      await addChamberMutation.mutateAsync({
        name: `Chamber ${newChamberNumber}`,
        capacity: 10000,
        coldStorageId: coldStorage.id,
      });
      const newChambers = await queryClient.fetchQuery<Chamber[]>({
        queryKey: ["/api/chambers"],
      });
      setChamberEdits(newChambers || []);
    } catch (error) {
      toast({
        title: t("error"),
        description: "Failed to add chamber",
        variant: "destructive",
      });
    }
  };

  const handleDeleteChamber = async (chamberId: string) => {
    try {
      await deleteChamberMutation.mutateAsync(chamberId);
      setChamberEdits((prev) => prev.filter((c) => c.id !== chamberId));
    } catch (error) {
      toast({
        title: t("error"),
        description: "Cannot delete chamber with existing lots",
        variant: "destructive",
      });
    }
  };

  const updateChamber = (chamberId: string, field: "name" | "capacity", value: string | number) => {
    setChamberEdits((prev) =>
      prev.map((c) =>
        c.id === chamberId ? { ...c, [field]: field === "capacity" ? Number(value) : value } : c
      )
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" data-testid="button-settings">
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("settings")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <Card className="p-4 space-y-4">
            <h4 className="font-semibold">{t("coldStorageName")}</h4>
            <div className="space-y-2">
              <Label>{t("name")}</Label>
              <Input
                value={settings?.name || ""}
                onChange={(e) =>
                  setSettings((prev) =>
                    prev ? { ...prev, name: e.target.value } : null
                  )
                }
                placeholder={t("coldStorageName")}
                data-testid="input-cold-storage-name"
              />
            </div>
          </Card>

          <Card className="p-4 space-y-4">
            <h4 className="font-semibold">{t("overallCapacity")}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>{t("overallCapacity")} ({t("bags")})</Label>
                <Input
                  type="number"
                  value={settings?.totalCapacity || 0}
                  onChange={(e) =>
                    setSettings((prev) =>
                      prev ? { ...prev, totalCapacity: Number(e.target.value) } : null
                    )
                  }
                  data-testid="input-total-capacity"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("wafer")} {t("rate")} (Rs)</Label>
                <Input
                  type="number"
                  value={settings?.waferRate || 0}
                  onChange={(e) =>
                    setSettings((prev) =>
                      prev ? { ...prev, waferRate: Number(e.target.value) } : null
                    )
                  }
                  data-testid="input-wafer-rate"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("seed")} {t("rate")} (Rs)</Label>
                <Input
                  type="number"
                  value={settings?.seedRate || 0}
                  onChange={(e) =>
                    setSettings((prev) =>
                      prev ? { ...prev, seedRate: Number(e.target.value) } : null
                    )
                  }
                  data-testid="input-seed-rate"
                />
              </div>
            </div>
          </Card>

          <Card className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">{t("chambers")}</h4>
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddChamber}
                disabled={addChamberMutation.isPending}
                data-testid="button-add-chamber"
              >
                <Plus className="h-4 w-4 mr-1" />
                {t("addChamber")}
              </Button>
            </div>

            <div className="space-y-3">
              {chamberEdits.map((chamber, index) => (
                <div
                  key={chamber.id}
                  className="flex items-center gap-3 p-3 bg-muted/50 rounded-md"
                >
                  <span className="text-sm font-medium w-8">{index + 1}.</span>
                  <Input
                    value={chamber.name}
                    onChange={(e) => updateChamber(chamber.id, "name", e.target.value)}
                    className="flex-1"
                    placeholder="Chamber name"
                    data-testid={`input-chamber-name-${chamber.id}`}
                  />
                  <Input
                    type="number"
                    value={chamber.capacity}
                    onChange={(e) => updateChamber(chamber.id, "capacity", e.target.value)}
                    className="w-32"
                    placeholder="Capacity"
                    data-testid={`input-chamber-capacity-${chamber.id}`}
                  />
                  <span className="text-sm text-muted-foreground">{t("bags")}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteChamber(chamber.id)}
                    disabled={deleteChamberMutation.isPending}
                    data-testid={`button-delete-chamber-${chamber.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4 space-y-4 border-destructive/50">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <h4 className="font-semibold text-destructive">{t("resetForNextSeason")}</h4>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("resetWarning")}
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button 
                  variant="destructive" 
                  className="w-full"
                  data-testid="button-reset-season"
                >
                  <RefreshCcw className="h-4 w-4 mr-2" />
                  {t("resetForNextSeason")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                    {t("resetForNextSeason")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("resetWarning")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleResetSeason}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    data-testid="button-confirm-reset"
                  >
                    {t("proceedWithReset")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Card>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-settings">
              {t("cancel")}
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateSettingsMutation.isPending || updateChamberMutation.isPending}
              data-testid="button-save-settings"
            >
              <Save className="h-4 w-4 mr-2" />
              {t("save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
