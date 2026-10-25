import { useId, useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useI18n } from "@/lib/i18n";
import { filterDiscountFarmers, sortedDiscountFarmers, type DiscountFarmer } from "@/lib/discount-farmers";
import { formatCurrency } from "@/components/Currency";

export function DiscountFarmerPicker({ farmers, value, onSelect }: {
  farmers: readonly DiscountFarmer[];
  value: string;
  onSelect: (id: string) => void;
}) {
  const { language, t } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const eligible = useMemo(() => sortedDiscountFarmers(farmers, language), [farmers, language]);
  const visible = useMemo(() => filterDiscountFarmers(eligible, search, language), [eligible, search, language]);
  const selected = farmers.find(farmer => farmer.id === value);

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) setSearch("");
  }

  return (
    <div className="space-y-2 min-w-0">
      <Label htmlFor={id}>{t("farmer")} *</Label>
      <Popover open={open} onOpenChange={changeOpen}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" role="combobox"
            aria-expanded={open} aria-haspopup="listbox" aria-controls={`${id}-list`}
            className="w-full h-auto min-h-9 justify-between font-normal text-left"
            data-testid="select-discount-farmer">
            {selected ? (
              <span className="min-w-0">
                <span className="block truncate font-medium">{selected.farmerName}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {selected.village} | {selected.contactNumber} | {t("due")}: ₹{formatCurrency(selected.totalDue)}
                </span>
              </span>
            ) : <span className="truncate text-muted-foreground">{t("selectFarmer")}</span>}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0"
          data-testid="discount-farmer-popover">
          <Command shouldFilter={false}>
            <CommandInput value={search} onValueChange={setSearch}
              aria-label={t("searchDiscountFarmer")} placeholder={t("searchDiscountFarmer")}
              data-testid="input-discount-farmer-search" />
            <CommandList id={`${id}-list`} aria-label={t("selectFarmer")}>
              <CommandEmpty>{eligible.length === 0 ? t("noFarmersWithDues") : t("noFarmersFound")}</CommandEmpty>
              <CommandGroup>
                {visible.map(farmer => (
                  <CommandItem key={farmer.id} value={farmer.id}
                    data-testid={`discount-farmer-option-${farmer.id}`}
                    onSelect={() => {
                      if (farmer.id !== value) onSelect(farmer.id);
                      changeOpen(false);
                    }}>
                    <Check className={`mr-1 h-4 w-4 shrink-0 ${value === farmer.id ? "opacity-100" : "opacity-0"}`} />
                    <span className="min-w-0">
                      <span className="block break-words font-medium">{farmer.farmerName}</span>
                      <span className="block break-words text-xs text-muted-foreground">
                        {farmer.village} | {farmer.contactNumber} | {t("due")}: ₹{formatCurrency(farmer.totalDue)}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
