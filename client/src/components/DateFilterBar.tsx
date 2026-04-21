import { Fragment, useEffect, useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown } from "lucide-react";

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
  inline?: boolean;
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
  testIdPrefix = "",
  showLabels = true,
  inline = false,
}: DateFilterBarProps) {
  const { t } = useI18n();
  const currentYear = new Date().getFullYear();
  const tid = (id: string) => (testIdPrefix ? `${testIdPrefix}-${id}` : id);

  const yearOptions = useMemo(() => {
    const set = new Set<number>(availableYears);
    set.add(currentYear);
    return Array.from(set).sort((a, b) => b - a);
  }, [availableYears, currentYear]);

  const monthShortNames = useMemo(() => t("monthsShort").split(","), [t]);

  const maxDay = useMemo(() => {
    if (year === "all") return 31;
    const yNum = parseInt(year, 10) || currentYear;
    if (selectedMonths.length === 0) return 31;
    return Math.max(...selectedMonths.map((m) => daysInMonth(yNum, m)));
  }, [year, selectedMonths, currentYear]);

  // Trim out-of-range days when months/year change
  useEffect(() => {
    if (selectedDays.length === 0) return;
    const trimmed = selectedDays.filter((d) => d <= maxDay);
    if (trimmed.length !== selectedDays.length) onDaysChange(trimmed);
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

  const Wrapper = inline ? Fragment : "div";
  const wrapperProps = inline ? {} : { className: "grid grid-cols-3 gap-2 sm:gap-3" };

  return (
    <Wrapper {...wrapperProps}>
      <div className="space-y-2">
        {showLabels && (
          <label className="text-sm text-muted-foreground">{t("filterByYear")}</label>
        )}
        <Select value={year} onValueChange={handleYearChange}>
          <SelectTrigger data-testid={tid("trigger-year")}>
            <SelectValue>{yearLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {allowAllYears && (
              <SelectItem value="all" data-testid={tid("option-year-all")}>
                {t("allYears")}
              </SelectItem>
            )}
            {yearOptions.map((y) => (
              <SelectItem key={y} value={String(y)} data-testid={tid(`option-year-${y}`)}>
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
              data-testid={tid("trigger-month")}
            >
              <span className="truncate">{monthLabel}</span>
              <ChevronDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="start">
            <label className="flex items-center gap-2 pb-2 mb-2 border-b cursor-pointer">
              <Checkbox
                checked={selectedMonths.length === 0}
                onCheckedChange={(v) => {
                  if (v) {
                    onMonthsChange([]);
                    if (selectedDays.length > 0) onDaysChange([]);
                  }
                }}
                data-testid={tid("checkbox-all-months")}
              />
              <span className="text-sm font-medium">{t("allMonths")}</span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              {monthShortNames.map((label, idx) => {
                const m = idx + 1;
                const selected = selectedMonths.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    className={`px-2 py-2 rounded-md text-sm font-medium border ${
                      selected
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : "bg-background hover-elevate"
                    }`}
                    onClick={() => toggleMonth(m)}
                    data-testid={tid(`chip-month-${m}`)}
                  >
                    {label.trim()}
                  </button>
                );
              })}
            </div>
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
              data-testid={tid("trigger-day")}
            >
              <span className="truncate">{dayLabel}</span>
              <ChevronDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-3" align="start">
            <label className="flex items-center gap-2 pb-2 mb-2 border-b cursor-pointer">
              <Checkbox
                checked={selectedDays.length === 0}
                onCheckedChange={(v) => {
                  if (v) onDaysChange([]);
                }}
                data-testid={tid("checkbox-all-days")}
              />
              <span className="text-sm font-medium">{t("allDays")}</span>
            </label>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => {
                const selected = selectedDays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    className={`px-1 py-2 rounded-md text-sm font-medium border ${
                      selected
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : "bg-background hover-elevate"
                    }`}
                    onClick={() => toggleDay(d)}
                    data-testid={tid(`chip-day-${d}`)}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </Wrapper>
  );
}

export type DateFilterValue = string | Date | null | undefined;

export function dateMatchesFilter(
  value: DateFilterValue,
  year: string,
  months: number[],
  days: number[],
): boolean {
  if (value === null || value === undefined) return false;

  let y: number;
  let m: number;
  let d: number;

  if (typeof value === "string") {
    // Prefer deterministic parsing for YYYY-MM-DD prefixed strings
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      y = parseInt(match[1], 10);
      m = parseInt(match[2], 10);
      d = parseInt(match[3], 10);
    } else {
      const dt = new Date(value);
      if (isNaN(dt.getTime())) return false;
      y = dt.getFullYear();
      m = dt.getMonth() + 1;
      d = dt.getDate();
    }
  } else {
    if (isNaN(value.getTime())) return false;
    y = value.getFullYear();
    m = value.getMonth() + 1;
    d = value.getDate();
  }

  if (year && year !== "all" && String(y) !== year) return false;
  if (months.length > 0 && !months.includes(m)) return false;
  if (days.length > 0 && !days.includes(d)) return false;
  return true;
}
