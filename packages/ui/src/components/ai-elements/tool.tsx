"use client";

import type { ToolUIPart } from "ai";
import {
  BanIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  ShieldAlertIcon,
  WrenchIcon,
} from "lucide-react";
import { type ComponentProps, useEffect, useState } from "react";
import { useTranslation } from "../../i18n/context";
import type { TranslationKey } from "../../i18n/types";
import { isLocalImageUrl } from "../../lib/safe-media";
import { ScreenshotStorage } from "../../lib/screenshot-storage";
import { cn } from "../../lib/utils";
import { StatusBadge, type StatusTone } from "../ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { CopyButton } from "../ui/copy-button";
import { Notice } from "../ui/notice";

type ToolState = ToolUIPart["state"] | "executing";

/** Each state's badge: never colour alone, always an indicator and a word. */
const TOOL_STATUS: Record<
  ToolState,
  {
    tone: StatusTone;
    indicator: "dot" | "spinner" | "icon";
    icon?: ComponentProps<typeof StatusBadge>["icon"];
    label: TranslationKey;
  }
> = {
  "input-streaming": {
    tone: "neutral",
    indicator: "dot",
    label: "chat.toolStatus.pending",
  },
  "input-available": {
    tone: "info",
    indicator: "spinner",
    label: "chat.toolStatus.running",
  },
  executing: {
    tone: "info",
    indicator: "spinner",
    label: "chat.toolStatus.running",
  },
  "approval-requested": {
    tone: "warning",
    indicator: "icon",
    icon: ShieldAlertIcon,
    label: "chat.toolStatus.approvalRequested",
  },
  "approval-responded": {
    tone: "info",
    indicator: "icon",
    icon: CheckIcon,
    label: "chat.toolStatus.approved",
  },
  "output-available": {
    tone: "success",
    indicator: "icon",
    label: "chat.toolStatus.completed",
  },
  "output-error": {
    tone: "danger",
    indicator: "icon",
    label: "chat.toolStatus.error",
  },
  "output-denied": {
    tone: "warning",
    indicator: "icon",
    icon: BanIcon,
    label: "chat.toolStatus.denied",
  },
};

type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn(
      "not-prose w-full rounded-md border border-border bg-card",
      className,
    )}
    {...props}
  />
);

type ToolHeaderProps = {
  /** The tool's translated name. */
  type: string;
  state: ToolState;
  className?: string;
};

export const ToolHeader = ({ className, type, state }: ToolHeaderProps) => {
  const { t } = useTranslation();
  const status = TOOL_STATUS[state];
  return (
    <CollapsibleTrigger
      className={cn(
        "group flex h-10 w-full items-center gap-2 rounded-md px-3 text-left outline-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      <WrenchIcon
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {type}
      </span>
      <StatusBadge
        tone={status.tone}
        indicator={status.indicator}
        icon={status.icon}
      >
        {t(status.label)}
      </StatusBadge>
      <ChevronDownIcon
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
      />
    </CollapsibleTrigger>
  );
};

export const ToolContent = ({
  className,
  ...props
}: ComponentProps<typeof CollapsibleContent>) => (
  <CollapsibleContent
    className={cn("space-y-3 border-t border-border p-3", className)}
    {...props}
  />
);

/** A caption over a mono block of at most 240 px that scrolls inside, with its own Copy. */
export const ToolBlock = ({
  caption,
  copyLabel,
  text,
}: {
  caption: string;
  copyLabel: string;
  text: string;
}) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between gap-2">
      <h4 className="text-xs font-medium text-muted-foreground">{caption}</h4>
      <CopyButton text={text} label={copyLabel} />
    </div>
    <pre
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a block that scrolls must be reachable by keyboard
      tabIndex={0}
      className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted px-3 py-2 font-mono text-small text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {text}
    </pre>
  </div>
);

export const ToolError = ({ errorText }: { errorText: string }) => (
  <Notice tone="error" className="whitespace-pre-wrap">
    {errorText}
  </Notice>
);

// ============ Screenshot Display ============

type ToolScreenshotProps = ComponentProps<"div"> & {
  /** Inline base64 screenshot data URL */
  screenshot?: string;
  /** UID referencing a screenshot stored in ScreenshotStorage (IndexedDB) */
  screenshotUid?: string;
};

/**
 * ToolScreenshot – renders a screenshot captured by a tool.
 * Supports both inline base64 data and IndexedDB uid references.
 */
export const ToolScreenshot = ({
  className,
  screenshot,
  screenshotUid,
  ...props
}: ToolScreenshotProps) => {
  const { t } = useTranslation();
  const [imageData, setImageData] = useState<string | null>(screenshot ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Prefer inline screenshot
    if (screenshot) {
      setImageData(screenshot);
      return;
    }

    // Load from IndexedDB by uid
    if (screenshotUid) {
      setLoading(true);
      setError(null);
      ScreenshotStorage.getScreenshot(screenshotUid)
        .then((data) => {
          setImageData(data);
          if (!data) setError(t("chat.screenshotNotFound"));
        })
        .catch(() => {
          setError(t("chat.screenshotLoadFailed"));
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [screenshot, screenshotUid, t]);

  if (!screenshot && !screenshotUid) return null;

  return (
    <div className={cn("space-y-1", className)} {...props}>
      <h4 className="text-xs font-medium text-muted-foreground">
        {t("chat.screenshot")}
      </h4>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ClockIcon aria-hidden="true" className="size-4" />
          <span>{t("chat.loadingScreenshot")}</span>
        </div>
      ) : error ? (
        <Notice tone="error">{error}</Notice>
      ) : isLocalImageUrl(imageData) ? (
        <img
          src={imageData}
          alt={t("chat.screenshot")}
          className="max-w-full rounded-md border border-border"
        />
      ) : null}
    </div>
  );
};
