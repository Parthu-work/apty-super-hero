"use client";

import type { ToolUIPart } from "ai";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "../../i18n/context";
import type { I18nContextValue } from "../../i18n/types";
import { isLocalImageUrl } from "../../lib/safe-media";
import { ScreenshotStorage } from "../../lib/screenshot-storage";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { CodeBlock } from "./code-block";

type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("not-prose mb-4 w-full rounded-md border", className)}
    {...props}
  />
);

type ToolHeaderProps = {
  /** Display label for the tool – either a raw `tool-${name}` key or a translated name */
  type: string;
  state: ToolUIPart["state"] | "executing";
  className?: string;
};

const getStatusBadge = (
  t: I18nContextValue["t"],
  status: ToolUIPart["state"] | "executing",
) => {
  const labels = {
    "input-streaming": "chat.toolStatus.pending",
    "input-available": "chat.toolStatus.running",
    executing: "chat.toolStatus.running",
    "approval-requested": "chat.toolStatus.approvalRequested",
    "approval-responded": "chat.toolStatus.approved",
    "output-available": "chat.toolStatus.completed",
    "output-error": "chat.toolStatus.error",
    "output-denied": "chat.toolStatus.denied",
  } as const;

  const icons = {
    "input-streaming": <CircleIcon className="size-4" />,
    "input-available": <ClockIcon className="size-4 animate-pulse" />,
    executing: <ClockIcon className="size-4 animate-spin" />,
    "approval-requested": <ClockIcon className="size-4 text-warning" />,
    "approval-responded": <CheckCircleIcon className="size-4 text-info" />,
    "output-available": <CheckCircleIcon className="size-4 text-success" />,
    "output-error": <XCircleIcon className="size-4 text-destructive" />,
    "output-denied": <XCircleIcon className="size-4 text-warning" />,
  } as const;

  return (
    <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
      {icons[status]}
      {t(labels[status])}
    </Badge>
  );
};

export const ToolHeader = ({
  className,
  type,
  state,
  ...props
}: ToolHeaderProps) => {
  const { t } = useTranslation();
  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center justify-between gap-4 p-3",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        <WrenchIcon className="size-4 text-muted-foreground" />
        <span className="font-medium text-sm">{type}</span>
        {getStatusBadge(t, state)}
      </div>
      <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );
};

type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className,
    )}
    {...props}
  />
);

type ToolInputProps = ComponentProps<"div"> & {
  input: ToolUIPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => {
  const { t } = useTranslation();
  return (
    <div className={cn("space-y-2 overflow-hidden p-4", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs">
        {t("chat.parameters")}
      </h4>
      <div className="rounded-md bg-muted/50">
        <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
      </div>
    </div>
  );
};

type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolUIPart["output"];
  errorText: ToolUIPart["errorText"];
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  const { t } = useTranslation();
  if (!(output || errorText)) {
    return null;
  }

  let Output = <div>{output as ReactNode}</div>;

  if (typeof output === "string") {
    Output = <CodeBlock code={output} language="json" />;
  }

  return (
    <div className={cn("space-y-2 p-4", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs">
        {t(errorText ? "chat.toolStatus.error" : "chat.result")}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText
            ? "bg-destructive-muted text-destructive"
            : "bg-muted/50 text-foreground",
        )}
      >
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};

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
    <div className={cn("space-y-2 p-4", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs">
        {t("chat.screenshot")}
      </h4>
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <ClockIcon className="size-4 animate-spin" />
          <span>{t("chat.loadingScreenshot")}</span>
        </div>
      ) : error ? (
        <div className="text-destructive text-sm">{error}</div>
      ) : isLocalImageUrl(imageData) ? (
        <img
          src={imageData}
          alt={t("chat.screenshot")}
          className="cursor-pointer rounded-md max-w-full"
        />
      ) : null}
    </div>
  );
};
