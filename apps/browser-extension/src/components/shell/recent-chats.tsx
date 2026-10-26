import {
  type ConversationData,
  conversationStorage,
} from "@apty/browser-runtime";
import { Button } from "@apty/ui/components/ui/button";
import { ConfirmDialog } from "@apty/ui/components/ui/confirm-dialog";
import { Notice } from "@apty/ui/components/ui/notice";
import { Skeleton } from "@apty/ui/components/ui/skeleton";
import { useTranslation } from "@apty/ui/i18n/context";
import { Trash2Icon } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { relativeTime } from "./relative-time";

/** Chats the menu lists before "View all" (the store keeps five). */
const RECENT_LIMIT = 5;

/** The longest chat title the delete confirmation quotes in full. */
const TITLE_LIMIT = 60;

type History =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "loaded"; conversations: ConversationData[] };

/** `title`, cut to 60 characters with an ellipsis. */
function shortTitle(title: string): string {
  return title.length > TITLE_LIMIT
    ? `${title.slice(0, TITLE_LIMIT - 1).trimEnd()}…`
    : title;
}

function HostAvatar({ host }: { host: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-4 shrink-0 items-center justify-center rounded-sm border border-border bg-muted text-xs leading-none text-muted-foreground"
    >
      {host.charAt(0)}
    </span>
  );
}

export function RecentChats({
  open,
  currentConversationId,
  caption,
  onSelect,
  onDeleted,
}: {
  /** Loads again each time the menu opens. */
  open: boolean;
  currentConversationId?: string;
  caption: (text: string) => ReactNode;
  onSelect: (conversationId: string) => void;
  onDeleted: (conversationId: string) => void;
}) {
  const { t } = useTranslation();
  const [history, setHistory] = useState<History>({ state: "loading" });
  const [showAll, setShowAll] = useState(false);
  const [deleting, setDeleting] = useState<ConversationData | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const list = useRef<HTMLElement>(null);
  const deleted = useRef(false);

  const load = useCallback(async () => {
    setHistory({ state: "loading" });
    try {
      setHistory({
        state: "loaded",
        conversations: await conversationStorage.getAllConversations(),
      });
    } catch (error) {
      console.error("❌ Failed to load conversations:", error);
      setHistory({ state: "failed" });
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const askToDelete = (conversation: ConversationData) => {
    deleted.current = false;
    setDeleting(conversation);
    setConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setPending(true);
    try {
      await conversationStorage.deleteConversation(deleting.id);
      deleted.current = true;
      onDeleted(deleting.id);
      setHistory({
        state: "loaded",
        conversations: await conversationStorage.getAllConversations(),
      });
    } catch (error) {
      console.error("❌ Failed to delete conversation:", error);
      void load();
    } finally {
      setPending(false);
      setConfirmOpen(false);
    }
  };

  if (history.state === "loading") {
    return (
      <section aria-busy="true">
        {caption(t("shell.recentChats"))}
        <span role="status" className="sr-only">
          {t("conversationHistory.loading")}
        </span>
        <ul className="space-y-1 px-3 py-1">
          {[0, 1, 2].map((row) => (
            <li key={row} className="space-y-1.5 py-1.5">
              <Skeleton className="h-4 w-3/4 animate-none" />
              <Skeleton className="h-3 w-1/3 animate-none" />
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (history.state === "failed") {
    return (
      <section>
        {caption(t("shell.recentChats"))}
        <Notice
          tone="error"
          className="mx-1"
          action={
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              {t("shell.retry")}
            </Button>
          }
        >
          {t("shell.recentChatsFailed")}
        </Notice>
      </section>
    );
  }

  const { conversations } = history;
  const shown = showAll ? conversations : conversations.slice(0, RECENT_LIMIT);

  return (
    <section ref={list} tabIndex={-1} className="outline-none">
      <div className="flex items-center justify-between pr-1">
        {caption(t("shell.recentChats"))}
        {shown.length < conversations.length && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-3"
            onClick={() => setShowAll(true)}
          >
            {t("shell.viewAll")}
          </Button>
        )}
      </div>
      {conversations.length === 0 ? (
        <p className="px-3 py-1 text-small text-muted-foreground">
          {t("conversationHistory.noHistory")}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {shown.map((conversation) => (
            <li key={conversation.id} className="group relative">
              <button
                type="button"
                aria-current={
                  conversation.id === currentConversationId ? "page" : undefined
                }
                className="flex w-full min-w-0 cursor-pointer flex-col items-start gap-0.5 rounded-md px-3 py-2 pr-11 text-left outline-none transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring aria-[current=page]:bg-accent motion-reduce:transition-none"
                onClick={() => onSelect(conversation.id)}
              >
                <span className="block w-full truncate text-sm font-medium text-foreground">
                  {conversation.title}
                </span>
                <span className="flex w-full min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  {conversation.siteHost && (
                    <HostAvatar host={conversation.siteHost} />
                  )}
                  <span className="truncate">
                    {conversation.siteHost
                      ? `${conversation.siteHost} · ${relativeTime(conversation.updatedAt, t)}`
                      : relativeTime(conversation.updatedAt, t)}
                  </span>
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${t("conversationHistory.deleteConversation")}: ${conversation.title}`}
                className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
                onClick={() => askToDelete(conversation)}
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onCloseAutoFocus={(event) => {
          if (!deleted.current) return;
          event.preventDefault();
          list.current?.focus();
        }}
        title={t("shell.deleteChatTitle")}
        description={t("shell.deleteChatDescription", {
          title: shortTitle(deleting?.title ?? ""),
        })}
        confirmLabel={t("common.delete")}
        onConfirm={() => void confirmDelete()}
        pending={pending}
      />
    </section>
  );
}
