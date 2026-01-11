import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Banknote, CreditCard, Calendar, Save } from "lucide-react";
import { format } from "date-fns";
import type { CashReceipt } from "@shared/schema";

interface BuyerWithDue {
  buyerName: string;
  totalDue: number;
}

export default function CashManagement() {
  const { t } = useI18n();
  const { toast } = useToast();
  
  const [buyerName, setBuyerName] = useState("");
  const [receiptType, setReceiptType] = useState<"cash" | "account">("cash");
  const [amount, setAmount] = useState("");
  const [receivedDate, setReceivedDate] = useState(format(new Date(), "yyyy-MM-dd"));

  const { data: buyersWithDues = [], isLoading: loadingBuyers } = useQuery<BuyerWithDue[]>({
    queryKey: ["/api/cash-receipts/buyers-with-dues"],
  });

  const { data: receipts = [], isLoading: loadingReceipts } = useQuery<CashReceipt[]>({
    queryKey: ["/api/cash-receipts"],
  });

  const createReceiptMutation = useMutation({
    mutationFn: async (data: { buyerName: string; receiptType: string; amount: number; receivedAt: string }) => {
      const response = await apiRequest("POST", "/api/cash-receipts", data);
      return response.json();
    },
    onSuccess: (result: { receipt: CashReceipt; salesUpdated: number }) => {
      toast({
        title: t("success"),
        description: `${t("paymentRecorded")} - ${result.salesUpdated} ${t("salesAdjusted")}`,
      });
      setBuyerName("");
      setAmount("");
      setReceivedDate(format(new Date(), "yyyy-MM-dd"));
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-receipts/buyers-with-dues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-history"] });
    },
    onError: () => {
      toast({ title: t("error"), description: "Failed to record payment", variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!buyerName || !amount || parseFloat(amount) <= 0) {
      toast({ title: t("error"), description: "Please fill all required fields", variant: "destructive" });
      return;
    }

    createReceiptMutation.mutate({
      buyerName,
      receiptType,
      amount: parseFloat(amount),
      receivedAt: new Date(receivedDate).toISOString(),
    });
  };

  const selectedBuyerDue = buyersWithDues.find(b => b.buyerName === buyerName)?.totalDue || 0;

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Banknote className="h-6 w-6" />
        {t("cashManagement")}
      </h1>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("inwardCash")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t("receiptType")} *</Label>
              <Select value={receiptType} onValueChange={(v) => setReceiptType(v as "cash" | "account")}>
                <SelectTrigger data-testid="select-receipt-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">
                    <span className="flex items-center gap-2">
                      <Banknote className="h-4 w-4" />
                      {t("cashReceived")}
                    </span>
                  </SelectItem>
                  <SelectItem value="account">
                    <span className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4" />
                      {t("accountReceived")}
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t("buyerName")} *</Label>
              {loadingBuyers ? (
                <div className="text-sm text-muted-foreground">{t("loading")}</div>
              ) : buyersWithDues.length === 0 ? (
                <div className="text-sm text-muted-foreground">{t("noBuyersWithDues")}</div>
              ) : (
                <Select value={buyerName} onValueChange={setBuyerName}>
                  <SelectTrigger data-testid="select-buyer">
                    <SelectValue placeholder={t("selectBuyer")} />
                  </SelectTrigger>
                  <SelectContent>
                    {buyersWithDues.map((buyer) => (
                      <SelectItem key={buyer.buyerName} value={buyer.buyerName}>
                        <span className="flex items-center justify-between gap-4 w-full">
                          <span>{buyer.buyerName}</span>
                          <Badge variant="outline" className="text-xs">
                            ₹{buyer.totalDue.toLocaleString()}
                          </Badge>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {buyerName && selectedBuyerDue > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("totalDue")}: ₹{selectedBuyerDue.toLocaleString()}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t("amount")} (₹) *</Label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                min={1}
                data-testid="input-amount"
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {t("receivedOn")}
              </Label>
              <Input
                type="date"
                value={receivedDate}
                onChange={(e) => setReceivedDate(e.target.value)}
                data-testid="input-received-date"
              />
            </div>

            <Button
              onClick={handleSubmit}
              disabled={!buyerName || !amount || createReceiptMutation.isPending}
              className="w-full"
              data-testid="button-record-payment"
            >
              <Save className="h-4 w-4 mr-2" />
              {createReceiptMutation.isPending ? t("saving") : t("recordPayment")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("recentReceipts")}</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingReceipts ? (
              <div className="text-sm text-muted-foreground">{t("loading")}</div>
            ) : receipts.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">{t("noReceipts")}</div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-3">
                  {receipts.map((receipt) => (
                    <div
                      key={receipt.id}
                      className="p-3 bg-muted/50 rounded-lg space-y-2"
                      data-testid={`receipt-${receipt.id}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{receipt.buyerName}</span>
                        <Badge variant={receipt.receiptType === "cash" ? "default" : "secondary"}>
                          {receipt.receiptType === "cash" ? t("cash") : t("account")}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          {format(new Date(receipt.receivedAt), "dd/MM/yyyy")}
                        </span>
                        <span className="font-semibold text-primary">₹{receipt.amount.toLocaleString()}</span>
                      </div>
                      <div className="flex gap-2 text-xs">
                        <span className="text-green-600">
                          {t("appliedAmount")}: ₹{(receipt.appliedAmount || 0).toLocaleString()}
                        </span>
                        {(receipt.unappliedAmount || 0) > 0 && (
                          <span className="text-amber-600">
                            {t("unappliedAmount")}: ₹{receipt.unappliedAmount.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
