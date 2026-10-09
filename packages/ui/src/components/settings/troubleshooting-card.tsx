import type { AppSettings } from "@apty/agent-core";
import { Bug } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

export interface TroubleshootingCardProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  language?: string;
}

export function TroubleshootingCard({
  settings,
  onChange,
  language,
}: TroubleshootingCardProps) {
  const zh = language === "zh";

  return (
    <Card id="troubleshooting" className="scroll-mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bug className="h-5 w-5" />
          {zh ? "故障排除" : "Troubleshooting"}
        </CardTitle>
        <CardDescription>
          {zh
            ? "报告问题时打开。详细日志写入扩展的开发者工具控制台，不会发送到任何地方。日志可能包含页面内容，分享前请检查。"
            : "Turn this on when reporting a problem. Detailed logs go to the extension's DevTools consoles and are never sent anywhere. They can include page content, so read them before sharing."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="verbose-logging" className="text-sm font-medium">
            {zh ? "详细日志" : "Verbose logging"}
          </Label>
          <Switch
            id="verbose-logging"
            checked={settings.verboseLogging === true}
            onCheckedChange={(checked) => onChange({ verboseLogging: checked })}
          />
        </div>
        <IgnoredRootsField settings={settings} onChange={onChange} zh={zh} />
        <div className="mt-4 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="developer-tools" className="text-sm font-medium">
              {zh ? "开发者工具" : "Developer tools"}
            </Label>
            <p className="text-xs text-muted-foreground">
              {zh
                ? "在 DOM 健康卡片中显示路由探针，用于接入新应用。"
                : "Shows the route probe in the DOM Health card, for onboarding a new application."}
            </p>
          </div>
          <Switch
            id="developer-tools"
            checked={settings.developerTools === true}
            onCheckedChange={(checked) => onChange({ developerTools: checked })}
          />
        </div>
      </CardContent>
    </Card>
  );
}

const IGNORED_ROOTS_SAVE_DELAY_MS = 500;

function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Overlay vendors differ per customer, so DOM Health's built-in exclusion list can be extended here. */
function IgnoredRootsField({
  settings,
  onChange,
  zh,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  zh: boolean;
}) {
  const [text, setText] = useState(
    (settings.domHealthIgnoredRoots ?? []).join("\n"),
  );
  const pending = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const flush = () => {
    clearTimeout(saveTimer.current);
    if (pending.current === null) return;
    onChangeRef.current({ domHealthIgnoredRoots: parseLines(pending.current) });
    pending.current = null;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: flush on unmount only
  useEffect(() => flush, []);

  return (
    <div className="mt-4 space-y-2">
      <Label htmlFor="dom-health-ignored-roots" className="text-sm font-medium">
        {zh ? "DOM 健康：忽略的页面内容" : "DOM Health: content to leave out"}
      </Label>
      <p className="text-xs text-muted-foreground">
        {zh
          ? "第三方浮层（如引导工具、聊天窗口）不属于应用本身。每行一个：id:前缀、class:前缀 或 tag:名称。"
          : "Third-party overlays (guidance tools, chat widgets) are not the application. One per line: id:prefix, class:prefix or tag:name."}
      </p>
      <Textarea
        id="dom-health-ignored-roots"
        value={text}
        placeholder={
          "id:acme-assist-\nclass:helpdesk-launcher\ntag:support-widget"
        }
        onChange={(event) => {
          setText(event.target.value);
          pending.current = event.target.value;
          clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(flush, IGNORED_ROOTS_SAVE_DELAY_MS);
        }}
        onBlur={flush}
      />
    </div>
  );
}
