import { useEffect, useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, X } from "lucide-react";

export interface DateFilterBarProps {
  year: string;
  onYearChange: (year: string) => void;
  selectedMonths: number[];
  onMonthsChange: (months: number[]) => void;
  selectedDays: number[];
  onDaysChange: (days: number[]) => void;
  availableYears?: number[];
  allowAllYears?: boolean;
  testIdPrefix?: string;
  showLabels?: boolean;
}

function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

export function DateFilterBar({
  year,
  onYearChange,
  selectedMonths,
  onMonthsChange,
  selectedDays,
  onDaysChange,
  availableYears = [],
  allowAllYears = true,
  testIdPrefix = "date-filter",
  showLabels = true,
}: DateFilterBarProps) {
  const { t } = useI18n();
  const currentYear = new Date().getFullYear();

  const yearOptions = useMemo(() => {
    const set = new Set<number>(availableYears);
    set.add(currentYear);
    return Array.from(set).sort((a, b) => b - a);
  }, [availableYears, currentYear]);

  const monthShortNames = useMemo(() => t("monthsShort").split(","), [t]);

  const maxDay = useMemo(() => {
    const yNum = year === "all" ? currentYear : parseInt(year, 10) || currentYear;
    if (selectedMonths.length === 0) return 31;
    return Math.max(...selectedMonths.map((m) => daysInMonth(yNum, m)));
  }, [year, selectedMonths, currentYear]);

  // Trim out-of-range days when months/year change
  useEffect(() => {
    if (selectedDays.length === 0) return;
    const trimmed = selectedDays.filter((d) => d <= maxDay);
    if (trimmed.length !== selectedDays.length) {
      onDaysChange(trimmed);
    }
  }, [maxDay, selectedDays, onDaysChange]);

  const handleYearChange = (next: string) => {
    onYearChange(next);
    if (selectedMonths.length > 0) onMonthsChange([]);
    if (selectedDays.length > 0) onDaysChange([]);
  };

  const toggleMonth = (m: number) => {
    const next = selectedMonths.includes(m)
      ? selectedMonths.filter((x) => x !== m)
      : [...selectedMonths, m].sort((a, b) => a - b);
    onMonthsChange(next);
    if (selectedDays.length > 0) onDaysChange([]);
  };

  const toggleDay = (d: number) => {
    const next = selectedDays.includes(d)
      ? selectedDays.filter((x) => x !== d)
      : [...selectedDays, d].sort((a, b) => a - b);
    onDaysChange(next);
  };

  const yearLabel = year === "all" ? t("allYears") : year;

  const monthLabel =
    selectedMonths.length === 0
      ? t("allMonths")
      : selectedMonths.length === 1
        ? monthShortNames[selectedMonths[0] - 1]
        : `${selectedMonths.length} ${t("monthsLabel")}`;

  const dayLabel =
    selectedDays.length === 0
      ? t("allDays")
      : selectedDays.length === 1
        ? String(selectedDays[0])
        : `${selectedDays.length} ${t("daysLabel")}`;

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      <div className="space-y-2">
        {showLabels && (
          <label className="text-sm text-muted-foreground">{t("filterByYear")}</label>
        )}
        <Select value={year} onValueChange={handleYearChange}>
          <SelectTrigger data-testid={`${testIdPrefix}-year`}>
            <SelectValue>{yearLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {allowAllYears && <SelectItem value="all">{t("allYears")}</SelectItem>}
            {yearOptions.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {showLabels && (
          <label className="text-sm text-muted-foreground">{t("monthsLabel")}</label>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-between font-normal"
              data-testid={`${testIdPrefix}-months`}
            >
              <span className="truncate">{monthLabel}</span>
              <ChevronDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="start">
            <div className="grid grid-cols-4 gap-2">
              {monthShortNames.map((mn, idx) => {
                const m = idx + 1;
                const checked = selectedMonths.includes(m);
                return (
                  <label
                    key={m}
                    className="flex items-center gap-1.5 cursor-pointer text-sm hover-elevate rounded px-1.5 py-1"
                    data-testid={`${testIdPrefix}-month-${m}`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleMonth(m)}
                    />
                    <span>{mn.trim()}</span>
                  </label>
                );
              })}
            </div>
            {selectedMonths.length > 0 && (
              <div className="mt-3 pt-2 border-t flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onMonthsChange([]);
                    if (selectedDays.length > 0) onDaysChange([]);
                  }}
                  data-testid={`${testIdPrefix}-months-clear`}
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  {t("clearFilters")}
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      <div className="space-y-2">
        {showLabels && (
          <label className="text-sm text-muted-foreground">{t("daysLabel")}</label>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-between font-normal"
              data-testid={`${testIdPrefix}-days`}
            >
              <span className="truncate">{dayLabel}</span>
              <ChevronDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-3" align="start">
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => {
                const checked = selectedDays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    className={`text-xs rounded h-8 w-8 flex items-center justify-center border hover-elevate ${
                      checked
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background"
                    }`}
                    data-testid={`${testIdPrefix}-day-${d}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            {selectedDays.length > 0 && (
              <div className="mt-3 pt-2 border-t flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onDaysChange([])}
                  data-testid={`${testIdPrefix}-days-clear`}
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  {t("clearFilters")}
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

export function dateMatchesFilter(
  isoDate: string | Date | null | undefined,
  year: string,
  months: number[],
  days: number[],
): boolean {
  if (!isoDate) return false;
  const d = isoDate instanceof Date ? isoDate : new Date(isoDate);
  if (isNaN(d.getTime())) return false;
  if (year && year !== "all" && String(d.getFullYear()) !== year) return false;
  if (months.length > 0 && !months.includes(d.getMonth() + 1)) return false;
  if (days.length > 0 && !days.includes(d.getDate())) return false;
  return true;
}
