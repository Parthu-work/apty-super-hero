import type { AppSettings, RedactionModeSetting } from "@apty/agent-core";
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
import { RedactionModeControl } from "./redaction-mode-control";

export interface DataHandlingCardProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  language?: string;
  /** Redacts the Preview sample in a given mode (supplied by the host app). */
  redactionPreview?: (text: string, mode: RedactionModeSetting) => string;
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
            ? "控制页面网络捕获时是否读取响应正文。正文经过脱敏后发送给您的 AI 服务商。下面的拒绝列表同时适用于页面捕获和 Apty Client 返回的正文。代理读取的页面文字和标签按页面原样发送（密钥除外）；表单中键入的值遵循下面的脱敏模式。"
            : "Choose whether a page network capture reads response bodies. Bodies are redacted, then sent to your AI provider. The deny list below applies both to page capture and to bodies the Apty Client returns. Page text and labels the agent reads are sent as the page shows them (apart from secrets); values typed into form fields follow the redaction mode below."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RedactionModeControl
          mode={settings.redactionMode ?? "strict"}
          onChange={(redactionMode) => onChange({ redactionMode })}
          preview={redactionPreview}
          language={language}
        />
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
              ? "从不读取正文的主机或网址（每行一个，适用于页面捕获和 Apty Client）"
              : "Never read bodies from these hosts or URL fragments, in page capture or from the Apty Client (one per line)"}
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
      </CardContent>
    </Card>
  );
}
