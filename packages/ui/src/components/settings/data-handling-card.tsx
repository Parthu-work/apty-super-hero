import type { AppSettings } from "@apty/agent-core";
import { ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

export interface DataHandlingCardProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  language?: string;
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
}: DataHandlingCardProps) {
  const zh = language === "zh";
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
          {zh ? "数据处理" : "Data handling"}
        </CardTitle>
        <CardDescription>
          {zh
            ? "控制页面网络捕获时是否读取响应正文。正文经过脱敏后发送给您的 AI 服务商。"
            : "Choose whether a page network capture reads response bodies. Bodies are redacted, then sent to your AI provider."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="network-body-capture" className="text-sm font-medium">
            {zh ? "捕获响应正文" : "Capture response bodies"}
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
            {zh
              ? "从不捕获正文的主机或网址（每行一个）"
              : "Never capture bodies from these hosts or URL fragments (one per line)"}
          </Label>
          <Textarea
            id="network-body-deny-list"
            value={denyListText}
            disabled={!enabled}
            placeholder={"bank.example.com\n/api/patients"}
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
      </CardContent>
    </Card>
  );
}
