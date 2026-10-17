import type {
  AppSettings,
  RedactionModeSetting,
  RequestReport,
} from "@apty/agent-core";
import { ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../../i18n/context";

const DENY_LIST_SAVE_DELAY_MS = 500;

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { RecentRequests } from "./recent-requests";
import { RedactionModeControl } from "./redaction-mode-control";
import { ScreenshotPolicyControl } from "./screenshot-policy-control";

export interface DataHandlingCardProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  language?: string;
  /** Redacts the Preview sample in a given mode (supplied by the host app). */
  redactionPreview?: (text: string, mode: RedactionModeSetting) => string;
  /** The last requests sent to the AI provider, when the host app can read them. */
  recentRequests?: RequestReport[];
}

function parseDenyList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function DataHandlingCard({
  settings,
  onChange,
  language,
  redactionPreview,
  recentRequests,
}: DataHandlingCardProps) {
  const { t } = useTranslation();
  const [denyListText, setDenyListText] = useState(
    (settings.networkBodyCaptureDenyList ?? []).join("\n"),
  );
  const enabled = settings.networkBodyCaptureEnabled === true;

  // Each change is a full settings write; wait for a pause in typing, and
  // save what's pending if the card goes away first.
  const pendingDenyList = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const flushDenyList = () => {
    clearTimeout(saveTimer.current);
    if (pendingDenyList.current === null) return;
    onChangeRef.current({
      networkBodyCaptureDenyList: parseDenyList(pendingDenyList.current),
    });
    pendingDenyList.current = null;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: flush on unmount only
  useEffect(() => flushDenyList, []);

  return (
    <Card id="data-handling" className="scroll-mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          {t("dataHandling.title")}
        </CardTitle>
        <CardDescription>{t("dataHandling.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RedactionModeControl
          mode={settings.redactionMode ?? "strict"}
          onChange={(redactionMode) => onChange({ redactionMode })}
          preview={redactionPreview}
          language={language}
        />
        <ScreenshotPolicyControl
          policy={settings.screenshotPolicy ?? "ask"}
          onChange={(screenshotPolicy) => onChange({ screenshotPolicy })}
        />
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="network-body-capture" className="text-sm font-medium">
            {t("dataHandling.captureBodies")}
          </Label>
          <Switch
            id="network-body-capture"
            checked={enabled}
            onCheckedChange={(checked) =>
              onChange({ networkBodyCaptureEnabled: checked })
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="network-body-deny-list" className="text-sm">
            {t("dataHandling.denyListLabel")}
          </Label>
          <Textarea
            id="network-body-deny-list"
            value={denyListText}
            placeholder={
              "bank.example.com\n/api/patients\n/users/\n/api/me\n/userinfo"
            }
            onChange={(event) => {
              setDenyListText(event.target.value);
              pendingDenyList.current = event.target.value;
              clearTimeout(saveTimer.current);
              saveTimer.current = setTimeout(
                flushDenyList,
                DENY_LIST_SAVE_DELAY_MS,
              );
            }}
            onBlur={flushDenyList}
          />
        </div>
        {recentRequests && <RecentRequests reports={recentRequests} />}
      </CardContent>
    </Card>
  );
}
