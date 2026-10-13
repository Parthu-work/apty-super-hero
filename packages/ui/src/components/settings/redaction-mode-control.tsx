import type { RedactionModeSetting } from "@apty/agent-core";
import { useState } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

/** Fake data shown by Preview: personal data, page context and secrets, none of it real. */
export const REDACTION_PREVIEW_SAMPLE = JSON.stringify(
  {
    page_title: "Chart for Jane Testpatient (MRN 0000000)",
    page_path: "/chart/0000000/summary",
    username: "jtestpatient",
    patientName: "Jane Testpatient",
    email: "jane.testpatient@example.test",
    authorization:
      "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJlLW5vdC1yZWFs",
    segment: "sales",
  },
  null,
  2,
);

interface ModeOption {
  value: RedactionModeSetting;
  label: string;
  description: string;
}

function modeOptions(zh: boolean): ModeOption[] {
  return zh
    ? [
        {
          value: "strict",
          label: "严格（推荐）",
          description:
            "屏蔽密钥、个人数据（姓名、用户名、邮箱、患者字段）以及页面上下文（标题、路径）。表单中键入的值完全不发送。",
        },
        {
          value: "standard",
          label: "标准",
          description:
            "屏蔽密钥和个人数据；保留页面标题和路径。表单中键入的值显示为 [masked]。",
        },
        {
          value: "off",
          label: "关闭（仅限开发）",
          description:
            "只屏蔽工具结果中可按格式识别的密钥（令牌、API 密钥、JWT、邮箱）；您键入的内容和表单值原样发送。切勿用于真实的客户或患者数据。",
        },
      ]
    : [
        {
          value: "strict",
          label: "Strict (recommended)",
          description:
            "Masks secrets, personal data (names, usernames, emails, patient fields) and page context (titles, paths). Values typed into form fields are not sent at all.",
        },
        {
          value: "standard",
          label: "Standard",
          description:
            "Masks secrets and personal data; keeps page titles and paths. Values typed into form fields are replaced with [masked].",
        },
        {
          value: "off",
          label: "Off (development only)",
          description:
            "Masks only secrets recognised by their shape (tokens, API keys, JWTs, emails) in tool results; what you type and form values are sent as they are. Never use it with real customer or patient data.",
        },
      ];
}

export interface RedactionModeControlProps {
  mode: RedactionModeSetting;
  onChange: (mode: RedactionModeSetting) => void;
  /** Redacts the preview sample in a given mode; Preview is hidden without it. */
  preview?: (text: string, mode: RedactionModeSetting) => string;
  language?: string;
}

export function RedactionModeControl({
  mode,
  onChange,
  preview,
  language,
}: RedactionModeControlProps) {
  const zh = language === "zh";
  const [previewing, setPreviewing] = useState<RedactionModeSetting | null>(
    null,
  );
  const [confirmingOff, setConfirmingOff] = useState(false);

  const choose = (next: RedactionModeSetting) => {
    if (next === mode) return;
    if (next === "off") {
      setConfirmingOff(true);
      return;
    }
    onChange(next);
  };

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">
        {zh ? "脱敏模式" : "Redaction"}
      </legend>
      <p className="text-xs text-muted-foreground">
        {zh
          ? "应用于发送给 AI 服务商、显示在侧边栏以及导出的诊断数据。"
          : "Applies to diagnostic data sent to your AI provider, shown in the side panel and exported."}
      </p>
      {modeOptions(zh).map((option) => {
        const id = `redaction-mode-${option.value}`;
        return (
          <div key={option.value} className="rounded-md border p-2">
            <div className="flex items-start gap-2">
              <input
                type="radio"
                id={id}
                name="redaction-mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => choose(option.value)}
                aria-describedby={`${id}-description`}
                className="mt-1"
              />
              <div className="flex-1">
                <label htmlFor={id} className="text-sm font-medium">
                  {option.label}
                </label>
                <p
                  id={`${id}-description`}
                  className="text-xs text-muted-foreground"
                >
                  {option.description}
                </p>
              </div>
              {preview && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-expanded={previewing === option.value}
                  aria-label={`${zh ? "预览" : "Preview"} ${option.label}`}
                  onClick={() =>
                    setPreviewing((current) =>
                      current === option.value ? null : option.value,
                    )
                  }
                >
                  {zh ? "预览" : "Preview"}
                </Button>
              )}
            </div>
            {preview && previewing === option.value && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <figure>
                  <figcaption className="text-xs font-medium">
                    {zh ? "之前（示例数据）" : "Before (sample data)"}
                  </figcaption>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2 text-[11px]">
                    {REDACTION_PREVIEW_SAMPLE}
                  </pre>
                </figure>
                <figure>
                  <figcaption className="text-xs font-medium">
                    {zh ? "之后" : "After"}: {option.label}
                  </figcaption>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2 text-[11px]">
                    {preview(REDACTION_PREVIEW_SAMPLE, option.value)}
                  </pre>
                </figure>
              </div>
            )}
          </div>
        );
      })}

      <Dialog open={confirmingOff} onOpenChange={setConfirmingOff}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {zh ? "关闭脱敏？" : "Turn redaction off?"}
            </DialogTitle>
            <DialogDescription>
              {zh
                ? "仅用于测试数据的开发工作。个人数据、页面标题和路径将不经屏蔽地发送给您的 AI 服务商并出现在导出中。基于格式的密钥脱敏仍然开启：令牌、API 密钥、JWT、Bearer 凭据和邮箱仍会被屏蔽。"
                : "Off is for development with test data only. Personal data, page titles and paths will reach your AI provider, the side panel and exports unmasked. Structural secret redaction stays on: tokens, API keys, JWTs, bearer credentials and emails are still masked."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmingOff(false)}
            >
              {zh ? "保持当前模式" : "Keep current mode"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirmingOff(false);
                onChange("off");
              }}
            >
              {zh ? "关闭脱敏" : "Turn redaction off"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </fieldset>
  );
}
