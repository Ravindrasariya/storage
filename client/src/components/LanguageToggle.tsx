import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Globe } from "lucide-react";

export function LanguageToggle() {
  const { language, setLanguage } = useI18n();

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setLanguage(language === "en" ? "hi" : "en")}
      className="gap-2 font-medium"
      data-testid="button-language-toggle"
    >
      <Globe className="h-4 w-4" />
      <span>{language === "en" ? "हिंदी" : "EN"}</span>
    </Button>
  );
}
