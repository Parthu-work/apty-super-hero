import { SettingsIcon } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "../../../i18n/context";
import { getRuntime } from "../../../lib/runtime";
import { cn } from "../../../lib/utils";
import { Button } from "../../ui/button";

export interface ConfigurationGuideProps {
  onOpenSettings?: () => void;
  className?: string;
}

export function ConfigurationGuide({
  onOpenSettings,
  className,
}: ConfigurationGuideProps) {
  const { t } = useTranslation();
  const runtime = getRuntime();

  const handleOpenOptions = useCallback(() => {
    if (onOpenSettings) {
      onOpenSettings();
    } else if (runtime?.openOptionsPage) {
      runtime.openOptionsPage();
    }
  }, [onOpenSettings, runtime]);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center h-full p-4 sm:p-8",
        className,
      )}
    >
      <div className="text-center max-w-md">
        <div className="mb-6 flex justify-center">
          <div className="w-16 h-16 rounded-full bg-warning/15 flex items-center justify-center">
            <SettingsIcon className="w-8 h-8 text-warning" aria-hidden="true" />
          </div>
        </div>

        <h3 className="text-xl font-semibold text-foreground mb-3">
          {t("config.title")}
        </h3>

        <p className="text-sm text-muted-foreground mb-2">
          {t("config.description")}
        </p>

        <p className="text-xs text-muted-foreground/80 mb-6">
          {t("config.apiTokenRequired")}
        </p>

        <Button
          onClick={handleOpenOptions}
          className="gap-2"
          variant="default"
          size="lg"
        >
          <SettingsIcon className="w-4 h-4" aria-hidden="true" />
          {t("config.openSettings")}
        </Button>
      </div>
    </div>
  );
}
