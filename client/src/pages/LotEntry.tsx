import { useState, useEffect, useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { apiRequest, queryClient, authFetch } from "@/lib/queryClient";
import { ArrowLeft, Upload, User, Package, Plus, Trash2, Layers, ClipboardCheck } from "lucide-react";
import type { Chamber } from "@shared/schema";
import { capitalizeFirstLetter, cn } from "@/lib/utils";

// Type for farmer records returned from lookup API
interface FarmerRecord {
  farmerName: string;
  village: string;
  tehsil: string;
  district: string;
  state: string;
  contactNumber: string;
}

interface ColdStorageSettings {
  id: string;
  name: string;
  waferColdCharge: number;
  waferHammali: number;
  seedColdCharge: number;
  seedHammali: number;
  chargeUnit: "bag" | "quintal";
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
  size: number;
  netWeight?: number;
  type: string;
  bagType: "wafer" | "seed" | "Ration";
  bagTypeLabel: string;
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
  size: 0,
  netWeight: undefined,
  type: "",
  bagType: "wafer",
  bagTypeLabel: "",
  chamberId: "",
  floor: 0,
  position: "",
  quality: "medium",
  potatoSize: "large",
  assayingType: "Visual",
  assayerImage: "",
  reducingSugar: undefined,
  dm: undefined,
  remarks: "",
};

const STORAGE_KEY = "lotEntryFormData";
const STORAGE_VERSION_KEY = "lotEntryFormVersion";
const CURRENT_STORAGE_VERSION = "2";
const BAG_TYPE_PREFERENCE_KEY = "lotEntryBagTypePreference";

export default function LotEntry() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { canEdit } = useAuth();
  
  // Initialize bagTypeCategory from localStorage preference
  const [bagTypeCategory, setBagTypeCategory] = useState<"wafer" | "rationSeed">(() => {
    try {
      const saved = localStorage.getItem(BAG_TYPE_PREFERENCE_KEY);
      if (saved === "wafer" || saved === "rationSeed") {
        return saved;
      }
    } catch (e) {
      console.error("Failed to load bag type preference", e);
    }
    return "wafer";
  });
  const [lots, setLots] = useState<LotData[]>([{ ...defaultLotData }]);
  const [imagePreviews, setImagePreviews] = useState<Record<number, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  const { data: chambers, isLoading: chambersLoading } = useQuery<Chamber[]>({
    queryKey: ["/api/chambers"],
  });

  const { data: coldStorage } = useQuery<ColdStorageSettings>({
    queryKey: ["/api/cold-storage"],
  });

  const { data: chamberFloors } = useQuery<Record<string, { id: string; chamberId: string; floorNumber: number; capacity: number }[]>>({
    queryKey: ["/api/chamber-floors"],
  });

  // Fetch next entry sequence for display (based on category)
  const { data: nextSequenceData } = useQuery<{ nextSequence: number }>({
    queryKey: ["/api/next-entry-sequence", bagTypeCategory],
    queryFn: async () => {
      const response = await authFetch(`/api/next-entry-sequence?bagTypeCategory=${bagTypeCategory}`);
      if (!response.ok) throw new Error('Failed to fetch sequence');
      return response.json();
    },
  });

  // Fetch farmer records for autocomplete
  const { data: farmerRecords } = useQuery<FarmerRecord[]>({
    queryKey: ["/api/farmers/lookup"],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch bag type labels for autocomplete
  const { data: bagTypeLabels } = useQuery<{ label: string }[]>({
    queryKey: ["/api/bag-type-labels/lookup"],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch unique location names (villages and tehsils) from all lots
  const { data: locationData } = useQuery<{ villages: string[]; tehsils: string[] }>({
    queryKey: ["/api/locations/lookup"],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // State for autocomplete suggestions
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [showVillageSuggestions, setShowVillageSuggestions] = useState(false);
  const [showTehsilSuggestions, setShowTehsilSuggestions] = useState(false);
  const [showMobileSuggestions, setShowMobileSuggestions] = useState(false);
  const [showBagTypeLabelSuggestions, setShowBagTypeLabelSuggestions] = useState<Record<number, boolean>>({});
  
  // State for tracking auto-filled fields (for visual highlight)
  const [autoFilledFields, setAutoFilledFields] = useState<Set<string>>(new Set());

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

  // Watch form values for reactive autocomplete filtering (must be after form initialization)
  const watchedFarmerName = form.watch("farmerName") || "";
  const watchedVillage = form.watch("village") || "";
  const watchedTehsil = form.watch("tehsil") || "";
  const watchedContactNumber = form.watch("contactNumber") || "";

  // Load saved form data from localStorage on mount
  useEffect(() => {
    try {
      const savedVersion = localStorage.getItem(STORAGE_VERSION_KEY);
      if (savedVersion !== CURRENT_STORAGE_VERSION) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.setItem(STORAGE_VERSION_KEY, CURRENT_STORAGE_VERSION);
      }
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const { farmer, lots: savedLots, imagePreviews: savedPreviews, bagTypeCategory: savedCategory } = JSON.parse(saved);
        if (farmer) {
          form.reset(farmer);
        }
        if (savedLots && savedLots.length > 0) {
          setLots(savedLots);
        }
        if (savedPreviews) {
          setImagePreviews(savedPreviews);
        }
        if (savedCategory) {
          setBagTypeCategory(savedCategory);
        }
      }
    } catch (e) {
      console.error("Failed to load saved form data", e);
    }
    setIsInitialized(true);
  }, []);

  // Save form data to localStorage whenever it changes
  useEffect(() => {
    if (!isInitialized) return;
    try {
      const farmer = form.getValues();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ farmer, lots, imagePreviews, bagTypeCategory }));
    } catch (e) {
      console.error("Failed to save form data", e);
    }
  }, [lots, imagePreviews, isInitialized, bagTypeCategory, form.watch()]);

  // Update all lots when bag type category changes
  useEffect(() => {
    if (!isInitialized) return;
    const newBagType = bagTypeCategory === "wafer" ? "wafer" : "seed";
    setLots(prevLots => prevLots.map(lot => ({
      ...lot,
      bagType: newBagType as "wafer" | "seed" | "Ration",
    })));
  }, [bagTypeCategory, isInitialized]);

  // Save bagTypeCategory preference separately (persists across logout/login)
  useEffect(() => {
    try {
      localStorage.setItem(BAG_TYPE_PREFERENCE_KEY, bagTypeCategory);
    } catch (e) {
      console.error("Failed to save bag type preference", e);
    }
  }, [bagTypeCategory]);

  const clearSavedData = () => {
    localStorage.removeItem(STORAGE_KEY);
  };

  // Get filtered suggestions based on current form values (reactive)
  const getNameSuggestions = useMemo(() => {
    if (!farmerRecords || farmerRecords.length === 0) return [];
    
    const nameVal = watchedFarmerName.toLowerCase().trim();
    const villageVal = watchedVillage.toLowerCase().trim();
    const mobileVal = watchedContactNumber.trim();

    const filtered = farmerRecords.filter(farmer => {
      let matches = true;
      // Filter by name (current field)
      if (nameVal) {
        matches = matches && farmer.farmerName.toLowerCase().includes(nameVal);
      }
      // Also narrow by other fields if they have values
      if (villageVal) {
        matches = matches && farmer.village.toLowerCase().includes(villageVal);
      }
      if (mobileVal) {
        matches = matches && farmer.contactNumber.includes(mobileVal);
      }
      return matches;
    });

    // Deduplicate by name
    const names = new Map<string, FarmerRecord>();
    filtered.forEach(f => {
      const key = f.farmerName.toLowerCase();
      if (!names.has(key)) names.set(key, f);
    });
    return Array.from(names.values());
  }, [farmerRecords, watchedFarmerName, watchedVillage, watchedContactNumber]);

  const getVillageSuggestions = useMemo(() => {
    if (!farmerRecords || farmerRecords.length === 0) return [];
    
    const nameVal = watchedFarmerName.toLowerCase().trim();
    const villageVal = watchedVillage.toLowerCase().trim();
    const mobileVal = watchedContactNumber.trim();

    const filtered = farmerRecords.filter(farmer => {
      let matches = true;
      // Filter by village (current field)
      if (villageVal) {
        matches = matches && farmer.village.toLowerCase().includes(villageVal);
      }
      // Also narrow by other fields if they have values
      if (nameVal) {
        matches = matches && farmer.farmerName.toLowerCase().includes(nameVal);
      }
      if (mobileVal) {
        matches = matches && farmer.contactNumber.includes(mobileVal);
      }
      return matches;
    });

    // Deduplicate by village
    const villages = new Map<string, FarmerRecord>();
    filtered.forEach(f => {
      const key = f.village.toLowerCase();
      if (!villages.has(key)) villages.set(key, f);
    });
    return Array.from(villages.values());
  }, [farmerRecords, watchedFarmerName, watchedVillage, watchedContactNumber]);

  // Get unique village suggestions from all lots (location-only, no farmer data)
  const getLocationVillageSuggestions = useMemo(() => {
    if (!locationData?.villages || locationData.villages.length === 0) return [];
    const villageVal = watchedVillage.toLowerCase().trim();
    if (!villageVal) return locationData.villages.slice(0, 10);
    return locationData.villages.filter(v => 
      v.toLowerCase().includes(villageVal)
    ).slice(0, 10);
  }, [locationData, watchedVillage]);

  // Get unique tehsil suggestions from all lots
  const getTehsilSuggestions = useMemo(() => {
    if (!locationData?.tehsils || locationData.tehsils.length === 0) return [];
    const tehsilVal = watchedTehsil.toLowerCase().trim();
    if (!tehsilVal) return locationData.tehsils.slice(0, 10);
    return locationData.tehsils.filter(t => 
      t.toLowerCase().includes(tehsilVal)
    ).slice(0, 10);
  }, [locationData, watchedTehsil]);

  const getMobileSuggestions = useMemo(() => {
    if (!farmerRecords || farmerRecords.length === 0) return [];
    
    const nameVal = watchedFarmerName.toLowerCase().trim();
    const villageVal = watchedVillage.toLowerCase().trim();
    const mobileVal = watchedContactNumber.trim();

    const filtered = farmerRecords.filter(farmer => {
      let matches = true;
      // Filter by mobile (current field)
      if (mobileVal) {
        matches = matches && farmer.contactNumber.includes(mobileVal);
      }
      // Also narrow by other fields if they have values
      if (nameVal) {
        matches = matches && farmer.farmerName.toLowerCase().includes(nameVal);
      }
      if (villageVal) {
        matches = matches && farmer.village.toLowerCase().includes(villageVal);
      }
      return matches;
    });

    // Deduplicate by mobile
    const mobiles = new Map<string, FarmerRecord>();
    filtered.forEach(f => {
      if (!mobiles.has(f.contactNumber)) mobiles.set(f.contactNumber, f);
    });
    return Array.from(mobiles.values());
  }, [farmerRecords, watchedFarmerName, watchedVillage, watchedContactNumber]);

  // Auto-fill all fields from a selected farmer record
  const selectFarmerRecord = (farmer: FarmerRecord) => {
    form.setValue("farmerName", farmer.farmerName);
    form.setValue("village", farmer.village);
    form.setValue("tehsil", farmer.tehsil);
    form.setValue("district", farmer.district);
    form.setValue("state", farmer.state);
    form.setValue("contactNumber", farmer.contactNumber);
    setShowNameSuggestions(false);
    setShowVillageSuggestions(false);
    setShowMobileSuggestions(false);
    
    // Highlight all auto-filled fields
    const filledFields = new Set(["farmerName", "village", "tehsil", "district", "state", "contactNumber"]);
    setAutoFilledFields(filledFields);
    
    // Clear highlight after 3 seconds
    setTimeout(() => {
      setAutoFilledFields(new Set());
    }, 3000);
  };

  // Check for exact mobile match and auto-fill
  const checkExactMobileMatch = (mobile: string) => {
    if (!farmerRecords || mobile.length !== 10) return;
    const exactMatches = farmerRecords.filter(f => f.contactNumber === mobile);
    if (exactMatches.length === 1) {
      selectFarmerRecord(exactMatches[0]);
    }
  };

  const createBatchLotsMutation = useMutation({
    mutationFn: async (data: { farmer: FarmerData; lots: LotData[]; bagTypeCategory: "wafer" | "rationSeed" }) => {
      const response = await apiRequest("POST", "/api/lots/batch", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lots"] });
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("/api/dashboard/stats") });
      queryClient.invalidateQueries({ queryKey: ["/api/next-entry-sequence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/merchants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/quality"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/chambers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/farmers/lookup"] });
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
      if (field === "chamberId") {
        updated[index].floor = 0;
      }
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
    const newBagType = bagTypeCategory === "wafer" ? "wafer" : "seed";
    setLots(prev => [...prev, { ...defaultLotData, bagType: newBagType as "wafer" | "seed" | "Ration" }]);
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
      if (lot.size < 1) {
        toast({ title: t("error"), description: `Lot ${i + 1}: Size must be at least 1`, variant: "destructive" });
        return false;
      }
      if (!lot.type) {
        toast({ title: t("error"), description: `Lot ${i + 1}: Type is required`, variant: "destructive" });
        return false;
      }
    }
    return true;
  };

  const onSubmit = async (farmerData: FarmerData) => {
    if (!validateLots()) return;

    setIsSubmitting(true);
    try {
      const result = await createBatchLotsMutation.mutateAsync({ farmer: farmerData, lots, bagTypeCategory });
      
      toast({
        title: t("success"),
        description: `${lots.length} lot(s) created successfully with Lot # ${result.entrySequence}`,
        variant: "success",
      });
      
      clearSavedData();
      
      // Reset form state
      form.reset({
        farmerName: "",
        village: "",
        tehsil: "",
        district: "",
        state: "",
        contactNumber: "",
      });
      setLots([{ ...defaultLotData }]);
      setImagePreviews({});
      
      // Scroll to top of page
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      // Error handled by mutation onError
    } finally {
      setIsSubmitting(false);
    }
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
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-4 flex-1">
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
        <div className="flex items-center gap-2 pl-12 sm:pl-0">
          <span className="text-sm font-medium text-muted-foreground">{t("bagType")}:</span>
          <div className="flex rounded-lg bg-muted p-1" data-testid="toggle-bag-category">
            <button
              type="button"
              onClick={() => setBagTypeCategory("wafer")}
              className={cn(
                "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
                bagTypeCategory === "wafer"
                  ? "bg-chart-1 text-white"
                  : "text-muted-foreground hover:text-foreground"
              )}
              data-testid="toggle-wafer"
            >
              {t("wafer")}
            </button>
            <button
              type="button"
              onClick={() => setBagTypeCategory("rationSeed")}
              className={cn(
                "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
                bagTypeCategory === "rationSeed"
                  ? "bg-chart-1 text-white"
                  : "text-muted-foreground hover:text-foreground"
              )}
              data-testid="toggle-ration-seed"
            >
              {t("Ration")}/{t("seed")}
            </button>
          </div>
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
                  <FormItem className="relative">
                    <FormLabel>{t("farmerName")} *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        onChange={(e) => {
                          field.onChange(capitalizeFirstLetter(e.target.value));
                          setShowNameSuggestions(true);
                        }}
                        onFocus={() => setShowNameSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowNameSuggestions(false), 200)}
                        placeholder="Enter farmer name"
                        autoComplete="off"
                        className={autoFilledFields.has("farmerName") ? "ring-2 ring-green-500 bg-green-50 dark:bg-green-950/30 transition-all duration-300" : ""}
                        data-testid="input-farmer-name"
                      />
                    </FormControl>
                    {showNameSuggestions && getNameSuggestions.length > 0 && field.value && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                        {getNameSuggestions.slice(0, 8).map((farmer, idx) => (
                          <button
                            key={idx}
                            type="button"
                            className="w-full px-3 py-2 text-left hover-elevate text-sm flex flex-col"
                            onClick={() => selectFarmerRecord(farmer)}
                            data-testid={`suggestion-name-${idx}`}
                          >
                            <span className="font-medium">{farmer.farmerName}</span>
                            <span className="text-xs text-muted-foreground">{farmer.village} • {farmer.contactNumber}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactNumber"
                render={({ field }) => (
                  <FormItem className="relative">
                    <FormLabel>{t("contactNumber")} *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, "");
                          field.onChange(val);
                          setShowMobileSuggestions(true);
                          if (val.length === 10) {
                            checkExactMobileMatch(val);
                          }
                        }}
                        onFocus={() => setShowMobileSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowMobileSuggestions(false), 200)}
                        placeholder="Enter 10-digit number"
                        maxLength={10}
                        autoComplete="off"
                        className={autoFilledFields.has("contactNumber") ? "ring-2 ring-green-500 bg-green-50 dark:bg-green-950/30 transition-all duration-300" : ""}
                        data-testid="input-contact"
                      />
                    </FormControl>
                    {showMobileSuggestions && getMobileSuggestions.length > 0 && field.value && field.value.length < 10 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                        {getMobileSuggestions.slice(0, 8).map((farmer, idx) => (
                          <button
                            key={idx}
                            type="button"
                            className="w-full px-3 py-2 text-left hover-elevate text-sm flex flex-col"
                            onClick={() => selectFarmerRecord(farmer)}
                            data-testid={`suggestion-mobile-${idx}`}
                          >
                            <span className="font-medium">{farmer.contactNumber}</span>
                            <span className="text-xs text-muted-foreground">{farmer.farmerName} • {farmer.village}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="village"
                render={({ field }) => (
                  <FormItem className="relative">
                    <FormLabel>{t("village")} *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        onChange={(e) => {
                          field.onChange(capitalizeFirstLetter(e.target.value));
                          setShowVillageSuggestions(true);
                        }}
                        onFocus={() => setShowVillageSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowVillageSuggestions(false), 200)}
                        placeholder="Enter village"
                        autoComplete="off"
                        className={autoFilledFields.has("village") ? "ring-2 ring-green-500 bg-green-50 dark:bg-green-950/30 transition-all duration-300" : ""}
                        data-testid="input-village"
                      />
                    </FormControl>
                    {showVillageSuggestions && (getVillageSuggestions.length > 0 || getLocationVillageSuggestions.length > 0) && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                        {getVillageSuggestions.length > 0 && (
                          <>
                            {getVillageSuggestions.slice(0, 5).map((farmer, idx) => (
                              <button
                                key={`farmer-${idx}`}
                                type="button"
                                className="w-full px-3 py-2 text-left hover-elevate text-sm flex flex-col"
                                onClick={() => selectFarmerRecord(farmer)}
                                data-testid={`suggestion-village-farmer-${idx}`}
                              >
                                <span className="font-medium">{farmer.village}</span>
                                <span className="text-xs text-muted-foreground">{farmer.farmerName} • {farmer.contactNumber}</span>
                              </button>
                            ))}
                          </>
                        )}
                        {getLocationVillageSuggestions.filter(v => 
                          !getVillageSuggestions.some(f => f.village.toLowerCase() === v.toLowerCase())
                        ).slice(0, 5).map((village, idx) => (
                          <button
                            key={`loc-${idx}`}
                            type="button"
                            className="w-full px-3 py-2 text-left hover-elevate text-sm"
                            onClick={() => {
                              field.onChange(village);
                              setShowVillageSuggestions(false);
                            }}
                            data-testid={`suggestion-village-loc-${idx}`}
                          >
                            <span className="font-medium">{village}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="tehsil"
                render={({ field }) => (
                  <FormItem className="relative">
                    <FormLabel>{t("tehsil")} *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        onChange={(e) => {
                          field.onChange(capitalizeFirstLetter(e.target.value));
                          setShowTehsilSuggestions(true);
                        }}
                        onFocus={() => setShowTehsilSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowTehsilSuggestions(false), 200)}
                        placeholder="Enter tehsil"
                        autoComplete="off"
                        className={autoFilledFields.has("tehsil") ? "ring-2 ring-green-500 bg-green-50 dark:bg-green-950/30 transition-all duration-300" : ""}
                        data-testid="input-tehsil"
                      />
                    </FormControl>
                    {showTehsilSuggestions && getTehsilSuggestions.length > 0 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                        {getTehsilSuggestions.map((tehsil, idx) => (
                          <button
                            key={idx}
                            type="button"
                            className="w-full px-3 py-2 text-left hover-elevate text-sm"
                            onClick={() => {
                              field.onChange(tehsil);
                              setShowTehsilSuggestions(false);
                            }}
                            data-testid={`suggestion-tehsil-${idx}`}
                          >
                            <span className="font-medium">{tehsil}</span>
                          </button>
                        ))}
                      </div>
                    )}
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
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger 
                          className={autoFilledFields.has("district") ? "ring-2 ring-green-500 bg-green-50 dark:bg-green-950/30 transition-all duration-300" : ""}
                          data-testid="select-district"
                        >
                          <SelectValue placeholder="Select district" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Ujjain">Ujjain</SelectItem>
                        <SelectItem value="Agar Malwa">Agar Malwa</SelectItem>
                        <SelectItem value="Dewas">Dewas</SelectItem>
                        <SelectItem value="Indore">Indore</SelectItem>
                        <SelectItem value="Shajapur">Shajapur</SelectItem>
                        <SelectItem value="Rajgarh">Rajgarh</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
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
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger 
                          className={autoFilledFields.has("state") ? "ring-2 ring-green-500 bg-green-50 dark:bg-green-950/30 transition-all duration-300" : ""}
                          data-testid="select-state"
                        >
                          <SelectValue placeholder="Select state" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Madhya Pradesh">Madhya Pradesh</SelectItem>
                        <SelectItem value="Gujarat">Gujarat</SelectItem>
                        <SelectItem value="Uttar Pradesh">Uttar Pradesh</SelectItem>
                      </SelectContent>
                    </Select>
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
                <div className={`grid grid-cols-1 gap-4 ${coldStorage?.chargeUnit === "quintal" ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                  <div>
                    <label className="text-sm font-medium">{t("lotNo")}</label>
                    <div className="h-9 px-3 py-2 border rounded-md bg-muted flex items-center text-muted-foreground">
                      {nextSequenceData?.nextSequence ?? "..."} (Auto-assigned)
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium">{t("size")} *</label>
                    <Input
                      type="number"
                      min={0}
                      value={lot.size === 0 ? "" : lot.size}
                      onChange={(e) => updateLot(index, "size", e.target.value === "" ? 0 : parseInt(e.target.value))}
                      data-testid={`input-size-${index}`}
                    />
                  </div>
                  {coldStorage?.chargeUnit === "quintal" && (
                    <div>
                      <label className="text-sm font-medium">{t("netWeightQtl")}</label>
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        placeholder="0.00"
                        value={lot.netWeight === undefined || lot.netWeight === 0 ? "" : lot.netWeight}
                        onChange={(e) => updateLot(index, "netWeight", e.target.value === "" ? undefined : parseFloat(e.target.value))}
                        data-testid={`input-net-weight-${index}`}
                      />
                      {lot.netWeight && lot.netWeight > 0 && lot.size > 0 && (
                        <p className="text-xs font-medium text-orange-600 dark:text-orange-400 mt-1" data-testid={`avg-weight-${index}`}>
                          {t("avgWeight") || "Avg Weight"}: {(lot.netWeight / lot.size).toFixed(2)} {t("qtlPerBag") || "qtl/bag"}
                        </p>
                      )}
                    </div>
                  )}
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
                    {bagTypeCategory === "wafer" ? (
                      <div className="h-9 px-3 py-2 border rounded-md bg-muted flex items-center" data-testid={`display-bag-type-${index}`}>
                        {t("wafer")}
                      </div>
                    ) : (
                      <Select value={lot.bagType} onValueChange={(v) => updateLot(index, "bagType", v as "wafer" | "seed" | "Ration")}>
                        <SelectTrigger data-testid={`select-bag-type-${index}`}>
                          <SelectValue placeholder="Select bag type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="seed">{t("seed")}</SelectItem>
                          <SelectItem value="Ration">{t("ration") || "Ration"}</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <div className="relative">
                    <label className="text-sm font-medium">{t("bagTypeLabel") || "Bag type"}</label>
                    <Input
                      value={lot.bagTypeLabel}
                      onChange={(e) => updateLot(index, "bagTypeLabel", e.target.value)}
                      onFocus={() => setShowBagTypeLabelSuggestions(prev => ({ ...prev, [index]: true }))}
                      onBlur={() => setTimeout(() => setShowBagTypeLabelSuggestions(prev => ({ ...prev, [index]: false })), 200)}
                      placeholder={t("enterBagType") || "e.g., 50kg, Jute"}
                      data-testid={`input-bag-type-label-${index}`}
                    />
                    {showBagTypeLabelSuggestions[index] && bagTypeLabels && bagTypeLabels.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-40 overflow-y-auto">
                        {bagTypeLabels
                          .filter(b => !lot.bagTypeLabel || b.label.toLowerCase().includes(lot.bagTypeLabel.toLowerCase()))
                          .slice(0, 8)
                          .map((b, i) => (
                            <div
                              key={i}
                              className="px-3 py-2 hover-elevate cursor-pointer text-sm"
                              onMouseDown={() => updateLot(index, "bagTypeLabel", b.label)}
                            >
                              {b.label}
                            </div>
                          ))}
                      </div>
                    )}
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
                    <label className="text-sm font-medium">{t("chamber")}</label>
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
                    <label className="text-sm font-medium">{t("floor")}</label>
                    <Select 
                      value={lot.floor ? lot.floor.toString() : ""} 
                      onValueChange={(v) => updateLot(index, "floor", parseInt(v))}
                      disabled={!lot.chamberId}
                    >
                      <SelectTrigger data-testid={`select-floor-${index}`}>
                        <SelectValue placeholder={lot.chamberId ? t("selectFloor") : t("selectChamberFirst")} />
                      </SelectTrigger>
                      <SelectContent>
                        {lot.chamberId && chamberFloors?.[lot.chamberId]?.map((floor) => (
                          <SelectItem key={floor.id} value={floor.floorNumber.toString()}>
                            {t("floor")} {floor.floorNumber}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">{t("position")}</label>
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
                    <label className="text-sm font-medium">{t("quality")}</label>
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
              onClick={() => {
                clearSavedData();
                // Reset form state
                form.reset({
                  farmerName: "",
                  village: "",
                  tehsil: "",
                  district: "",
                  state: "",
                  contactNumber: "",
                });
                setLots([{ ...defaultLotData }]);
                setImagePreviews({});
                // Scroll to top of page
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              data-testid="button-cancel"
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !canEdit}
              data-testid="button-save"
            >
              {isSubmitting ? t("loading") : t("save")}
            </Button>
            {!canEdit && (
              <p className="text-xs text-muted-foreground text-center col-span-full">
                {t("viewOnlyAccess") || "You have view-only access. Contact admin for edit permissions."}
              </p>
            )}
          </div>
        </form>
      </Form>
    </div>
  );
}
