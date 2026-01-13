import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Download, CalendarIcon, Loader2 } from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function ExportDialog() {
  const { t, language } = useI18n();
  const { token } = useAuth();
  const { toast } = useToast();
  
  const [open, setOpen] = useState(false);
  const [fromDate, setFromDate] = useState<Date>(startOfMonth(new Date()));
  const [toDate, setToDate] = useState<Date>(new Date());
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);
  
  const [exportLots, setExportLots] = useState(true);
  const [exportSales, setExportSales] = useState(true);
  const [exportCash, setExportCash] = useState(true);
  
  const [isExporting, setIsExporting] = useState(false);

  const getDownloadToken = async (): Promise<string | null> => {
    if (!token) return null;
    try {
      const response = await fetch("/api/export/token", {
        method: "POST",
        headers: { "x-auth-token": token },
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.downloadToken;
    } catch {
      return null;
    }
  };

  const handleExport = async (type: "lots" | "sales" | "cash"): Promise<boolean> => {
    const downloadToken = await getDownloadToken();
    if (!downloadToken) return false;
    
    const fromStr = format(fromDate, "yyyy-MM-dd");
    const toStr = format(toDate, "yyyy-MM-dd");
    
    const url = `/api/export/${type}?fromDate=${fromStr}&toDate=${toStr}&language=${language}&downloadToken=${encodeURIComponent(downloadToken)}`;
    
    window.open(url, "_blank");
    return true;
  };

  const handleExportAll = async () => {
    setIsExporting(true);
    let successCount = 0;
    let failCount = 0;
    
    try {
      if (exportLots) {
        const success = await handleExport("lots");
        if (success) successCount++; else failCount++;
      }
      if (exportSales) {
        const success = await handleExport("sales");
        if (success) successCount++; else failCount++;
      }
      if (exportCash) {
        const success = await handleExport("cash");
        if (success) successCount++; else failCount++;
      }
      
      if (failCount === 0) {
        toast({
          title: language === "hi" ? "डाउनलोड सफल" : "Download Successful",
          description: language === "hi" 
            ? `${successCount} फ़ाइलें डाउनलोड हुईं` 
            : `${successCount} file(s) downloaded`,
        });
      } else {
        toast({
          title: language === "hi" ? "कुछ डाउनलोड विफल" : "Some Downloads Failed",
          description: language === "hi" 
            ? `${successCount} सफल, ${failCount} विफल` 
            : `${successCount} succeeded, ${failCount} failed`,
          variant: "destructive",
        });
      }
    } finally {
      setIsExporting(false);
    }
  };

  const setQuickRange = (days: number) => {
    setToDate(new Date());
    setFromDate(subDays(new Date(), days));
  };

  const setCurrentMonth = () => {
    const now = new Date();
    setFromDate(startOfMonth(now));
    setToDate(endOfMonth(now));
  };

  const selectedCount = [exportLots, exportSales, exportCash].filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" data-testid="button-export">
          <Download className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle data-testid="text-export-title">
            {language === "hi" ? "डेटा डाउनलोड करें" : "Download Data"}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>{language === "hi" ? "तारीख सीमा" : "Date Range"}</Label>
            <div className="flex flex-wrap gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setQuickRange(7)}
                data-testid="button-range-7days"
              >
                {language === "hi" ? "7 दिन" : "7 Days"}
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setQuickRange(30)}
                data-testid="button-range-30days"
              >
                {language === "hi" ? "30 दिन" : "30 Days"}
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={setCurrentMonth}
                data-testid="button-range-month"
              >
                {language === "hi" ? "इस महीने" : "This Month"}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{language === "hi" ? "से" : "From"}</Label>
              <Popover open={fromOpen} onOpenChange={setFromOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn("w-full justify-start text-left font-normal")}
                    data-testid="button-from-date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(fromDate, "dd/MM/yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={fromDate}
                    onSelect={(date) => {
                      if (date) setFromDate(date);
                      setFromOpen(false);
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>{language === "hi" ? "तक" : "To"}</Label>
              <Popover open={toOpen} onOpenChange={setToOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn("w-full justify-start text-left font-normal")}
                    data-testid="button-to-date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(toDate, "dd/MM/yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={toDate}
                    onSelect={(date) => {
                      if (date) setToDate(date);
                      setToOpen(false);
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="space-y-3">
            <Label>{language === "hi" ? "क्या डाउनलोड करें" : "What to Download"}</Label>
            
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="export-lots" 
                  checked={exportLots}
                  onCheckedChange={(checked) => setExportLots(checked === true)}
                  data-testid="checkbox-export-lots"
                />
                <label 
                  htmlFor="export-lots" 
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  {language === "hi" ? "लॉट डेटा (खोजें/संपादित करें)" : "Lots Data (Search/Edit)"}
                </label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="export-sales" 
                  checked={exportSales}
                  onCheckedChange={(checked) => setExportSales(checked === true)}
                  data-testid="checkbox-export-sales"
                />
                <label 
                  htmlFor="export-sales" 
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  {language === "hi" ? "बिक्री इतिहास" : "Sales History"}
                </label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="export-cash" 
                  checked={exportCash}
                  onCheckedChange={(checked) => setExportCash(checked === true)}
                  data-testid="checkbox-export-cash"
                />
                <label 
                  htmlFor="export-cash" 
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  {language === "hi" ? "नकद प्रबंधन" : "Cash Management"}
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-export">
            {language === "hi" ? "रद्द करें" : "Cancel"}
          </Button>
          <Button 
            onClick={handleExportAll}
            disabled={selectedCount === 0 || isExporting}
            data-testid="button-download-export"
          >
            {isExporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {language === "hi" ? "डाउनलोड हो रहा है..." : "Downloading..."}
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                {language === "hi" ? `डाउनलोड (${selectedCount})` : `Download (${selectedCount})`}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
