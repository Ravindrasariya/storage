import { useState, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowLeft, Upload, User, Package, Plus, Trash2, Layers, ClipboardCheck, Printer } from "lucide-react";
import { format } from "date-fns";
import type { Chamber } from "@shared/schema";

interface ColdStorageSettings {
  id: string;
  name: string;
  waferColdCharge: number;
  waferHammali: number;
  seedColdCharge: number;
  seedHammali: number;
}

const farmerSchema = z.object({
  farmerName: z.string().min(1, "Farmer name is required"),
  village: z.string().min(1, "Village is required"),
  tehsil: z.string().min(1, "Tehsil is required"),
  district: z.string().min(1, "District is required"),
  state: z.string().min(1, "State is required"),
  contactNumber: z.string().regex(/^\d{10}$/, "Contact number must be exactly 10 digits"),
});

type FarmerData = z.infer<typeof farmerSchema>;

interface LotData {
  lotNo: string;
  size: number;
  type: string;
  bagType: "wafer" | "seed";
  chamberId: string;
  floor: number;
  position: string;
  quality: "poor" | "medium" | "good";
  potatoSize: "large" | "small";
  assayingType: "Quality Check" | "Visual";
  assayerImage: string;
  reducingSugar?: number;
  dm?: number;
  remarks: string;
}

const defaultLotData: LotData = {
  lotNo: "",
  size: 1,
  type: "",
  bagType: "wafer",
  chamberId: "",
  floor: 1,
  position: "",
  quality: "medium",
  potatoSize: "large",
  assayingType: "Visual",
  assayerImage: "",
  reducingSugar: undefined,
  dm: undefined,
  remarks: "",
};

export default function LotEntry() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [lots, setLots] = useState<LotData[]>([{ ...defaultLotData }]);
  const [imagePreviews, setImagePreviews] = useState<Record<number, string>>({});
  const [showReceipt, setShowReceipt] = useState(false);
  const [savedData, setSavedData] = useState<{ farmer: FarmerData; lots: LotData[]; entryDate: Date } | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const { data: chambers, isLoading: chambersLoading } = useQuery<Chamber[]>({
    queryKey: ["/api/chambers"],
  });

  const { data: coldStorage } = useQuery<ColdStorageSettings>({
    queryKey: ["/api/cold-storage"],
  });

  const form = useForm<FarmerData>({
    resolver: zodResolver(farmerSchema),
    defaultValues: {
      farmerName: "",
      village: "",
      tehsil: "",
      district: "",
      state: "",
      contactNumber: "",
    },
  });

  const createLotMutation = useMutation({
    mutationFn: async (data: FarmerData & LotData) => {
      return apiRequest("POST", "/api/lots", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
    onError: (error: Error) => {
      toast({
        title: t("error"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateLot = (index: number, field: keyof LotData, value: any) => {
    setLots(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleImageUpload = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setImagePreviews(prev => ({ ...prev, [index]: base64 }));
        updateLot(index, "assayerImage", base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const addLot = () => {
    setLots(prev => [...prev, { ...defaultLotData }]);
  };

  const removeLot = (index: number) => {
    if (lots.length > 1) {
      setLots(prev => prev.filter((_, i) => i !== index));
      setImagePreviews(prev => {
        const updated = { ...prev };
        delete updated[index];
        return updated;
      });
    }
  };

  const validateLots = (): boolean => {
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];
      if (!lot.lotNo) {
        toast({ title: t("error"), description: `Lot ${i + 1}: Lot number is required`, variant: "destructive" });
        return false;
      }
      if (lot.size < 1) {
        toast({ title: t("error"), description: `Lot ${i + 1}: Size must be at least 1`, variant: "destructive" });
        return false;
      }
      if (!lot.type) {
        toast({ title: t("error"), description: `Lot ${i + 1}: Type is required`, variant: "destructive" });
        return false;
      }
      if (!lot.chamberId) {
        toast({ title: t("error"), description: `Lot ${i + 1}: Chamber is required`, variant: "destructive" });
        return false;
      }
      if (!lot.position) {
        toast({ title: t("error"), description: `Lot ${i + 1}: Position is required`, variant: "destructive" });
        return false;
      }
    }
    return true;
  };

  const [shouldPrint, setShouldPrint] = useState(false);

  const onSubmit = async (farmerData: FarmerData) => {
    if (!validateLots()) return;

    try {
      for (const lot of lots) {
        await createLotMutation.mutateAsync({ ...farmerData, ...lot });
      }
      toast({
        title: t("success"),
        description: `${lots.length} lot(s) created successfully`,
      });
      
      if (shouldPrint) {
        setSavedData({ farmer: farmerData, lots: [...lots], entryDate: new Date() });
        setShowReceipt(true);
        setShouldPrint(false);
      } else {
        navigate("/");
      }
    } catch (error) {
      setShouldPrint(false);
    }
  };

  const handleSaveAndPrint = () => {
    setShouldPrint(true);
    form.handleSubmit(onSubmit)();
  };

  const handlePrint = () => {
    if (!printRef.current) return;
    
    const printContent = printRef.current.innerHTML;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Lot Entry Receipt</title>
        <style>
          @page { size: A4; margin: 15mm; }
          body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            font-size: 12px; 
            line-height: 1.4;
            color: #333;
            margin: 0;
            padding: 0;
          }
          .receipt-header {
            text-align: center;
            border-bottom: 2px solid #333;
            padding-bottom: 10px;
            margin-bottom: 15px;
          }
          .receipt-header h1 {
            font-size: 20px;
            margin: 0 0 5px 0;
          }
          .receipt-header h2 {
            font-size: 16px;
            margin: 0;
            color: #555;
          }
          .section {
            margin-bottom: 15px;
          }
          .section-title {
            font-size: 13px;
            font-weight: bold;
            background: #f0f0f0;
            padding: 5px 8px;
            margin-bottom: 8px;
            border-left: 3px solid #333;
          }
          .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 5px 15px;
          }
          .info-row {
            display: flex;
            gap: 5px;
          }
          .info-label {
            font-weight: 600;
            min-width: 80px;
          }
          .lots-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
          }
          .lots-table th, .lots-table td {
            border: 1px solid #ccc;
            padding: 6px 8px;
            text-align: left;
          }
          .lots-table th {
            background: #f5f5f5;
            font-weight: 600;
          }
          .entry-date {
            text-align: right;
            font-size: 11px;
            color: #666;
            margin-top: 15px;
          }
          .footer-note {
            text-align: center;
            font-size: 10px;
            color: #666;
            margin-top: 20px;
            padding-top: 10px;
            border-top: 1px solid #ccc;
          }
        </style>
      </head>
      <body>
        ${printContent}
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const getChamberName = (chamberId: string) => {
    return chambers?.find(c => c.id === chamberId)?.name || chamberId;
  };

  const getRate = (bagType: "wafer" | "seed") => {
    if (!coldStorage) return 0;
    if (bagType === "wafer") {
      return (coldStorage.waferColdCharge || 0) + (coldStorage.waferHammali || 0);
    }
    return (coldStorage.seedColdCharge || 0) + (coldStorage.seedHammali || 0);
  };

  if (chambersLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
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
          <h1 className="text-2xl sm:text-3xl font-bold">{t("newLot")}</h1>
          <p className="text-muted-foreground mt-1">
            Enter details for the incoming lot(s)
          </p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card className="p-4 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
              <User className="h-5 w-5 text-chart-1" />
              <h2 className="text-lg font-semibold">{t("farmerDetails")}</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="farmerName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("farmerName")} *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Enter farmer name"
                        data-testid="input-farmer-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("contactNumber")} *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Enter 10-digit number"
                        maxLength={10}
                        data-testid="input-contact"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="village"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("village")} *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Enter village"
                        data-testid="input-village"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="tehsil"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("tehsil")} *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Enter tehsil"
                        data-testid="input-tehsil"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="district"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("district")} *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Enter district"
                        data-testid="input-district"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="state"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("state")} *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Enter state"
                        data-testid="input-state"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </Card>

          {lots.map((lot, index) => (
            <Card key={index} className="p-4 sm:p-6 space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-chart-2" />
                  <h2 className="text-lg font-semibold">
                    {t("lot") || "Lot"} {index + 1}
                  </h2>
                </div>
                {lots.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeLot(index)}
                    data-testid={`button-remove-lot-${index}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-chart-2" />
                  <h3 className="font-semibold">{t("lotInformation")}</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">{t("lotNo")} *</label>
                    <Input
                      value={lot.lotNo}
                      onChange={(e) => updateLot(index, "lotNo", e.target.value)}
                      placeholder="Enter lot number"
                      data-testid={`input-lot-no-${index}`}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">{t("size")} *</label>
                    <Input
                      type="number"
                      min={0}
                      value={lot.size}
                      onChange={(e) => updateLot(index, "size", parseInt(e.target.value) || 0)}
                      data-testid={`input-size-${index}`}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">{t("type")} *</label>
                    <Select value={lot.type} onValueChange={(v) => updateLot(index, "type", v)}>
                      <SelectTrigger data-testid={`select-type-${index}`}>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Jyoti">Jyoti</SelectItem>
                        <SelectItem value="Pukhraj">Pukhraj</SelectItem>
                        <SelectItem value="LR">LR</SelectItem>
                        <SelectItem value="Torus">Torus</SelectItem>
                        <SelectItem value="CS1">CS1</SelectItem>
                        <SelectItem value="CS3">CS3</SelectItem>
                        <SelectItem value="Others">Others</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">{t("bagType")} *</label>
                    <Select value={lot.bagType} onValueChange={(v) => updateLot(index, "bagType", v as "wafer" | "seed")}>
                      <SelectTrigger data-testid={`select-bag-type-${index}`}>
                        <SelectValue placeholder="Select bag type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="wafer">{t("wafer")}</SelectItem>
                        <SelectItem value="seed">{t("seed")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-chart-3" />
                  <h3 className="font-semibold">{t("storageLocation")}</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="text-sm font-medium">{t("chamber")} *</label>
                    <Select value={lot.chamberId} onValueChange={(v) => updateLot(index, "chamberId", v)}>
                      <SelectTrigger data-testid={`select-chamber-${index}`}>
                        <SelectValue placeholder="Select chamber" />
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
                  <div>
                    <label className="text-sm font-medium">{t("floor")} *</label>
                    <Input
                      type="number"
                      min={0}
                      value={lot.floor}
                      onChange={(e) => updateLot(index, "floor", parseInt(e.target.value) || 0)}
                      data-testid={`input-floor-${index}`}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">{t("position")} *</label>
                    <Input
                      type="text"
                      placeholder="e.g. 12/5, 12A/5"
                      value={lot.position}
                      onChange={(e) => updateLot(index, "position", e.target.value)}
                      data-testid={`input-position-${index}`}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4 text-chart-4" />
                  <h3 className="font-semibold">{t("qualityAssessment")}</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">{t("quality")} *</label>
                    <Select value={lot.quality} onValueChange={(v) => updateLot(index, "quality", v as "poor" | "medium" | "good")}>
                      <SelectTrigger data-testid={`select-quality-${index}`}>
                        <SelectValue placeholder="Select quality" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="poor">{t("poor")}</SelectItem>
                        <SelectItem value="medium">{t("medium")}</SelectItem>
                        <SelectItem value="good">{t("good")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">{t("potatoSize")} *</label>
                    <Select value={lot.potatoSize} onValueChange={(v) => updateLot(index, "potatoSize", v as "large" | "small")}>
                      <SelectTrigger data-testid={`select-potato-size-${index}`}>
                        <SelectValue placeholder={t("selectSize")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="large">{t("large")}</SelectItem>
                        <SelectItem value="small">{t("small")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-sm font-medium">{t("assayingType")} *</label>
                    <RadioGroup
                      value={lot.assayingType}
                      onValueChange={(v) => updateLot(index, "assayingType", v as "Quality Check" | "Visual")}
                      className="flex gap-4 pt-2"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="Quality Check" id={`quality-check-${index}`} data-testid={`radio-quality-check-${index}`} />
                        <label htmlFor={`quality-check-${index}`} className="text-sm">
                          {t("qualityCheck")}
                        </label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="Visual" id={`visual-${index}`} data-testid={`radio-visual-${index}`} />
                        <label htmlFor={`visual-${index}`} className="text-sm">
                          {t("visual")}
                        </label>
                      </div>
                    </RadioGroup>
                  </div>

                  {lot.assayingType === "Quality Check" && (
                    <>
                      <div className="sm:col-span-2">
                        <label className="text-sm font-medium">{t("assayerImage")}</label>
                        <div className="flex flex-col gap-4 mt-2">
                          <div className="flex items-center gap-4">
                            <label
                              htmlFor={`image-upload-${index}`}
                              className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-md cursor-pointer hover-elevate"
                            >
                              <Upload className="h-4 w-4" />
                              Upload Image
                            </label>
                            <input
                              id={`image-upload-${index}`}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => handleImageUpload(index, e)}
                              data-testid={`input-image-${index}`}
                            />
                          </div>
                          {imagePreviews[index] && (
                            <img
                              src={imagePreviews[index]}
                              alt="Preview"
                              className="w-32 h-32 object-cover rounded-lg border"
                            />
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-medium">{t("reducingSugar")}</label>
                        <Input
                          type="number"
                          step="0.01"
                          value={lot.reducingSugar ?? ""}
                          onChange={(e) => updateLot(index, "reducingSugar", e.target.value ? parseFloat(e.target.value) : undefined)}
                          data-testid={`input-reducing-sugar-${index}`}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium">{t("dm")}</label>
                        <Input
                          type="number"
                          step="0.01"
                          value={lot.dm ?? ""}
                          onChange={(e) => updateLot(index, "dm", e.target.value ? parseFloat(e.target.value) : undefined)}
                          data-testid={`input-dm-${index}`}
                        />
                      </div>
                    </>
                  )}

                  <div className="sm:col-span-2">
                    <label className="text-sm font-medium">{t("remarks")}</label>
                    <Textarea
                      value={lot.remarks}
                      onChange={(e) => updateLot(index, "remarks", e.target.value)}
                      placeholder="Any additional remarks..."
                      rows={3}
                      data-testid={`input-remarks-${index}`}
                    />
                  </div>
                </div>
              </div>
            </Card>
          ))}

          <Button
            type="button"
            variant="outline"
            onClick={addLot}
            className="w-full"
            data-testid="button-add-lot"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t("addMoreLot") || "Add More Lot"}
          </Button>

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate("/")}
              data-testid="button-cancel"
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={createLotMutation.isPending}
              data-testid="button-submit"
            >
              {createLotMutation.isPending && !shouldPrint ? t("loading") : t("save")}
            </Button>
            <Button
              type="button"
              onClick={handleSaveAndPrint}
              disabled={createLotMutation.isPending}
              data-testid="button-save-print"
            >
              <Printer className="h-4 w-4 mr-2" />
              {createLotMutation.isPending && shouldPrint ? t("loading") : (t("saveAndPrint") || "Save & Print")}
            </Button>
          </div>
        </form>
      </Form>

      <Dialog open={showReceipt} onOpenChange={(open) => {
        if (!open) {
          setShowReceipt(false);
          navigate("/");
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-5 w-5" />
              {t("lotEntryReceipt") || "Lot Entry Receipt"}
            </DialogTitle>
          </DialogHeader>

          {savedData && (
            <>
              <div ref={printRef}>
                <div className="receipt-header">
                  <h1>{coldStorage?.name || "Cold Storage"}</h1>
                  <h2>{t("lotEntryReceipt") || "Lot Entry Receipt"}</h2>
                </div>

                <div className="section">
                  <div className="section-title">{t("farmerDetails")}</div>
                  <div className="info-grid">
                    <div className="info-row">
                      <span className="info-label">{t("farmerName")}:</span>
                      <span>{savedData.farmer.farmerName}</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">{t("contactNumber")}:</span>
                      <span>{savedData.farmer.contactNumber}</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">{t("village")}:</span>
                      <span>{savedData.farmer.village}</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">{t("tehsil")}:</span>
                      <span>{savedData.farmer.tehsil}</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">{t("district")}:</span>
                      <span>{savedData.farmer.district}</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">{t("state")}:</span>
                      <span>{savedData.farmer.state}</span>
                    </div>
                  </div>
                </div>

                <div className="section">
                  <div className="section-title">{t("lotDetails") || "Lot Details"}</div>
                  <table className="lots-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>{t("lotNo")}</th>
                        <th>{t("type")}</th>
                        <th>{t("bags")}</th>
                        <th>{t("bagType")}</th>
                        <th>{t("chamber")}</th>
                        <th>{t("floor")}</th>
                        <th>{t("position")}</th>
                        <th>{t("quality")}</th>
                        <th>{t("potatoSize")}</th>
                        <th>{t("rate")} (₹)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {savedData.lots.map((lot, index) => (
                        <tr key={index}>
                          <td>{index + 1}</td>
                          <td>{lot.lotNo}</td>
                          <td>{lot.type}</td>
                          <td>{lot.size}</td>
                          <td>{lot.bagType === "wafer" ? t("wafer") : t("seed")}</td>
                          <td>{getChamberName(lot.chamberId)}</td>
                          <td>{lot.floor}</td>
                          <td>{lot.position}</td>
                          <td>{lot.quality === "good" ? t("good") : lot.quality === "medium" ? t("medium") : t("poor")}</td>
                          <td>{lot.potatoSize === "large" ? t("large") : t("small")}</td>
                          <td>{getRate(lot.bagType)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="entry-date">
                  {t("entryDate") || "Entry Date"}: {format(savedData.entryDate, "dd/MM/yyyy HH:mm")}
                </div>

                <div className="footer-note">
                  {t("receiptFooterNote") || "This is a computer generated receipt."}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button variant="outline" onClick={() => { setShowReceipt(false); navigate("/"); }}>
                  {t("close")}
                </Button>
                <Button onClick={handlePrint}>
                  <Printer className="h-4 w-4 mr-2" />
                  {t("print")}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
