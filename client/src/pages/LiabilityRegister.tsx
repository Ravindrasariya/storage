import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, authFetch } from "@/lib/queryClient";
import { formatCurrency } from "@/components/Currency";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Landmark, Plus, Pencil, CreditCard, CheckCircle2, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { format } from "date-fns";
import type { Liability, LiabilityPayment } from "@shared/schema";

const LIABILITY_TYPES = [
  { value: "bank_loan", labelKey: "bankLoan" },
  { value: "equipment_loan", labelKey: "equipmentLoan" },
  { value: "credit_line", labelKey: "creditLine" },
  { value: "outstanding_payable", labelKey: "outstandingPayable" },
  { value: "other", labelKey: "others" },
];

function getLiabilityTypeLabel(type: string, t: (key: string) => string): string {
  const found = LIABILITY_TYPES.find(lt => lt.value === type);
  return found ? t(found.labelKey) : type;
}

export default function LiabilityRegister() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { canEdit } = useAuth();

  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [settleDialogOpen, setSettleDialogOpen] = useState(false);
  const [selectedLiability, setSelectedLiability] = useState<Liability | null>(null);
  const [expandedPayments, setExpandedPayments] = useState<Set<string>>(new Set());

  const [formData, setFormData] = useState({
    liabilityName: "",
    liabilityType: "bank_loan",
    partyName: "",
    originalAmount: "",
    outstandingAmount: "",
    interestRate: "0",
    startDate: format(new Date(), "yyyy-MM-dd"),
    dueDate: "",
    emiAmount: "",
    isOpening: 0,
    remarks: "",
  });

  const [paymentData, setPaymentData] = useState({
    amount: "",
    principalComponent: "",
    interestComponent: "",
    paymentMode: "cash",
    paidAt: format(new Date(), "yyyy-MM-dd"),
    remarks: "",
  });

  const { data: liabilities, isLoading } = useQuery<Liability[]>({
    queryKey: ["/api/liabilities"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/liabilities", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/liabilities"] });
      toast({ title: t("saved") });
      setAddDialogOpen(false);
      resetForm();
    },
    onError: () => {
      toast({ title: t("saveFailed"), variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/liabilities/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/liabilities"] });
      toast({ title: t("saved") });
      setEditDialogOpen(false);
      setSelectedLiability(null);
    },
    onError: () => {
      toast({ title: t("saveFailed"), variant: "destructive" });
    },
  });

  const settleMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/liabilities/${id}/settle`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/liabilities"] });
      toast({ title: t("liabilitySettled") });
      setSettleDialogOpen(false);
      setSelectedLiability(null);
    },
    onError: () => {
      toast({ title: t("saveFailed"), variant: "destructive" });
    },
  });

  const paymentMutation = useMutation({
    mutationFn: async ({ liabilityId, data }: { liabilityId: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("POST", `/api/liabilities/${liabilityId}/payments`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/liabilities"] });
      expandedPayments.forEach(id => {
        queryClient.invalidateQueries({ queryKey: ["/api/liabilities", id, "payments"] });
      });
      toast({ title: t("paymentRecorded") });
      setPaymentDialogOpen(false);
      setSelectedLiability(null);
      resetPaymentForm();
    },
    onError: () => {
      toast({ title: t("saveFailed"), variant: "destructive" });
    },
  });

  const reversePaymentMutation = useMutation({
    mutationFn: async (paymentId: string) => {
      const res = await apiRequest("POST", `/api/liability-payments/${paymentId}/reverse`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/liabilities"] });
      expandedPayments.forEach(id => {
        queryClient.invalidateQueries({ queryKey: ["/api/liabilities", id, "payments"] });
      });
      toast({ title: t("entryReversed") });
    },
    onError: () => {
      toast({ title: t("reversalFailed"), variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      liabilityName: "",
      liabilityType: "bank_loan",
      partyName: "",
      originalAmount: "",
      outstandingAmount: "",
      interestRate: "0",
      startDate: format(new Date(), "yyyy-MM-dd"),
      dueDate: "",
      emiAmount: "",
      isOpening: 0,
      remarks: "",
    });
  };

  const resetPaymentForm = () => {
    setPaymentData({
      amount: "",
      principalComponent: "",
      interestComponent: "",
      paymentMode: "cash",
      paidAt: format(new Date(), "yyyy-MM-dd"),
      remarks: "",
    });
  };

  const handleAdd = () => {
    resetForm();
    setAddDialogOpen(true);
  };

  const handleEdit = (liability: Liability) => {
    setSelectedLiability(liability);
    setFormData({
      liabilityName: liability.liabilityName,
      liabilityType: liability.liabilityType,
      partyName: liability.partyName,
      originalAmount: String(liability.originalAmount),
      outstandingAmount: String(liability.outstandingAmount),
      interestRate: String(liability.interestRate ?? 0),
      startDate: liability.startDate ? format(new Date(liability.startDate), "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
      dueDate: liability.dueDate ? format(new Date(liability.dueDate), "yyyy-MM-dd") : "",
      emiAmount: liability.emiAmount ? String(liability.emiAmount) : "",
      isOpening: liability.isOpening,
      remarks: liability.remarks || "",
    });
    setEditDialogOpen(true);
  };

  const handlePayment = (liability: Liability) => {
    setSelectedLiability(liability);
    resetPaymentForm();
    setPaymentDialogOpen(true);
  };

  const handleSettle = (liability: Liability) => {
    setSelectedLiability(liability);
    setSettleDialogOpen(true);
  };

  const togglePaymentHistory = (liabilityId: string) => {
    setExpandedPayments(prev => {
      const next = new Set(prev);
      if (next.has(liabilityId)) {
        next.delete(liabilityId);
      } else {
        next.add(liabilityId);
      }
      return next;
    });
  };

  const handleSubmitAdd = () => {
    const amount = parseFloat(formData.originalAmount);
    if (!formData.liabilityName || !formData.partyName || isNaN(amount) || amount <= 0) {
      toast({ title: t("required"), variant: "destructive" });
      return;
    }
    const outstandingAmt = formData.outstandingAmount ? parseFloat(formData.outstandingAmount) : amount;
    createMutation.mutate({
      liabilityName: formData.liabilityName,
      liabilityType: formData.liabilityType,
      partyName: formData.partyName,
      originalAmount: amount,
      outstandingAmount: outstandingAmt,
      interestRate: parseFloat(formData.interestRate) || 0,
      startDate: new Date(formData.startDate).toISOString(),
      dueDate: formData.dueDate ? new Date(formData.dueDate).toISOString() : null,
      emiAmount: formData.emiAmount ? parseFloat(formData.emiAmount) : null,
      isOpening: formData.isOpening,
      remarks: formData.remarks || null,
    });
  };

  const handleSubmitEdit = () => {
    if (!selectedLiability) return;
    const amount = parseFloat(formData.originalAmount);
    if (!formData.liabilityName || !formData.partyName || isNaN(amount) || amount <= 0) {
      toast({ title: t("required"), variant: "destructive" });
      return;
    }
    updateMutation.mutate({
      id: selectedLiability.id,
      updates: {
        liabilityName: formData.liabilityName,
        liabilityType: formData.liabilityType,
        partyName: formData.partyName,
        originalAmount: amount,
        outstandingAmount: parseFloat(formData.outstandingAmount) || amount,
        interestRate: parseFloat(formData.interestRate) || 0,
        startDate: new Date(formData.startDate).toISOString(),
        dueDate: formData.dueDate ? new Date(formData.dueDate).toISOString() : null,
        emiAmount: formData.emiAmount ? parseFloat(formData.emiAmount) : null,
        remarks: formData.remarks || null,
      },
    });
  };

  const handleSubmitPayment = () => {
    if (!selectedLiability) return;
    const totalAmount = parseFloat(paymentData.amount);
    const principal = parseFloat(paymentData.principalComponent);
    const interest = parseFloat(paymentData.interestComponent);
    if (isNaN(totalAmount) || totalAmount <= 0) {
      toast({ title: t("amountRequired"), variant: "destructive" });
      return;
    }
    if (isNaN(principal) || isNaN(interest)) {
      toast({ title: t("required"), variant: "destructive" });
      return;
    }
    paymentMutation.mutate({
      liabilityId: selectedLiability.id,
      data: {
        amount: totalAmount,
        principalComponent: principal,
        interestComponent: interest,
        paymentMode: paymentData.paymentMode,
        paidAt: new Date(paymentData.paidAt).toISOString(),
        remarks: paymentData.remarks || null,
      },
    });
  };

  const filteredLiabilities = useMemo(() => {
    if (!liabilities) return [];
    return liabilities.filter(l => {
      if (typeFilter !== "all" && l.liabilityType !== typeFilter) return false;
      if (statusFilter === "active" && l.isSettled === 1) return false;
      if (statusFilter === "settled" && l.isSettled !== 1) return false;
      return true;
    });
  }, [liabilities, typeFilter, statusFilter]);

  const summary = useMemo(() => {
    if (!liabilities) return { totalOutstanding: 0, countByType: {} as Record<string, number>, activeCount: 0, settledCount: 0 };
    const active = liabilities.filter(l => l.isSettled !== 1);
    const countByType: Record<string, number> = {};
    let totalOutstanding = 0;
    active.forEach(l => {
      totalOutstanding += l.outstandingAmount ?? 0;
      countByType[l.liabilityType] = (countByType[l.liabilityType] || 0) + 1;
    });
    return {
      totalOutstanding,
      countByType,
      activeCount: active.length,
      settledCount: liabilities.length - active.length,
    };
  }, [liabilities]);

  if (isLoading) {
    return (
      <div className="flex flex-col h-full p-4 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const LiabilityFormFields = () => (
    <div className="space-y-3">
      <div>
        <Label>{t("liabilityName")}</Label>
        <Input
          value={formData.liabilityName}
          onChange={e => setFormData(prev => ({ ...prev, liabilityName: e.target.value }))}
          data-testid="input-liability-name"
        />
      </div>
      <div>
        <Label>{t("liabilityType")}</Label>
        <Select value={formData.liabilityType} onValueChange={v => setFormData(prev => ({ ...prev, liabilityType: v }))}>
          <SelectTrigger data-testid="select-liability-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIABILITY_TYPES.map(lt => (
              <SelectItem key={lt.value} value={lt.value}>{t(lt.labelKey)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>{t("partyName")}</Label>
        <Input
          value={formData.partyName}
          onChange={e => setFormData(prev => ({ ...prev, partyName: e.target.value }))}
          data-testid="input-party-name"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>{t("originalAmount")}</Label>
          <Input
            type="number"
            value={formData.originalAmount}
            onChange={e => setFormData(prev => ({ ...prev, originalAmount: e.target.value }))}
            data-testid="input-original-amount"
          />
        </div>
        <div>
          <Label>{t("outstandingAmount")}</Label>
          <Input
            type="number"
            value={formData.outstandingAmount}
            onChange={e => setFormData(prev => ({ ...prev, outstandingAmount: e.target.value }))}
            data-testid="input-outstanding-amount"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>{t("rateOfInterest")}</Label>
          <Input
            type="number"
            value={formData.interestRate}
            onChange={e => setFormData(prev => ({ ...prev, interestRate: e.target.value }))}
            data-testid="input-interest-rate"
          />
        </div>
        <div>
          <Label>{t("emiAmount")}</Label>
          <Input
            type="number"
            value={formData.emiAmount}
            onChange={e => setFormData(prev => ({ ...prev, emiAmount: e.target.value }))}
            placeholder={t("optional")}
            data-testid="input-emi-amount"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>{t("startDate")}</Label>
          <Input
            type="date"
            value={formData.startDate}
            onChange={e => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
            data-testid="input-start-date"
          />
        </div>
        <div>
          <Label>{t("dueDate")}</Label>
          <Input
            type="date"
            value={formData.dueDate}
            onChange={e => setFormData(prev => ({ ...prev, dueDate: e.target.value }))}
            placeholder={t("optional")}
            data-testid="input-due-date"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          checked={formData.isOpening === 1}
          onCheckedChange={checked => setFormData(prev => ({ ...prev, isOpening: checked ? 1 : 0 }))}
          data-testid="switch-is-opening"
        />
        <Label>{t("isOpeningLiability")}</Label>
      </div>
      <div>
        <Label>{t("remarks")}</Label>
        <Input
          value={formData.remarks}
          onChange={e => setFormData(prev => ({ ...prev, remarks: e.target.value }))}
          data-testid="input-liability-remarks"
        />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Landmark className="w-5 h-5" />
              {t("liabilityRegister")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("trackLiabilities")}</p>
          </div>
          {canEdit && (
            <Button onClick={handleAdd} data-testid="button-add-liability">
              <Plus className="w-4 h-4 mr-1" />
              {t("addLiability")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-4 py-2">
        <Card className="py-1">
          <CardHeader className="py-1 px-3">
            <CardTitle className="text-xs font-medium text-muted-foreground">{t("totalOutstanding")}</CardTitle>
          </CardHeader>
          <CardContent className="py-1 px-3">
            <div className="text-base font-bold text-red-600 dark:text-red-500" data-testid="text-total-outstanding">
              {formatCurrency(summary.totalOutstanding)}
            </div>
          </CardContent>
        </Card>
        <Card className="py-1">
          <CardHeader className="py-1 px-3">
            <CardTitle className="text-xs font-medium text-muted-foreground">{t("activeLiabilities")}</CardTitle>
          </CardHeader>
          <CardContent className="py-1 px-3">
            <div className="text-base font-bold" data-testid="text-active-count">{summary.activeCount}</div>
          </CardContent>
        </Card>
        <Card className="py-1">
          <CardHeader className="py-1 px-3">
            <CardTitle className="text-xs font-medium text-muted-foreground">{t("settledLiabilities")}</CardTitle>
          </CardHeader>
          <CardContent className="py-1 px-3">
            <div className="text-base font-bold text-green-600 dark:text-green-500" data-testid="text-settled-count">{summary.settledCount}</div>
          </CardContent>
        </Card>
        <Card className="py-1">
          <CardHeader className="py-1 px-3">
            <CardTitle className="text-xs font-medium text-muted-foreground">{t("liabilityByType")}</CardTitle>
          </CardHeader>
          <CardContent className="py-1 px-3">
            <div className="flex flex-wrap gap-1" data-testid="text-type-counts">
              {Object.entries(summary.countByType).map(([type, count]) => (
                <Badge key={type} variant="secondary" className="text-xs">
                  {getLiabilityTypeLabel(type, t)}: {count}
                </Badge>
              ))}
              {Object.keys(summary.countByType).length === 0 && (
                <span className="text-xs text-muted-foreground">-</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="px-4 pb-2 flex flex-wrap items-center gap-2">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px]" data-testid="select-type-filter">
            <SelectValue placeholder={t("allTypes")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allTypes")}</SelectItem>
            {LIABILITY_TYPES.map(lt => (
              <SelectItem key={lt.value} value={lt.value}>{t(lt.labelKey)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[120px]" data-testid="select-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">{t("active")}</SelectItem>
            <SelectItem value="settled">{t("settled")}</SelectItem>
            <SelectItem value="all">{t("all")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="flex-1 px-4 pb-4">
        {filteredLiabilities.length === 0 ? (
          <div className="text-center text-muted-foreground py-12" data-testid="text-no-liabilities">
            {t("noLiabilities")}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredLiabilities.map(liability => (
              <LiabilityRow
                key={liability.id}
                liability={liability}
                t={t}
                canEdit={canEdit}
                isExpanded={expandedPayments.has(liability.id)}
                onToggleExpand={() => togglePaymentHistory(liability.id)}
                onEdit={() => handleEdit(liability)}
                onPayment={() => handlePayment(liability)}
                onSettle={() => handleSettle(liability)}
                onReversePayment={(paymentId) => reversePaymentMutation.mutate(paymentId)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("addLiability")}</DialogTitle>
            <DialogDescription>{t("addLiabilityDesc")}</DialogDescription>
          </DialogHeader>
          <LiabilityFormFields />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)} data-testid="button-cancel-add">
              {t("cancel")}
            </Button>
            <Button onClick={handleSubmitAdd} disabled={createMutation.isPending} data-testid="button-submit-add">
              {createMutation.isPending ? t("adding") : t("add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("editLiability")}</DialogTitle>
            <DialogDescription>{t("editLiabilityDesc")}</DialogDescription>
          </DialogHeader>
          <LiabilityFormFields />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)} data-testid="button-cancel-edit">
              {t("cancel")}
            </Button>
            <Button onClick={handleSubmitEdit} disabled={updateMutation.isPending} data-testid="button-submit-edit">
              {updateMutation.isPending ? t("loading") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("recordPayment")}</DialogTitle>
            <DialogDescription>
              {selectedLiability && `${selectedLiability.liabilityName} - ${t("outstandingAmount")}: ${formatCurrency(selectedLiability.outstandingAmount)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("amount")}</Label>
              <Input
                type="number"
                value={paymentData.amount}
                onChange={e => {
                  const total = e.target.value;
                  setPaymentData(prev => ({
                    ...prev,
                    amount: total,
                    principalComponent: total,
                    interestComponent: "0",
                  }));
                }}
                data-testid="input-payment-amount"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>{t("principalComponent")}</Label>
                <Input
                  type="number"
                  value={paymentData.principalComponent}
                  onChange={e => setPaymentData(prev => ({ ...prev, principalComponent: e.target.value }))}
                  data-testid="input-principal-component"
                />
              </div>
              <div>
                <Label>{t("interestComponent")}</Label>
                <Input
                  type="number"
                  value={paymentData.interestComponent}
                  onChange={e => setPaymentData(prev => ({ ...prev, interestComponent: e.target.value }))}
                  data-testid="input-interest-component"
                />
              </div>
            </div>
            <div>
              <Label>{t("paymentMode")}</Label>
              <Select value={paymentData.paymentMode} onValueChange={v => setPaymentData(prev => ({ ...prev, paymentMode: v }))}>
                <SelectTrigger data-testid="select-payment-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">{t("cash")}</SelectItem>
                  <SelectItem value="account">{t("account")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("date")}</Label>
              <Input
                type="date"
                value={paymentData.paidAt}
                onChange={e => setPaymentData(prev => ({ ...prev, paidAt: e.target.value }))}
                data-testid="input-payment-date"
              />
            </div>
            <div>
              <Label>{t("remarks")}</Label>
              <Input
                value={paymentData.remarks}
                onChange={e => setPaymentData(prev => ({ ...prev, remarks: e.target.value }))}
                data-testid="input-payment-remarks"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)} data-testid="button-cancel-payment">
              {t("cancel")}
            </Button>
            <Button onClick={handleSubmitPayment} disabled={paymentMutation.isPending} data-testid="button-submit-payment">
              {paymentMutation.isPending ? t("loading") : t("recordPayment")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={settleDialogOpen} onOpenChange={setSettleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settleLiability")}</DialogTitle>
            <DialogDescription>
              {selectedLiability && `${t("confirmSettleLiability")} "${selectedLiability.liabilityName}"?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettleDialogOpen(false)} data-testid="button-cancel-settle">
              {t("cancel")}
            </Button>
            <Button onClick={() => selectedLiability && settleMutation.mutate(selectedLiability.id)} disabled={settleMutation.isPending} data-testid="button-confirm-settle">
              {settleMutation.isPending ? t("loading") : t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LiabilityRow({
  liability,
  t,
  canEdit,
  isExpanded,
  onToggleExpand,
  onEdit,
  onPayment,
  onSettle,
  onReversePayment,
}: {
  liability: Liability;
  t: (key: string) => string;
  canEdit: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onPayment: () => void;
  onSettle: () => void;
  onReversePayment: (id: string) => void;
}) {
  const isSettled = liability.isSettled === 1;

  return (
    <Card className={isSettled ? "opacity-70" : ""} data-testid={`card-liability-${liability.id}`}>
      <CardContent className="p-3">
        <div className="flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm" data-testid={`text-liability-name-${liability.id}`}>
                  {liability.liabilityName}
                </span>
                <Badge variant={isSettled ? "outline" : "secondary"} className="text-xs" data-testid={`badge-status-${liability.id}`}>
                  {isSettled ? t("settled") : t("active")}
                </Badge>
                {liability.isOpening === 1 && (
                  <Badge variant="outline" className="text-xs">{t("opening")}</Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {getLiabilityTypeLabel(liability.liabilityType, t)} &middot; {liability.partyName}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs text-muted-foreground">{t("outstandingAmount")}</div>
              <div className={`text-sm font-bold ${isSettled ? "text-green-600 dark:text-green-500" : "text-red-600 dark:text-red-500"}`} data-testid={`text-outstanding-${liability.id}`}>
                {formatCurrency(liability.outstandingAmount ?? 0)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
            <div>
              <span className="text-muted-foreground">{t("originalAmount")}:</span>{" "}
              <span className="font-medium" data-testid={`text-original-${liability.id}`}>{formatCurrency(liability.originalAmount)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t("rateOfInterest")}:</span>{" "}
              <span className="font-medium">{liability.interestRate ?? 0}%</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t("startDate")}:</span>{" "}
              <span className="font-medium">{liability.startDate ? format(new Date(liability.startDate), "dd/MM/yyyy") : "-"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t("dueDate")}:</span>{" "}
              <span className="font-medium">{liability.dueDate ? format(new Date(liability.dueDate), "dd/MM/yyyy") : "-"}</span>
            </div>
            {liability.emiAmount && (
              <div>
                <span className="text-muted-foreground">{t("emiAmount")}:</span>{" "}
                <span className="font-medium">{formatCurrency(liability.emiAmount)}</span>
              </div>
            )}
            {liability.remarks && (
              <div className="col-span-2">
                <span className="text-muted-foreground">{t("remarks")}:</span>{" "}
                <span className="font-medium">{liability.remarks}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            {canEdit && !isSettled && (
              <>
                <Button variant="ghost" size="sm" onClick={onEdit} data-testid={`button-edit-${liability.id}`}>
                  <Pencil className="w-3 h-3 mr-1" />
                  {t("edit")}
                </Button>
                <Button variant="ghost" size="sm" onClick={onPayment} data-testid={`button-payment-${liability.id}`}>
                  <CreditCard className="w-3 h-3 mr-1" />
                  {t("recordPayment")}
                </Button>
                <Button variant="ghost" size="sm" onClick={onSettle} data-testid={`button-settle-${liability.id}`}>
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  {t("settleLiability")}
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={onToggleExpand} data-testid={`button-toggle-payments-${liability.id}`}>
              {isExpanded ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
              {t("paymentHistory")}
            </Button>
          </div>

          {isExpanded && (
            <PaymentHistorySection
              liabilityId={liability.id}
              t={t}
              canEdit={canEdit && !isSettled}
              onReverse={onReversePayment}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PaymentHistorySection({
  liabilityId,
  t,
  canEdit,
  onReverse,
}: {
  liabilityId: string;
  t: (key: string) => string;
  canEdit: boolean;
  onReverse: (id: string) => void;
}) {
  const { data: payments, isLoading } = useQuery<LiabilityPayment[]>({
    queryKey: ["/api/liabilities", liabilityId, "payments"],
    queryFn: async () => {
      const res = await authFetch(`/api/liabilities/${liabilityId}/payments`);
      if (!res.ok) throw new Error("Failed to fetch payments");
      return res.json();
    },
  });

  if (isLoading) {
    return <Skeleton className="h-16" />;
  }

  if (!payments || payments.length === 0) {
    return (
      <div className="text-xs text-muted-foreground text-center py-2 border-t" data-testid={`text-no-payments-${liabilityId}`}>
        {t("noPayments")}
      </div>
    );
  }

  return (
    <div className="border-t pt-2 space-y-1">
      <div className="text-xs font-medium text-muted-foreground mb-1">{t("paymentHistory")}</div>
      {payments.map(payment => {
        const isReversed = payment.isReversed === 1;
        return (
          <div
            key={payment.id}
            className={`flex items-center justify-between text-xs p-2 rounded-md bg-muted/50 gap-2 flex-wrap ${isReversed ? "opacity-50 line-through" : ""}`}
            data-testid={`payment-row-${payment.id}`}
          >
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-medium">{format(new Date(payment.paidAt), "dd/MM/yyyy")}</span>
              <span>{t("amount")}: {formatCurrency(payment.amount)}</span>
              <span>{t("principal")}: {formatCurrency(payment.principalComponent)}</span>
              <span>{t("interest")}: {formatCurrency(payment.interestComponent)}</span>
              <Badge variant="outline" className="text-xs">{payment.paymentMode === "cash" ? t("cash") : t("account")}</Badge>
              {isReversed && <Badge variant="destructive" className="text-xs">{t("reversed")}</Badge>}
            </div>
            {canEdit && !isReversed && (
              <Button variant="ghost" size="sm" onClick={() => onReverse(payment.id)} data-testid={`button-reverse-payment-${payment.id}`}>
                <RotateCcw className="w-3 h-3 mr-1" />
                {t("reverse")}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
