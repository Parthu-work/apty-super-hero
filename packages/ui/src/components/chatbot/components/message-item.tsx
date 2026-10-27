import {
  BookmarkIcon,
  CheckIcon,
  ClipboardIcon,
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
  GlobeIcon,
  ImageIcon,
  PaperclipIcon,
  RefreshCcwIcon,
  WrenchIcon,
} from "lucide-react";
import { Fragment, useMemo } from "react";
import { useTranslation } from "../../../i18n/context";
import { translatedToolName } from "../../../i18n/tool-names";
import { downloadText, timestampedFilename } from "../../../lib/download";
import { isLocalImageUrl } from "../../../lib/safe-media";
import {
  resolveScreenshotUrls,
  transformScreenshotPlaceholders,
} from "../../../lib/screenshot-utils";
import { cn } from "../../../lib/utils";
import type {
  MessageItemProps,
  UIMessage,
  UISourceUrlPart,
  UIToolPart,
} from "../../../types";
import { Action, Actions } from "../../ai-elements/actions";
import { Message, MessageContent } from "../../ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "../../ai-elements/reasoning";
import { Response } from "../../ai-elements/response";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "../../ai-elements/sources";
import { useCopiedFlag } from "../../ui/copy-button";
import { useComponentsContext } from "../context";
import { ChatErrorNotice } from "./chat-error-notice";
import { DefaultToolDisplay } from "./slots/tool-display";

/**
 * Get icon for context type
 */
function getContextIcon(contextType: string) {
  const icons: Record<string, typeof GlobeIcon> = {
    page: GlobeIcon,
    tab: FileTextIcon,
    bookmark: BookmarkIcon,
    clipboard: ClipboardIcon,
    screenshot: ImageIcon,
  };
  return icons[contextType] || FileTextIcon;
}

/**
 * Default MessageItem component
 */
export function DefaultMessageItem({
  message,
  isLast = false,
  isStreaming = false,
  onRegenerate,
  onCopy,
  formatExport,
  onOpenProviderSettings,
  className,
  ...props
}: MessageItemProps) {
  const { slots } = useComponentsContext();
  const { t } = useTranslation();

  const [copied, flashCopied] = useCopiedFlag();

  // Collect screenshot data from tool parts for placeholder resolution
  const { screenshotUidList, screenshotDataMap } = useMemo(() => {
    const uids: string[] = [];
    const dataMap = new Map<string, string>();
    for (const p of message.parts) {
      if (p.type === "tool" && p.screenshotUid) {
        uids.push(p.screenshotUid);
        if (p.screenshot) {
          dataMap.set(p.screenshotUid, p.screenshot);
        }
      }
    }
    return { screenshotUidList: uids, screenshotDataMap: dataMap };
  }, [message.parts]);

  // Filter out system messages
  if (message.role === "system") {
    return null;
  }

  // Render sources if present
  const sourceUrls = message.parts.filter(
    (part): part is UISourceUrlPart => part.type === "source-url",
  );

  const text = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");

  // The user's chips and attachments sit under their words.
  const parts =
    message.role === "user"
      ? [
          ...message.parts.filter((part) => part.type === "text"),
          ...message.parts.filter((part) => part.type !== "text"),
        ]
      : message.parts;

  return (
    <div className={cn("group/message space-y-2", className)} {...props}>
      {/* Sources */}
      {message.role === "assistant" && sourceUrls.length > 0 && (
        <Sources>
          <SourcesTrigger count={sourceUrls.length} />
          {sourceUrls.map((part, i) => (
            <SourcesContent key={`${message.id}-source-${i}`}>
              <Source href={part.url} title={part.url} />
            </SourcesContent>
          ))}
        </Sources>
      )}

      {/* Message parts */}
      {parts.map((part, i) => {
        const key = `${message.id}-${i}`;

        switch (part.type) {
          case "text": {
            // Transform [[screenshot:...]] placeholders to markdown images.
            // First resolve to special URLs, then replace with actual
            // base64 data URLs when available for inline rendering.
            let processedText = part.text;
            if (screenshotUidList.length > 0) {
              processedText = transformScreenshotPlaceholders(
                processedText,
                screenshotUidList,
              );
              processedText = resolveScreenshotUrls(
                processedText,
                screenshotDataMap,
              );
            }
            return (
              <Message
                key={key}
                from={message.role as "user" | "assistant" | "system"}
              >
                <MessageContent>
                  <Response>{processedText}</Response>
                </MessageContent>
              </Message>
            );
          }

          case "file":
            return (
              <div
                key={key}
                className={cn(
                  "flex w-full",
                  message.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                {part.mediaType.startsWith("image/") &&
                isLocalImageUrl(part.url) ? (
                  <figure className="max-w-[85%]">
                    <img
                      src={part.url}
                      alt={part.filename || t("chat.attachedImage")}
                      className="rounded-md border border-border"
                    />
                    {part.filename && (
                      <figcaption className="mt-1 text-xs text-muted-foreground">
                        {part.filename}
                      </figcaption>
                    )}
                  </figure>
                ) : (
                  <div className="flex max-w-[85%] items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
                    <PaperclipIcon
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {part.filename || t("chat.attachedFile")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {part.mediaType}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );

          case "tool":
            // Check for custom tool display slot
            return (
              <Fragment key={key}>
                {slots.toolDisplay ? (
                  slots.toolDisplay({ tool: part })
                ) : (
                  <DefaultToolDisplay tool={part} />
                )}
                {slots.toolFooter?.({ tool: part })}
              </Fragment>
            );

          case "reasoning":
            return (
              <Reasoning
                key={key}
                className="w-full"
                isStreaming={isStreaming && isLast}
              >
                <ReasoningTrigger />
                <ReasoningContent>{part.text}</ReasoningContent>
              </Reasoning>
            );

          case "context": {
            const ContextIcon = getContextIcon(part.contextType);
            return (
              <div
                key={key}
                className={cn(
                  "flex w-full",
                  message.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                <div className="flex min-w-0 max-w-[85%] items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-small">
                  <ContextIcon
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="truncate font-medium text-foreground">
                    {part.label}
                  </span>
                  {Boolean(part.metadata?.["url"]) && (
                    <span className="truncate text-xs text-muted-foreground">
                      {String(part.metadata?.["url"])}
                    </span>
                  )}
                  <span className="shrink-0 rounded-sm bg-muted px-1.5 text-xs text-muted-foreground">
                    {part.contextType}
                  </span>
                </div>
              </div>
            );
          }

          case "source-url":
            // Already handled above
            return null;

          default:
            return null;
        }
      })}
      {message.metadata?.error && (
        <ChatErrorNotice
          error={message.metadata.error}
          onRetry={isLast ? onRegenerate : undefined}
          onOpenSettings={onOpenProviderSettings}
        />
      )}
      {message.role === "assistant" && text && !(isLast && isStreaming) && (
        <div
          className={cn(
            !isLast &&
              "opacity-0 transition-opacity duration-200 group-focus-within/message:opacity-100 group-hover/message:opacity-100 motion-reduce:transition-none",
          )}
        >
          {slots.messageActions ? (
            slots.messageActions({
              message,
              isLast,
              onRegenerate: isLast ? onRegenerate : undefined,
              onCopy,
            })
          ) : (
            <Actions>
              {isLast && onRegenerate && (
                <Action onClick={onRegenerate} tooltip={t("chat.retry")}>
                  <RefreshCcwIcon aria-hidden="true" />
                </Action>
              )}
              {onCopy && (
                <Action
                  onClick={async () => {
                    const result = await onCopy(text);
                    if (result === undefined || result) flashCopied();
                  }}
                  tooltip={t(copied ? "common.copied" : "common.copy")}
                >
                  {copied ? (
                    <CheckIcon aria-hidden="true" />
                  ) : (
                    <CopyIcon aria-hidden="true" />
                  )}
                </Action>
              )}
              <Action
                onClick={() =>
                  downloadText(
                    timestampedFilename("message", "md"),
                    formatExport ? formatExport(text) : text,
                    "text/markdown",
                  )
                }
                tooltip={t("common.download")}
              >
                <DownloadIcon aria-hidden="true" />
              </Action>
            </Actions>
          )}
        </div>
      )}
    </div>
  );
}

// ============ Collapsed tool display for folded messages ============

function CollapsedToolDisplay({ tool }: { tool: UIToolPart }) {
  const { t } = useTranslation();
  const displayName = translatedToolName(t, tool.toolName);
  return (
    <div className="text-xs text-muted-foreground py-1 px-2 flex items-center gap-1.5">
      <WrenchIcon className="size-3" />
      {displayName}
    </div>
  );
}

// ============ Collapsed message item for intermediate assistant messages ============

/**
 * CollapsedMessageItem – simplified rendering for intermediate assistant
 * messages inside a folded "thinking details" section.
 * Shows text as bullet points and tools as compact single-line displays.
 */
export function CollapsedMessageItem({ message }: { message: UIMessage }) {
  const { slots } = useComponentsContext();
  return (
    <div>
      {message.parts.map((part, i) => {
        const key = `${message.id}-collapsed-${i}`;
        switch (part.type) {
          case "text":
            return (
              <div key={key} className="text-sm text-muted-foreground py-1">
                - {part.text}
              </div>
            );
          case "tool":
            return (
              <Fragment key={key}>
                <CollapsedToolDisplay tool={part} />
                {slots.toolFooter?.({ tool: part })}
              </Fragment>
            );
          case "reasoning":
            return (
              <div
                key={key}
                className="text-xs text-muted-foreground/70 py-0.5 italic"
              >
                {part.text.length > 120
                  ? `${part.text.slice(0, 120)}…`
                  : part.text}
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

/**
 * MessageItem - Renders either custom or default message item
 */
export function MessageItem(props: MessageItemProps) {
  const { components } = useComponentsContext();

  const CustomComponent = components.MessageItem;
  if (CustomComponent) {
    return <CustomComponent {...props} />;
  }

  return <DefaultMessageItem {...props} />;
}
