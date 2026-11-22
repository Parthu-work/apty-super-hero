"use client";

import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode, RefObject } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "../../i18n/context";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

/** Within this many pixels of the bottom, the chat follows a new message. */
const FOLLOW_PX = 48;
/** How long what the SE clicked stays put after the content first changes. */
const KEEP_MS = 1500;
/** A click whose change has not rendered within this long is let go. */
const RENDER_MS = 5_000;
/** What a click keeps in place: the control itself, else its turn. */
const KEEPABLE =
  'button, a, summary, input, label, select, [role="button"], [role="tab"], [role="menuitem"]';

interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

function distanceFromBottom(m: ScrollMetrics): number {
  return Math.max(0, m.scrollHeight - m.scrollTop - m.clientHeight);
}

function isNearBottom(m: ScrollMetrics): boolean {
  return distanceFromBottom(m) <= FOLLOW_PX;
}

interface Anchor {
  el: Element;
  fallback?: Element;
  top: number;
  /** Until the first change renders: when the click was; then when it lets go. */
  until: number;
  applied: boolean;
}

interface ConversationScroll {
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  /** More than the reading slack from the bottom: Scroll to bottom is offered. */
  away: boolean;
  scrollToBottom: () => void;
  /** Keeps `el` at its screen position through the next content change. */
  keepInPlace: (el: Element) => void;
  realign: (ifChanged?: boolean) => void;
}

const ConversationContext = createContext<ConversationScroll | null>(null);

export function useConversationScroll(): ConversationScroll {
  const scroll = useContext(ConversationContext);
  if (!scroll) {
    throw new Error("useConversationScroll is used outside a Conversation");
  }
  return scroll;
}

/**
 * The chat's scroll engine (KB-RAG K29, L3). One element scrolls. When the
 * content or the scroller changes size, in the same frame, before paint:
 * what the SE just clicked stays where it was; otherwise, if the SE was
 * within 48 px of the bottom, the chat follows the new message; otherwise
 * the element at the top of the view stays where it was. Nothing is
 * animated, and nothing scrolls for a change the SE made.
 */
function useScrollEngine(resetKey: unknown) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [away, setAway] = useState(false);
  const engine = useRef({
    near: true,
    anchor: null as Anchor | null,
    reading: null as { el: Element; top: number; at: number } | null,
    expected: null as number | null,
    scrollHeight: 0,
    clientHeight: 0,
  });

  const topOf = useCallback((el: Element) => {
    const scroller = scrollRef.current;
    if (!scroller) return 0;
    return (
      el.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    );
  }, []);

  const setTop = useCallback((value: number) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    scroller.scrollTop = value;
    engine.current.expected = scroller.scrollTop;
  }, []);

  /**
   * Whether the SE is within 48 px of the bottom. A scroll event can arrive
   * in the frame that grew the content, before the resize is handled, so
   * on scroll the sizes from the last settle are used: a scroll by the SE
   * never changes them, and a new message must not count as scrolling up.
   */
  const settle = useCallback((onScroll = false) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const state = engine.current;
    if (!onScroll) {
      state.scrollHeight = scroller.scrollHeight;
      state.clientHeight = scroller.clientHeight;
    }
    const near = isNearBottom({
      scrollTop: scroller.scrollTop,
      scrollHeight: state.scrollHeight,
      clientHeight: state.clientHeight,
    });
    state.near = near;
    setAway(!near);
  }, []);

  const readAnchor = useCallback(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const box = scroller.getBoundingClientRect();
    const hit = document.elementFromPoint?.(box.left + 24, box.top + 4);
    let el: Element | null | undefined =
      hit && hit !== content && content.contains(hit) ? hit : undefined;
    el ??= [...content.children].find(
      (child) => child.getBoundingClientRect().bottom > box.top,
    );
    engine.current.reading = el
      ? { el, top: topOf(el), at: scroller.scrollTop }
      : null;
  }, [topOf]);

  const scrollToBottom = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    engine.current.anchor = null;
    setTop(scroller.scrollHeight);
    settle();
    readAnchor();
  }, [setTop, settle, readAnchor]);

  const keepInPlace = useCallback(
    (el: Element) => {
      engine.current.anchor = {
        el,
        top: topOf(el),
        until: performance.now() + RENDER_MS,
        applied: false,
      };
    },
    [topOf],
  );

  /**
   * After the content or the scroller changed size: keep what the SE
   * clicked in place, else follow the bottom when they were near it, else
   * keep the top of the view in place. With `ifChanged`, after a render,
   * only when a size changed (a hidden panel gets no resize callbacks).
   */
  const realign = useCallback(
    (ifChanged = false) => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      const state = engine.current;
      if (
        ifChanged &&
        scroller.scrollHeight === state.scrollHeight &&
        scroller.clientHeight === state.clientHeight
      ) {
        return;
      }
      const anchor = state.anchor;
      const kept =
        anchor && performance.now() < anchor.until
          ? anchor.el.isConnected
            ? { el: anchor.el, top: anchor.top }
            : anchor.fallback?.isConnected
              ? { el: anchor.fallback, top: anchor.top }
              : null
          : null;
      if (!kept) state.anchor = null;
      else if (anchor && !anchor.applied) {
        anchor.applied = true;
        anchor.until = performance.now() + KEEP_MS;
      }
      // Where the SE was before this change: their position against the
      // sizes from the last settle, whether or not its scroll event came.
      if (state.scrollHeight > 0) {
        state.near = isNearBottom({
          scrollTop: scroller.scrollTop,
          scrollHeight: state.scrollHeight,
          clientHeight: state.clientHeight,
        });
      }
      const reading =
        state.reading?.at === scroller.scrollTop ? state.reading : null;
      const hold = kept ?? (state.near ? null : reading);
      if (hold?.el.isConnected) {
        const moved = topOf(hold.el) - hold.top;
        if (Math.abs(moved) >= 0.5) setTop(scroller.scrollTop + moved);
      } else if (state.near) {
        setTop(scroller.scrollHeight);
      }
      settle();
      readAnchor();
    },
    [settle, readAnchor, setTop, topOf],
  );

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return undefined;
    const state = engine.current;

    const onScroll = () => {
      const programmatic =
        state.expected !== null &&
        Math.abs(scroller.scrollTop - state.expected) < 1;
      state.expected = null;
      if (!programmatic) state.anchor = null;
      settle(true);
      readAnchor();
    };

    const onClick = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      const control = target?.closest(KEEPABLE);
      if (!control || !content.contains(control)) return;
      const turn =
        control.closest("[data-scroll-anchor]") ??
        [...content.children].find((child) => child.contains(control));
      state.anchor = {
        el: control,
        ...(turn ? { fallback: turn } : {}),
        top: topOf(control),
        until: performance.now() + RENDER_MS,
        applied: false,
      };
    };

    const observer = new ResizeObserver(() => realign());
    observer.observe(scroller);
    observer.observe(content);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    content.addEventListener("click", onClick, true);
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      content.removeEventListener("click", onClick, true);
    };
  }, [settle, readAnchor, topOf, realign]);

  // A new chat opens at its latest message.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the chat changes.
  useLayoutEffect(() => {
    engine.current.near = true;
    engine.current.anchor = null;
    scrollToBottom();
  }, [resetKey, scrollToBottom]);

  return useMemo(
    () => ({
      scrollRef,
      contentRef,
      away,
      scrollToBottom,
      keepInPlace,
      realign,
    }),
    [away, scrollToBottom, keepInPlace, realign],
  );
}

type ConversationProps = ComponentProps<"div"> & {
  /** Changes when another chat is shown; it opens at the bottom. */
  resetKey?: unknown;
  children?: ReactNode;
};

/**
 * The chat's one scroll area (KB-RAG K29, L1 and L3): a log whose only
 * scrolling element is its scroller; the scroll button sits beside it.
 */
export const Conversation = ({
  className,
  resetKey,
  children,
  ...props
}: ConversationProps) => {
  const scroll = useScrollEngine(resetKey);
  return (
    <ConversationContext.Provider value={scroll}>
      <div
        className={cn("relative min-h-0 flex-1 overflow-hidden", className)}
        role="log"
        {...props}
      >
        {children}
      </div>
    </ConversationContext.Provider>
  );
};

type ConversationContentProps = ComponentProps<"div"> & {
  scrollClassName?: string;
};

export const ConversationContent = ({
  className,
  scrollClassName,
  ...props
}: ConversationContentProps) => {
  const { scrollRef, contentRef, realign } = useConversationScroll();
  useLayoutEffect(() => realign(true));
  return (
    <div
      ref={scrollRef}
      className={cn(
        "h-full w-full overflow-y-auto [overflow-anchor:none]",
        scrollClassName,
      )}
    >
      <div ref={contentRef} className={cn("p-4", className)} {...props} />
    </div>
  );
};

type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { t } = useTranslation();
  const { away, scrollToBottom } = useConversationScroll();

  return (
    away && (
      <Button
        aria-label={t("chat.scrollToBottom")}
        className={cn(
          "absolute bottom-4 left-[50%] translate-x-[-50%] shadow-sm",
          className,
        )}
        onClick={scrollToBottom}
        size="icon-sm"
        type="button"
        variant="secondary"
        {...props}
      >
        <ArrowDownIcon aria-hidden="true" className="size-4" />
      </Button>
    )
  );
};
