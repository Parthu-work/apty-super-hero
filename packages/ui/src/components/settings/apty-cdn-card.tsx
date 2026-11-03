import type { AppSettings } from "@apty/agent-core";
import { CloudDownload } from "lucide-react";
import { useTranslation } from "../../i18n/context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";

export interface AptyCdnCardProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

/** Whether the checks may read Apty's public content CDN when the Apty Client does not answer. */
export function AptyCdnCard({ settings, onChange }: AptyCdnCardProps) {
  const { t } = useTranslation();
  return (
    <Card id="apty-cdn-fallback" className="scroll-mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CloudDownload aria-hidden="true" className="h-5 w-5" />
          {t("settings.aptyCdn.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="apty-cdn-fallback-switch" className="text-sm">
              {t("settings.aptyCdn.label")}
            </Label>
            <CardDescription className="text-xs">
              {t("settings.aptyCdn.help")}
            </CardDescription>
          </div>
          <Switch
            id="apty-cdn-fallback-switch"
            checked={settings.aptyCdnFallback !== false}
            onCheckedChange={(checked) =>
              onChange({ aptyCdnFallback: checked })
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
