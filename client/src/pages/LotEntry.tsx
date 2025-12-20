import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowLeft, Upload, User, MapPin, Package, Layers, ClipboardCheck } from "lucide-react";
import { lotFormSchema, type LotFormData, type Chamber } from "@shared/schema";

export default function LotEntry() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const { data: chambers, isLoading: chambersLoading } = useQuery<Chamber[]>({
    queryKey: ["/api/chambers"],
  });

  const form = useForm<LotFormData>({
    resolver: zodResolver(lotFormSchema),
    defaultValues: {
      farmerName: "",
      village: "",
      tehsil: "",
      district: "",
      contactNumber: "",
      lotNo: "",
      size: 1,
      chamberId: "",
      floor: 1,
      position: 0,
      type: "",
      bagType: "wafer",
      quality: "medium",
      assayingType: "Visual",
      assayerImage: "",
      reducingSugar: undefined,
      dm: undefined,
      remarks: "",
    },
  });

  const assayingType = form.watch("assayingType");

  const createLotMutation = useMutation({
    mutationFn: async (data: LotFormData) => {
      return apiRequest("POST", "/api/lots", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: t("success"),
        description: "Lot created successfully",
      });
      navigate("/");
    },
    onError: (error: Error) => {
      toast({
        title: t("error"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setImagePreview(base64);
        form.setValue("assayerImage", base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const onSubmit = (data: LotFormData) => {
    createLotMutation.mutate(data);
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
            Enter details for the incoming lot
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
                  <FormItem className="sm:col-span-2">
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
            </div>
          </Card>

          <Card className="p-4 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
              <Package className="h-5 w-5 text-chart-2" />
              <h2 className="text-lg font-semibold">{t("lotInformation")}</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="lotNo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("lotNo")} *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Enter lot number"
                        data-testid="input-lot-no"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="size"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("size")} *</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                        data-testid="input-size"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("type")} *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-type">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Jyoti">Jyoti</SelectItem>
                        <SelectItem value="SC3">SC3</SelectItem>
                        <SelectItem value="Pukhraj">Pukhraj</SelectItem>
                        <SelectItem value="Chipsona">Chipsona</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="bagType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("bagType")} *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-bag-type">
                          <SelectValue placeholder="Select bag type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="wafer">{t("wafer")}</SelectItem>
                        <SelectItem value="seed">{t("seed")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </Card>

          <Card className="p-4 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
              <Layers className="h-5 w-5 text-chart-3" />
              <h2 className="text-lg font-semibold">{t("storageLocation")}</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="chamberId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("chamber")} *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-chamber">
                          <SelectValue placeholder="Select chamber" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {chambers?.map((chamber) => (
                          <SelectItem key={chamber.id} value={chamber.id}>
                            {chamber.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="floor"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("floor")} *</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                        data-testid="input-floor"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="position"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("position")} *</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        placeholder="e.g. 1.5"
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                        data-testid="input-position"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </Card>

          <Card className="p-4 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
              <ClipboardCheck className="h-5 w-5 text-chart-4" />
              <h2 className="text-lg font-semibold">{t("qualityAssessment")}</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="quality"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("quality")} *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-quality">
                          <SelectValue placeholder="Select quality" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="poor">{t("poor")}</SelectItem>
                        <SelectItem value="medium">{t("medium")}</SelectItem>
                        <SelectItem value="good">{t("good")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="assayingType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("assayingType")} *</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        value={field.value}
                        className="flex gap-4 pt-2"
                      >
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="Quality Check" id="quality-check" data-testid="radio-quality-check" />
                          <label htmlFor="quality-check" className="text-sm">
                            {t("qualityCheck")}
                          </label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="Visual" id="visual" data-testid="radio-visual" />
                          <label htmlFor="visual" className="text-sm">
                            {t("visual")}
                          </label>
                        </div>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {assayingType === "Quality Check" && (
                <>
                  <div className="sm:col-span-2">
                    <FormField
                      control={form.control}
                      name="assayerImage"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("assayerImage")}</FormLabel>
                          <FormControl>
                            <div className="flex flex-col gap-4">
                              <div className="flex items-center gap-4">
                                <label
                                  htmlFor="image-upload"
                                  className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-md cursor-pointer hover-elevate"
                                >
                                  <Upload className="h-4 w-4" />
                                  Upload Image
                                </label>
                                <input
                                  id="image-upload"
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={handleImageUpload}
                                  data-testid="input-image"
                                />
                              </div>
                              {imagePreview && (
                                <img
                                  src={imagePreview}
                                  alt="Preview"
                                  className="w-32 h-32 object-cover rounded-lg border"
                                />
                              )}
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="reducingSugar"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("reducingSugar")}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            {...field}
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value ? parseFloat(e.target.value) : undefined
                              )
                            }
                            data-testid="input-reducing-sugar"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="dm"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("dm")}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            {...field}
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value ? parseFloat(e.target.value) : undefined
                              )
                            }
                            data-testid="input-dm"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              <FormField
                control={form.control}
                name="remarks"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>{t("remarks")}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Any additional remarks..."
                        rows={3}
                        data-testid="input-remarks"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </Card>

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-4 pt-4">
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
              {createLotMutation.isPending ? t("loading") : t("submit")}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
