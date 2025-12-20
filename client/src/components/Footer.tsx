import { useI18n } from "@/lib/i18n";
import { Phone } from "lucide-react";

export function Footer() {
  const { t } = useI18n();

  return (
    <footer className="border-t bg-card py-4 px-6">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-chart-1" />
          <span data-testid="text-help-contact">{t("needHelp")}: 8882589392</span>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4">
          <span data-testid="text-created-by">{t("createdBy")}</span>
          <span data-testid="text-rights">{t("allRightsReserved")}</span>
        </div>
      </div>
    </footer>
  );
}
