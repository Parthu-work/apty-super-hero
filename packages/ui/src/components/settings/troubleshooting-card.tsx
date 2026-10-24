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
        <LineListField
          settingKey="domHealthIgnoredRoots"
          id="dom-health-ignored-roots"
          label={
            zh ? "DOM 健康：忽略的页面内容" : "DOM Health: content to leave out"
          }
          description={
            zh
              ? "第三方浮层（如引导工具、聊天窗口）不属于应用本身。每行一个：id:前缀、class:前缀 或 tag:名称。"
              : "Third-party overlays (guidance tools, chat widgets) are not the application. One per line: id:prefix, class:prefix or tag:name."
          }
          placeholder={
            "id:acme-assist-\nclass:helpdesk-launcher\ntag:support-widget"
          }
          settings={settings}
          onChange={onChange}
        />
        <div className="mt-4 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="page-hooks" className="text-sm font-medium">
              {zh
                ? "跟踪客户端路由并从页面加载开始捕获控制台输出"
                : "Track client-side routing and capture console output from page load"}
            </Label>
            <p className="text-xs text-muted-foreground">
              {zh
                ? "在每个页面中运行一个小脚本，包装 history.pushState 并缓存控制台输出。页面可以察觉到它。关闭后，控制台日志只能从您询问时开始，DOM 健康无法测量路由。"
                : "Runs a small script in each page that wraps history.pushState and buffers console output. Pages can notice it. Off: console logs start only when you ask, and DOM Health cannot measure routing."}
            </p>
          </div>
          <Switch
            id="page-hooks"
            checked={settings.pageHooksEnabled !== false}
            onCheckedChange={(checked) =>
              onChange({ pageHooksEnabled: checked })
            }
          />
        </div>
        {settings.pageHooksEnabled !== false && (
          <LineListField
            settingKey="pageHooksExcludedSites"
            id="page-hooks-excluded-sites"
            label={
              zh ? "不运行该脚本的网站" : "Sites where that script never runs"
            }
            description={
              zh
                ? "每行一个主机（包括其子域名）或匹配模式。新加载的页面生效；已打开的标签页需要重新加载。"
                : "One host (its subdomains included) or match pattern per line. Applies to pages loaded after the change; reload tabs that are already open."
            }
            placeholder={"bank.example.com\nhttps://*.example.org/admin/*"}
            settings={settings}
            onChange={onChange}
          />
        )}
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
        {settings.developerTools === true && (
          <ThresholdOverridesField
            settings={settings}
            onChange={onChange}
            zh={zh}
          />
        )}
      </CardContent>
    </Card>
  );
}

const LINES_SAVE_DELAY_MS = 500;

/**
 * `{"name": number, ...}`, or null when the text is anything else. Empty text is no overrides.
 * @internal
 */
export function parseThresholdOverrides(
  text: string,
): Record<string, number> | null {
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const entries = Object.entries(parsed);
  return entries.every(
    ([, value]) => typeof value === "number" && Number.isFinite(value),
  )
    ? Object.fromEntries(entries)
    : null;
}

/** Developer-only: DOM Health thresholds to try while collecting real-tenant bundles. Names and ranges are checked when an audit runs, and every override is listed in its result. */
function ThresholdOverridesField({
  settings,
  onChange,
  zh,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  zh: boolean;
}) {
  const saved = settings.domHealthThresholdOverrides;
  const [text, setText] = useState(
    saved && Object.keys(saved).length > 0
      ? JSON.stringify(saved, null, 2)
      : "",
  );
  const [invalid, setInvalid] = useState(false);

  const save = () => {
    const overrides = parseThresholdOverrides(text);
    setInvalid(overrides === null);
    if (overrides !== null)
      onChange({ domHealthThresholdOverrides: overrides });
  };

  return (
    <div className="mt-4 space-y-2">
      <Label
        htmlFor="dom-health-threshold-overrides"
        className="text-sm font-medium"
      >
        {zh
          ? "DOM 健康：阈值覆盖（JSON）"
          : "DOM Health: threshold overrides (JSON)"}
      </Label>
      <p className="text-xs text-muted-foreground">
        {zh
          ? "仅用于在真实租户上验证。名称和范围在审计运行时检查；每个生效的覆盖都会列在结果和验证包中。留空使用默认值。"
          : "For real-tenant validation only. Names and ranges are checked when an audit runs; every override in effect is listed in the result and the validation bundle. Leave empty for the defaults."}
      </p>
      <Textarea
        id="dom-health-threshold-overrides"
        value={text}
        placeholder={'{ "sameUrlRatioForClickFirst": 0.4 }'}
        aria-invalid={invalid}
        onChange={(event) => setText(event.target.value)}
        onBlur={save}
        className="font-mono text-xs"
      />
      {invalid && (
        <p role="alert" className="text-xs text-destructive">
          {zh
            ? "需要一个 JSON 对象，值均为数字。未保存。"
            : "Needs a JSON object whose values are all numbers. Not saved."}
        </p>
      )}
    </div>
  );
}

type LineListKey = "domHealthIgnoredRoots" | "pageHooksExcludedSites";

function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** A one-entry-per-line setting, saved once typing pauses or the field loses focus. */
function LineListField({
  settingKey,
  id,
  label,
  description,
  placeholder,
  settings,
  onChange,
}: {
  settingKey: LineListKey;
  id: string;
  label: string;
  description: string;
  placeholder: string;
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) {
  const [text, setText] = useState((settings[settingKey] ?? []).join("\n"));
  const pending = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const flush = () => {
    clearTimeout(saveTimer.current);
    if (pending.current === null) return;
    onChangeRef.current({ [settingKey]: parseLines(pending.current) });
    pending.current = null;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: flush on unmount only
  useEffect(() => flush, []);

  return (
    <div className="mt-4 space-y-2">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <p className="text-xs text-muted-foreground">{description}</p>
      <Textarea
        id={id}
        value={text}
        placeholder={placeholder}
        onChange={(event) => {
          setText(event.target.value);
          pending.current = event.target.value;
          clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(flush, LINES_SAVE_DELAY_MS);
        }}
        onBlur={flush}
      />
    </div>
  );
}
