import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import { Search, X, CheckCircle, Filter } from "lucide-react";
import type { SalesHistory } from "@shared/schema";

export default function SalesHistoryPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  
  const [yearFilter, setYearFilter] = useState<string>("");
  const [farmerFilter, setFarmerFilter] = useState("");
  const [mobileFilter, setMobileFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<string>("");

  const { data: years = [], isLoading: yearsLoading } = useQuery<number[]>({
    queryKey: ["/api/sales-history/years"],
  });

  const buildQueryString = () => {
    const params = new URLSearchParams();
    if (yearFilter) params.append("year", yearFilter);
    if (farmerFilter) params.append("farmerName", farmerFilter);
    if (mobileFilter) params.append("contactNumber", mobileFilter);
    if (paymentFilter) params.append("paymentStatus", paymentFilter);
    return params.toString();
  };

  const { data: salesHistory = [], isLoading: historyLoading, refetch } = useQuery<SalesHistory[]>({
    queryKey: ["/api/sales-history", yearFilter, farmerFilter, mobileFilter, paymentFilter],
    queryFn: async () => {
      const queryString = buildQueryString();
      const response = await fetch(`/api/sales-history${queryString ? `?${queryString}` : ""}`);
      if (!response.ok) throw new Error("Failed to fetch sales history");
      return response.json();
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: async (saleId: string) => {
      const response = await fetch(`/api/sales-history/${saleId}/mark-paid`, { method: "PATCH" });
      if (!response.ok) throw new Error("Failed to mark as paid");
      return response.json();
    },
    onSuccess: () => {
      toast({ title: t("success"), description: t("markAsPaid") });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
    },
    onError: () => {
      toast({ title: t("error"), description: "Failed to update payment status", variant: "destructive" });
    },
  });

  const clearFilters = () => {
    setYearFilter("");
    setFarmerFilter("");
    setMobileFilter("");
    setPaymentFilter("");
  };

  const hasActiveFilters = yearFilter || farmerFilter || mobileFilter || paymentFilter;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold" data-testid="text-page-title">{t("salesHistory")}</h1>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            {t("filters")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">{t("filterByYear")}</label>
              <Select value={yearFilter} onValueChange={setYearFilter}>
                <SelectTrigger data-testid="select-year-filter">
                  <SelectValue placeholder={t("allYears")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allYears")}</SelectItem>
                  {years.map((year) => (
                    <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">{t("filterByFarmer")}</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={farmerFilter}
                  onChange={(e) => setFarmerFilter(e.target.value)}
                  placeholder={t("farmerName")}
                  className="pl-10"
                  data-testid="input-farmer-filter"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">{t("filterByMobile")}</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={mobileFilter}
                  onChange={(e) => setMobileFilter(e.target.value)}
                  placeholder={t("contactNumber")}
                  className="pl-10"
                  data-testid="input-mobile-filter"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">{t("filterByPayment")}</label>
              <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                <SelectTrigger data-testid="select-payment-filter">
                  <SelectValue placeholder={t("all")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("all")}</SelectItem>
                  <SelectItem value="paid">{t("paid")}</SelectItem>
                  <SelectItem value="due">{t("due")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              {hasActiveFilters && (
                <Button variant="outline" onClick={clearFilters} className="w-full" data-testid="button-clear-filters">
                  <X className="h-4 w-4 mr-2" />
                  {t("clearFilters")}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {historyLoading ? (
            <div className="p-6 space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : salesHistory.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground" data-testid="text-no-results">
              {t("noSalesHistory")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("saleDate")}</TableHead>
                    <TableHead>{t("farmerName")}</TableHead>
                    <TableHead>{t("contactNumber")}</TableHead>
                    <TableHead>{t("lotNo")}</TableHead>
                    <TableHead>{t("chamber")}</TableHead>
                    <TableHead>{t("potatoType")}</TableHead>
                    <TableHead>{t("bagType")}</TableHead>
                    <TableHead>{t("saleType")}</TableHead>
                    <TableHead className="text-right">{t("quantitySold")}</TableHead>
                    <TableHead className="text-right">{t("coldStorageCharge")}</TableHead>
                    <TableHead>{t("buyerName")}</TableHead>
                    <TableHead className="text-right">{t("pricePerKg")}</TableHead>
                    <TableHead>{t("paymentStatus")}</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salesHistory.map((sale) => (
                    <TableRow key={sale.id} data-testid={`row-sale-${sale.id}`}>
                      <TableCell className="whitespace-nowrap">
                        {format(new Date(sale.soldAt), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell className="font-medium">{sale.farmerName}</TableCell>
                      <TableCell>{sale.contactNumber}</TableCell>
                      <TableCell>{sale.lotNo}</TableCell>
                      <TableCell>{sale.chamberName}</TableCell>
                      <TableCell>{sale.potatoType}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {t(sale.bagType)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={sale.saleType === "full" ? "default" : "secondary"}>
                          {sale.saleType === "full" ? t("fullSale") : t("partialSale")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{sale.quantitySold}</TableCell>
                      <TableCell className="text-right font-medium">
                        Rs. {sale.coldStorageCharge?.toLocaleString()}
                      </TableCell>
                      <TableCell>{sale.buyerName || "-"}</TableCell>
                      <TableCell className="text-right">
                        {sale.pricePerKg ? `Rs. ${sale.pricePerKg}/kg` : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={sale.paymentStatus === "paid" ? "default" : "destructive"}
                          className={sale.paymentStatus === "paid" ? "bg-green-600" : ""}
                        >
                          {t(sale.paymentStatus)}
                        </Badge>
                        {sale.paidAt && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {t("paidOn")}: {format(new Date(sale.paidAt), "dd/MM/yy")}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {sale.paymentStatus === "due" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => markPaidMutation.mutate(sale.id)}
                            disabled={markPaidMutation.isPending}
                            data-testid={`button-mark-paid-${sale.id}`}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            {t("markAsPaid")}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {salesHistory.length > 0 && (
        <div className="flex justify-between items-center text-sm text-muted-foreground">
          <span>
            {salesHistory.length} {salesHistory.length === 1 ? "sale" : "sales"} found
          </span>
          <div className="flex gap-4">
            <span className="text-green-600">
              {t("paid")}: {salesHistory.filter(s => s.paymentStatus === "paid").length}
            </span>
            <span className="text-amber-600">
              {t("due")}: {salesHistory.filter(s => s.paymentStatus === "due").length}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
