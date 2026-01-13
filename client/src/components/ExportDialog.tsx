import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Download, CalendarIcon, Loader2 } from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type ExportType = "lots" | "sales" | "cash";

export function ExportDialog() {
  const { language } = useI18n();
  const { token } = useAuth();
  const { toast } = useToast();
  
  const [open, setOpen] = useState(false);
  const [fromDate, setFromDate] = useState<Date>(startOfMonth(new Date()));
  const [toDate, setToDate] = useState<Date>(new Date());
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);
  
  const [selectedType, setSelectedType] = useState<ExportType>("lots");
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

  const handleExport = async () => {
    setIsExporting(true);
    
    try {
      const downloadToken = await getDownloadToken();
      if (!downloadToken) {
        toast({
          title: language === "hi" ? "डाउनलोड विफल" : "Download Failed",
          description: language === "hi" ? "कृपया पुनः प्रयास करें" : "Please try again",
          variant: "destructive",
        });
        return;
      }
      
      const fromStr = format(fromDate, "yyyy-MM-dd");
      const toStr = format(toDate, "yyyy-MM-dd");
      
      const url = `/api/export/${selectedType}?fromDate=${fromStr}&toDate=${toStr}&language=${language}&downloadToken=${encodeURIComponent(downloadToken)}`;
      
      window.open(url, "_blank");
      
      const typeNames = {
        lots: language === "hi" ? "लॉट डेटा" : "Lots Data",
        sales: language === "hi" ? "बिक्री इतिहास" : "Sales History",
        cash: language === "hi" ? "नकद प्रबंधन" : "Cash Management",
      };
      
      toast({
        title: language === "hi" ? "डाउनलोड शुरू" : "Download Started",
        description: typeNames[selectedType],
      });
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
            
            <RadioGroup 
              value={selectedType} 
              onValueChange={(value) => setSelectedType(value as ExportType)}
              className="space-y-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem 
                  value="lots" 
                  id="export-lots"
                  data-testid="radio-export-lots"
                />
                <label 
                  htmlFor="export-lots" 
                  className="text-sm font-medium leading-none cursor-pointer"
                >
                  {language === "hi" ? "लॉट डेटा (खोजें/संपादित करें)" : "Lots Data (Search/Edit)"}
                </label>
              </div>
              
              <div className="flex items-center space-x-2">
                <RadioGroupItem 
                  value="sales" 
                  id="export-sales"
                  data-testid="radio-export-sales"
                />
                <label 
                  htmlFor="export-sales" 
                  className="text-sm font-medium leading-none cursor-pointer"
                >
                  {language === "hi" ? "बिक्री इतिहास" : "Sales History"}
                </label>
              </div>
              
              <div className="flex items-center space-x-2">
                <RadioGroupItem 
                  value="cash" 
                  id="export-cash"
                  data-testid="radio-export-cash"
                />
                <label 
                  htmlFor="export-cash" 
                  className="text-sm font-medium leading-none cursor-pointer"
                >
                  {language === "hi" ? "नकद प्रबंधन" : "Cash Management"}
                </label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-export">
            {language === "hi" ? "रद्द करें" : "Cancel"}
          </Button>
          <Button 
            onClick={handleExport}
            disabled={isExporting}
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
                {language === "hi" ? "डाउनलोड" : "Download"}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
