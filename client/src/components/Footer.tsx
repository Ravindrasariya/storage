import { useI18n } from "@/lib/i18n";
import { Phone } from "lucide-react";

export function Footer() {
  const { language } = useI18n();

  return (
    <footer className="border-t bg-card py-4 px-6">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-chart-1" />
          <span data-testid="text-help-contact">
            {language === "hi" ? "मदद चाहिए? " : "Need Help? Reach out to "}
            <span className="text-green-600 dark:text-green-400 font-medium">Krashu</span>
            <span className="text-orange-500 dark:text-orange-400 font-medium">Ved</span>
            : 8882589392
          </span>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4">
          <span data-testid="text-created-by">
            {language === "hi" ? "" : "Created & Maintained by "}
            <span className="text-green-600 dark:text-green-400 font-medium">Krashu</span>
            <span className="text-orange-500 dark:text-orange-400 font-medium">Ved</span>
            {language === "hi" ? " द्वारा निर्मित और अनुरक्षित" : ""}
          </span>
          <span data-testid="text-rights">
            {language === "hi" ? "सर्वाधिकार सुरक्षित" : "All Rights Reserved"}
          </span>
        </div>
      </div>
    </footer>
  );
}
