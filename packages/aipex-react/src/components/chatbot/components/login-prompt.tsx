import { SettingsIcon } from "lucide-react";
import type React from "react";
import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { Button } from "../../ui/button";

interface LoginPromptProps {
  onOpenSettings?: () => void;
}

// Default translations for the configuration prompt
const defaultTranslations = {
  "loginPrompt.title": "AI Provider Not Configured",
  "loginPrompt.description":
    "Add an API key and model in Settings before using the AI assistant.",
  "loginPrompt.configureByok": "Open Settings",
};

export const LoginPrompt: React.FC<LoginPromptProps> = ({
  onOpenSettings,
}) => {
  // Simple translation function
  const t = (key: string): string => {
    return defaultTranslations[key as keyof typeof defaultTranslations] || key;
  };

  const handleOpenSettings = () => {
    onOpenSettings?.();
  };

  return (
    <Alert variant="warning" className="mb-4">
      <SettingsIcon aria-hidden="true" />
      <AlertTitle>{t("loginPrompt.title")}</AlertTitle>
      <AlertDescription>
        <p className="mb-3">{t("loginPrompt.description")}</p>
        {onOpenSettings && (
          <Button type="button" size="sm" onClick={handleOpenSettings}>
            <SettingsIcon aria-hidden="true" />
            {t("loginPrompt.configureByok")}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
};
