import { useState, useEffect } from "react";
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
import { Settings, Save, Plus, Trash2, RefreshCcw, AlertTriangle, ChevronDown, ChevronUp, Wrench } from "lucide-react";
import type { Chamber, ChamberFloor, MaintenanceRecord } from "@shared/schema";

interface ColdStorageSettings {
  id: string;
  name: string;
  totalCapacity: number;
  waferRate: number;
  seedRate: number;
  waferColdCharge: number;
  waferHammali: number;
  seedColdCharge: number;
  seedHammali: number;
}

type ChamberFloorsData = Record<string, ChamberFloor[]>;

export function SettingsDialog() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [expandedChambers, setExpandedChambers] = useState<Set<string>>(new Set());

  const { data: coldStorage } = useQuery<ColdStorageSettings>({
    queryKey: ["/api/cold-storage"],
  });

  const { data: chambers } = useQuery<Chamber[]>({
    queryKey: ["/api/chambers"],
  });

  const { data: chamberFloors } = useQuery<ChamberFloorsData>({
    queryKey: ["/api/chamber-floors"],
  });

  const { data: maintenanceRecords } = useQuery<MaintenanceRecord[]>({
    queryKey: ["/api/maintenance"],
  });

  const [settings, setSettings] = useState<ColdStorageSettings | null>(null);
  const [chamberEdits, setChamberEdits] = useState<Chamber[]>([]);
  const [floorEdits, setFloorEdits] = useState<ChamberFloorsData>({});

  interface MaintenanceRow {
    id?: string;
    taskDescription: string;
    responsiblePerson: string;
    nextDueDate: string;
    isNew?: boolean;
  }
  const [maintenanceRows, setMaintenanceRows] = useState<MaintenanceRow[]>([]);

  useEffect(() => {
    if (open && maintenanceRecords) {
      if (maintenanceRecords.length > 0) {
        setMaintenanceRows(maintenanceRecords.map(r => ({
          id: r.id,
          taskDescription: r.taskDescription,
          responsiblePerson: r.responsiblePerson,
          nextDueDate: r.nextDueDate,
        })));
      } else if (maintenanceRows.length === 0) {
        setMaintenanceRows([{ taskDescription: "", responsiblePerson: "", nextDueDate: "", isNew: true }]);
      }
    }
  }, [open, maintenanceRecords]);

  const toggleExpandChamber = (chamberId: string) => {
    setExpandedChambers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(chamberId)) {
        newSet.delete(chamberId);
      } else {
        newSet.add(chamberId);
      }
      return newSet;
    });
  };

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen && coldStorage) {
      setSettings({ ...coldStorage });
      setChamberEdits(chambers ? [...chambers] : []);
      setFloorEdits(chamberFloors ? { ...chamberFloors } : {});
      if (maintenanceRecords && maintenanceRecords.length > 0) {
        setMaintenanceRows(maintenanceRecords.map(r => ({
          id: r.id,
          taskDescription: r.taskDescription,
          responsiblePerson: r.responsiblePerson,
          nextDueDate: r.nextDueDate,
        })));
      } else {
        setMaintenanceRows([{ taskDescription: "", responsiblePerson: "", nextDueDate: "", isNew: true }]);
      }
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
      queryClient.invalidateQueries({ queryKey: ["/api/chamber-floors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chambers/floor-capacity"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });

  const addChamberMutation = useMutation({
    mutationFn: async (data: { name: string; capacity: number; coldStorageId: string }) => {
      return apiRequest("POST", "/api/chambers", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chambers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chamber-floors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chambers/floor-capacity"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });

  const deleteChamberMutation = useMutation({
    mutationFn: async (chamberId: string) => {
      return apiRequest("DELETE", `/api/chambers/${chamberId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chambers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chamber-floors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chambers/floor-capacity"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });

  const addFloorMutation = useMutation({
    mutationFn: async (data: { chamberId: string; floorNumber: number; capacity: number }) => {
      return apiRequest("POST", "/api/chamber-floors", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chamber-floors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chambers/floor-capacity"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });

  const updateFloorMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; floorNumber: number; capacity: number }) => {
      return apiRequest("PATCH", `/api/chamber-floors/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chamber-floors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chambers/floor-capacity"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });

  const deleteFloorMutation = useMutation({
    mutationFn: async (floorId: string) => {
      return apiRequest("DELETE", `/api/chamber-floors/${floorId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chamber-floors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chambers/floor-capacity"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/chamber-floors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chambers/floor-capacity"] });
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

  const createMaintenanceMutation = useMutation({
    mutationFn: async (data: { taskDescription: string; responsiblePerson: string; nextDueDate: string }) => {
      return apiRequest("POST", "/api/maintenance", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance"] });
    },
  });

  const updateMaintenanceMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; taskDescription: string; responsiblePerson: string; nextDueDate: string }) => {
      return apiRequest("PATCH", `/api/maintenance/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance"] });
    },
  });

  const deleteMaintenanceMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/maintenance/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance"] });
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
        waferRate: (settings.waferColdCharge || 0) + (settings.waferHammali || 0),
        seedRate: (settings.seedColdCharge || 0) + (settings.seedHammali || 0),
        waferColdCharge: settings.waferColdCharge,
        waferHammali: settings.waferHammali,
        seedColdCharge: settings.seedColdCharge,
        seedHammali: settings.seedHammali,
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

  const handleAddFloor = async (chamberId: string) => {
    const existingFloors = chamberFloors?.[chamberId] || [];
    const nextFloorNumber = existingFloors.length > 0 
      ? Math.max(...existingFloors.map(f => f.floorNumber)) + 1 
      : 1;
    
    try {
      await addFloorMutation.mutateAsync({
        chamberId,
        floorNumber: nextFloorNumber,
        capacity: 1000,
      });
      const newFloors = await queryClient.fetchQuery<ChamberFloorsData>({
        queryKey: ["/api/chamber-floors"],
      });
      setFloorEdits(newFloors || {});
    } catch (error) {
      toast({
        title: t("error"),
        description: "Failed to add floor",
        variant: "destructive",
      });
    }
  };

  const handleDeleteFloor = async (floorId: string, chamberId: string) => {
    try {
      await deleteFloorMutation.mutateAsync(floorId);
      setFloorEdits((prev) => ({
        ...prev,
        [chamberId]: prev[chamberId]?.filter((f) => f.id !== floorId) || [],
      }));
    } catch (error) {
      toast({
        title: t("error"),
        description: "Failed to delete floor",
        variant: "destructive",
      });
    }
  };

  const handleUpdateFloor = async (floor: ChamberFloor) => {
    try {
      await updateFloorMutation.mutateAsync({
        id: floor.id,
        floorNumber: floor.floorNumber,
        capacity: floor.capacity,
      });
    } catch (error) {
      toast({
        title: t("error"),
        description: "Failed to update floor",
        variant: "destructive",
      });
    }
  };

  const updateFloorEdit = (chamberId: string, floorId: string, field: "floorNumber" | "capacity", value: number) => {
    setFloorEdits((prev) => {
      const existingFloors = prev[chamberId] || chamberFloors?.[chamberId] || [];
      return {
        ...prev,
        [chamberId]: existingFloors.map((f) =>
          f.id === floorId ? { ...f, [field]: value } : f
        ),
      };
    });
  };

  const handleAddMaintenanceRow = () => {
    setMaintenanceRows(prev => [...prev, { taskDescription: "", responsiblePerson: "", nextDueDate: "", isNew: true }]);
  };

  const handleDeleteMaintenanceRow = (index: number) => {
    const row = maintenanceRows[index];
    if (row.id) {
      deleteMaintenanceMutation.mutate(row.id);
    }
    setMaintenanceRows(prev => prev.filter((_, i) => i !== index));
  };

  const updateMaintenanceRow = (index: number, field: "taskDescription" | "responsiblePerson" | "nextDueDate", value: string) => {
    setMaintenanceRows(prev => 
      prev.map((row, i) => i === index ? { ...row, [field]: value } : row)
    );
  };

  const handleSaveMaintenance = async () => {
    try {
      for (const row of maintenanceRows) {
        if (row.isNew || !row.id) {
          if (row.taskDescription || row.responsiblePerson || row.nextDueDate) {
            await createMaintenanceMutation.mutateAsync({
              taskDescription: row.taskDescription,
              responsiblePerson: row.responsiblePerson,
              nextDueDate: row.nextDueDate,
            });
          }
        } else {
          await updateMaintenanceMutation.mutateAsync({
            id: row.id,
            taskDescription: row.taskDescription,
            responsiblePerson: row.responsiblePerson,
            nextDueDate: row.nextDueDate,
          });
        }
      }
      const updatedRecords = await queryClient.fetchQuery<MaintenanceRecord[]>({
        queryKey: ["/api/maintenance"],
      });
      setMaintenanceRows(updatedRecords?.map(r => ({
        id: r.id,
        taskDescription: r.taskDescription,
        responsiblePerson: r.responsiblePerson,
        nextDueDate: r.nextDueDate,
      })) || [{ taskDescription: "", responsiblePerson: "", nextDueDate: "", isNew: true }]);
      toast({
        title: t("success"),
        description: "Maintenance records saved successfully",
      });
    } catch (error) {
      toast({
        title: t("error"),
        description: "Failed to save maintenance records",
        variant: "destructive",
      });
    }
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
          </Card>

          <Card className="p-4 space-y-4">
            <h4 className="font-semibold">{t("wafer")} {t("rate")} (Rs)</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("coldStorageCharge")}</Label>
                <Input
                  type="number"
                  value={settings?.waferColdCharge || 0}
                  onChange={(e) =>
                    setSettings((prev) =>
                      prev ? { ...prev, waferColdCharge: Number(e.target.value) } : null
                    )
                  }
                  data-testid="input-wafer-cold-charge"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("hammali")}</Label>
                <Input
                  type="number"
                  value={settings?.waferHammali || 0}
                  onChange={(e) =>
                    setSettings((prev) =>
                      prev ? { ...prev, waferHammali: Number(e.target.value) } : null
                    )
                  }
                  data-testid="input-wafer-hammali"
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("total")}: Rs {(settings?.waferColdCharge || 0) + (settings?.waferHammali || 0)}
            </p>
          </Card>

          <Card className="p-4 space-y-4">
            <h4 className="font-semibold">{t("seed")} {t("rate")} (Rs)</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("coldStorageCharge")}</Label>
                <Input
                  type="number"
                  value={settings?.seedColdCharge || 0}
                  onChange={(e) =>
                    setSettings((prev) =>
                      prev ? { ...prev, seedColdCharge: Number(e.target.value) } : null
                    )
                  }
                  data-testid="input-seed-cold-charge"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("hammali")}</Label>
                <Input
                  type="number"
                  value={settings?.seedHammali || 0}
                  onChange={(e) =>
                    setSettings((prev) =>
                      prev ? { ...prev, seedHammali: Number(e.target.value) } : null
                    )
                  }
                  data-testid="input-seed-hammali"
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("total")}: Rs {(settings?.seedColdCharge || 0) + (settings?.seedHammali || 0)}
            </p>
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
              {chamberEdits.map((chamber, index) => {
                const isExpanded = expandedChambers.has(chamber.id);
                const floors = floorEdits[chamber.id] || chamberFloors?.[chamber.id] || [];
                const floorTotal = floors.reduce((sum, f) => sum + f.capacity, 0);

                return (
                  <div key={chamber.id} className="space-y-2">
                    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-md">
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
                        onClick={() => toggleExpandChamber(chamber.id)}
                        data-testid={`button-expand-chamber-${chamber.id}`}
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
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

                    {isExpanded && (
                      <div className="ml-8 pl-4 border-l-2 border-muted space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">
                            {t("floor")} {t("capacity")}: {floorTotal.toLocaleString()} / {chamber.capacity.toLocaleString()} {t("bags")}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleAddFloor(chamber.id)}
                            disabled={addFloorMutation.isPending}
                            data-testid={`button-add-floor-${chamber.id}`}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            {t("addFloor")}
                          </Button>
                        </div>
                        
                        {floors.length === 0 ? (
                          <p className="text-sm text-muted-foreground py-2">{t("noFloorsConfigured")}</p>
                        ) : (
                          floors.map((floor) => {
                            const editedFloor = floorEdits[chamber.id]?.find(f => f.id === floor.id) || floor;
                            return (
                              <div key={floor.id} className="flex items-center gap-2 p-2 bg-muted/30 rounded">
                                <span className="text-sm w-16">{t("floor")}</span>
                                <Input
                                  type="number"
                                  value={editedFloor.floorNumber}
                                  onChange={(e) => updateFloorEdit(chamber.id, floor.id, "floorNumber", Number(e.target.value))}
                                  onBlur={() => handleUpdateFloor(editedFloor)}
                                  className="w-20"
                                  data-testid={`input-floor-number-${floor.id}`}
                                />
                                <span className="text-sm">{t("capacity")}:</span>
                                <Input
                                  type="number"
                                  value={editedFloor.capacity}
                                  onChange={(e) => updateFloorEdit(chamber.id, floor.id, "capacity", Number(e.target.value))}
                                  onBlur={() => handleUpdateFloor(editedFloor)}
                                  className="w-24"
                                  data-testid={`input-floor-capacity-${floor.id}`}
                                />
                                <span className="text-sm text-muted-foreground">{t("bags")}</span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeleteFloor(floor.id, chamber.id)}
                                  disabled={deleteFloorMutation.isPending}
                                  data-testid={`button-delete-floor-${floor.id}`}
                                >
                                  <Trash2 className="h-3 w-3 text-destructive" />
                                </Button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
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

          <Card className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wrench className="h-5 w-5 text-chart-4" />
                <h4 className="font-semibold">{t("maintenance") || "Maintenance"}</h4>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddMaintenanceRow}
                data-testid="button-add-maintenance-row"
              >
                <Plus className="h-4 w-4 mr-1" />
                {t("addRow") || "Add Row"}
              </Button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-12 gap-2 text-sm font-medium text-muted-foreground px-2">
                <span className="col-span-4">{t("taskDescription") || "Task Description"}</span>
                <span className="col-span-3">{t("responsiblePerson") || "Responsible Person"}</span>
                <span className="col-span-3">{t("nextDueDate") || "Next Due Date"}</span>
                <span className="col-span-2"></span>
              </div>
              {maintenanceRows.map((row, index) => (
                <div key={row.id || `new-${index}`} className="grid grid-cols-12 gap-2 items-center">
                  <Input
                    value={row.taskDescription}
                    onChange={(e) => updateMaintenanceRow(index, "taskDescription", e.target.value)}
                    className="col-span-4"
                    placeholder={t("taskDescription") || "Task description"}
                    data-testid={`input-maintenance-task-${index}`}
                  />
                  <Input
                    value={row.responsiblePerson}
                    onChange={(e) => updateMaintenanceRow(index, "responsiblePerson", e.target.value)}
                    className="col-span-3"
                    placeholder={t("responsiblePerson") || "Person name"}
                    data-testid={`input-maintenance-person-${index}`}
                  />
                  <Input
                    value={row.nextDueDate}
                    onChange={(e) => updateMaintenanceRow(index, "nextDueDate", e.target.value)}
                    className="col-span-3"
                    placeholder="DD/MM/YYYY"
                    data-testid={`input-maintenance-date-${index}`}
                  />
                  <div className="col-span-2 flex justify-end">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteMaintenanceRow(index)}
                      disabled={deleteMaintenanceMutation.isPending}
                      data-testid={`button-delete-maintenance-${index}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <Button
                onClick={handleSaveMaintenance}
                disabled={createMaintenanceMutation.isPending || updateMaintenanceMutation.isPending}
                data-testid="button-save-maintenance"
              >
                <Save className="h-4 w-4 mr-2" />
                {t("saveMaintenance") || "Save Maintenance"}
              </Button>
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
