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
import { Fragment, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "../../../i18n/context";
import { translatedToolName } from "../../../i18n/tool-names";
import { downloadText, timestampedFilename } from "../../../lib/download";
import { kbReturnedCards, linkKbCitations } from "../../../lib/kb-citations";
import {
  markUngrounded,
  ungroundedLocations,
  ungroundedPhrases,
} from "../../../lib/kb-grounding";
import { foldQuestions } from "../../../lib/one-question";
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
import { TurnContext } from "../turn-context";
import { ChatErrorNotice } from "./chat-error-notice";
import { DefaultToolDisplay } from "./slots/tool-display";
import {
  decisionText,
  TurnDecisionDetails,
  TurnDecisionLine,
  TurnSourceChips,
} from "./turn-decision-note";

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
 * A model reply that asks several questions at its end shows the first and
 * folds the others under "More questions" (K28, F5). Nothing is removed.
 */
function OneQuestionResponse({ text, fold }: { text: string; fold: boolean }) {
  const { t } = useTranslation();
  const folded = fold ? foldQuestions(text) : undefined;
  if (!folded) return <Response>{text}</Response>;
  return (
    <>
      <Response>{folded.shown}</Response>
      <details className="group text-sm" data-testid="more-questions">
        <summary className="cursor-pointer text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {t("chat.moreQuestions", { count: folded.count })}
        </summary>
        <div className="mt-1">
          <Response>{folded.folded}</Response>
        </div>
      </details>
    </>
  );
}

/**
 * Default MessageItem component
 */
/**
 * An answer that rests on KB cards (K18): each setting-like phrase no
 * returned chunk holds is underlined, with a tooltip, and named under the
 * answer. The answer's text is never changed.
 */
function GroundedResponse({
  text,
  ungrounded,
  locations = [],
  withoutCards = false,
  fold,
}: {
  text: string;
  ungrounded: string[];
  /** K29, B6: sentences guessing where a setting might be, on a turn with no card. */
  locations?: string[];
  fold: boolean;
  /** A model turn the KB returned no card for (K27, F2): nothing it names is grounded. */
  withoutCards?: boolean;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const title = t(
    withoutCards ? "chat.kbNotFoundTitle" : "chat.kbUngroundedTitle",
  );
  const placeTitle = t("chat.kbLocationTitle");
  const key = ungrounded.join("\n");
  const placesKey = locations.join("\n");
  useEffect(() => {
    const root = ref.current;
    if (!root || (!key && !placesKey)) return;
    const phrases = key ? key.split("\n") : [];
    const places = placesKey ? placesKey.split("\n") : [];
    const mark = () => {
      markUngrounded(root, places, placeTitle);
      markUngrounded(root, phrases, title);
    };
    mark();
    const observer = new MutationObserver(mark);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [key, placesKey, title, placeTitle]);
  return (
    <>
      <div ref={ref}>
        <OneQuestionResponse text={text} fold={fold} />
      </div>
      {ungrounded.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t(withoutCards ? "chat.kbNotFound" : "chat.kbUngrounded", {
            phrases: ungrounded.join(", "),
          })}
        </p>
      )}
      {locations.length > 0 && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="kb-location-guess"
        >
          {t("chat.kbLocation")}
        </p>
      )}
    </>
  );
}

export function DefaultMessageItem({
  message,
  isLast = false,
  isStreaming = false,
  onRegenerate,
  onCopy,
  formatExport,
  onOpenProviderSettings,
  kbCards: turnKbCards,
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
  // K27, F10: a copied or downloaded reply carries its turn's record.
  const decision = message.metadata?.decision;
  const withRecord = (body: string) =>
    message.role === "assistant" && decision
      ? `${body}\n\n${decisionText(decision, t)}`
      : body;
  const copyWithRecord = onCopy
    ? (body: string) => onCopy(withRecord(body))
    : undefined;

  // K27, E7: a model turn the KB did not cover names its closest cards.
  const closestPageIds =
    message.role === "assistant" &&
    decision?.route === "model" &&
    decision.kb?.kind === "not_covered"
      ? (decision.kb.closestPageIds ?? [])
      : [];

  // The cards this turn's search_kb calls returned: the citations link to them.
  const kbCards = turnKbCards ?? kbReturnedCards(message.parts);
  // K27, F2: the model answered and no KB card came back this turn.
  // K27, E6: the model explained the checks and cards earlier in the chat.
  const explains =
    message.role === "assistant" &&
    message.metadata?.decision?.grounding === "conversation";
  const withoutCards =
    message.role === "assistant" &&
    message.metadata?.decision?.route === "model" &&
    !explains &&
    kbCards.texts.length === 0;

  // K29, D2, D4: a KB answer's card and a verdict carry their own source line and "Why this answer".
  const cardCarriesSource = message.parts.some(
    (part) =>
      part.type === "tool" &&
      ((decision?.route === "kb" && part.toolName === "search_kb") ||
        (decision?.route === "check" && part.toolName === "run_diagnosis")),
  );
  const turn = { decision, message };

  // The user's chips and attachments sit under their words.
  const parts =
    message.role === "user"
      ? [
          ...message.parts.filter((part) => part.type === "text"),
          ...message.parts.filter((part) => part.type !== "text"),
        ]
      : message.parts;

  return (
    <TurnContext.Provider value={turn}>
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

        {message.role === "assistant" && decision && !cardCarriesSource && (
          <TurnSourceChips
            decision={decision}
            kbCardsReturned={kbCards.texts.length > 0}
            explains={explains}
          />
        )}
        {message.role === "assistant" && message.metadata?.decision && (
          <TurnDecisionLine decision={message.metadata.decision} />
        )}
        {explains && text.trim() && (
          <p
            className="text-small font-medium text-muted-foreground"
            data-testid="explains-evidence"
          >
            {t("chat.explainsEvidence")}
          </p>
        )}
        {withoutCards && text.trim() && (
          <p
            className="text-small font-medium text-muted-foreground"
            data-testid="not-from-kb"
          >
            {t("chat.notFromKb")}
          </p>
        )}

        {/* Message parts */}
        {parts.map((part, i) => {
          const key = `${message.id}-${i}`;

          switch (part.type) {
            case "text": {
              // Transform [[screenshot:...]] placeholders to markdown images.
              // First resolve to special URLs, then replace with actual
              // base64 data URLs when available for inline rendering.
              let processedText =
                message.role === "assistant"
                  ? linkKbCitations(
                      part.text,
                      (pageId, layer) =>
                        t("chat.kbCitation", { pageId, layer }),
                      (pageId) => kbCards.urls.get(pageId),
                      () => t("chat.kbUnknownCitation"),
                    )
                  : part.text;
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
                    {message.role === "assistant" &&
                    (kbCards.searched || withoutCards) ? (
                      <GroundedResponse
                        text={processedText}
                        withoutCards={withoutCards}
                        fold={!(isStreaming && isLast)}
                        ungrounded={
                          isStreaming && isLast
                            ? []
                            : ungroundedPhrases(part.text, kbCards.texts)
                        }
                        locations={
                          isStreaming && isLast
                            ? []
                            : ungroundedLocations(part.text, kbCards.texts)
                        }
                      />
                    ) : message.role === "assistant" ? (
                      <OneQuestionResponse
                        text={processedText}
                        fold={!(isStreaming && isLast)}
                      />
                    ) : (
                      <Response>{processedText}</Response>
                    )}
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
        {closestPageIds.length > 0 &&
          slots.kbClosest?.({ pageIds: closestPageIds })}
        {message.role === "assistant" &&
          message.metadata?.decision &&
          slots.turnActions?.({ message, parts: message.parts })}
        {message.role === "assistant" && decision && !cardCarriesSource && (
          <TurnDecisionDetails decision={decision} />
        )}
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
                onCopy: copyWithRecord,
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
                      const result = await onCopy(withRecord(text));
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
                      formatExport
                        ? formatExport(withRecord(text))
                        : withRecord(text),
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
    </TurnContext.Provider>
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
