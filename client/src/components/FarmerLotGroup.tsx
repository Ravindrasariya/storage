import { ChevronDown, ChevronRight, MapPin, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";

const FULL_ROW_GRID =
  "grid grid-cols-[24px_minmax(70px,0.9fr)_minmax(70px,0.9fr)_minmax(70px,0.8fr)_minmax(70px,0.9fr)_minmax(140px,1.6fr)_minmax(70px,0.7fr)_minmax(80px,0.8fr)_minmax(80px,1.5fr)_minmax(140px,2fr)_minmax(90px,1.7fr)_minmax(70px,1.4fr)] gap-x-2 items-center min-w-[1000px] md:min-w-0";

const RIGHT_HALF_START = "border-l border-border/60 pl-2 md:pl-3";
const LEFT_BAND_BG = "bg-sky-100/70 dark:bg-sky-900/30";
const RIGHT_BAND_BG = "bg-amber-100/70 dark:bg-amber-900/30";

function fmtDateShort(d: string | Date): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).replaceAll("/", "-");
}

export function FarmerLotGroup() {
  const { t } = useI18n();
  return null;
}
