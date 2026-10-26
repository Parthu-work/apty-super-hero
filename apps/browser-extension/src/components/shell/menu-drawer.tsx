import {
  type ConversationData,
  conversationStorage,
} from "@apty/browser-runtime";
import { Button } from "@apty/ui/components/ui/button";
import {
  Dialog,
  DialogTitle,
  DrawerContent,
} from "@apty/ui/components/ui/dialog";
import { ListRow } from "@apty/ui/components/ui/list-row";
import { useTranslation } from "@apty/ui/i18n/context";
import {
  ActivityIcon,
  CrosshairIcon,
  PlugIcon,
  ScanSearchIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  SquarePenIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { type RefObject, useCallback, useEffect, useState } from "react";
import {
  navigationStore,
  type ToolPage,
  useNavigation,
} from "../../state/navigation-store";
import { SetupBadge } from "../connections/setup-badge";
import { revealDomConfigCard } from "../investigation/dom-config/dom-config-store";
import { relativeTime } from "./relative-time";

/** Chats the menu lists before "View all" (the store keeps five). */
const RECENT_LIMIT = 5;

export interface MenuDrawerProps {
  /** Focus goes back here when the menu closes. */
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  currentConversationId?: string;
  onNewChat: () => void;
  onSelectConversation: (conversationId: string) => void;
  /** After a chat is deleted; the open one is replaced by a new chat. */
  onConversationDeleted: (conversationId: string) => void;
  /** Sends a guided prompt, as the welcome screen's suggestions do. */
  onSendPrompt: (text: string) => void;
  onOpenSettings: () => void;
  /** Warnings the Connections row's badge counts. */
  setupCount: number;
}

function Caption({ children }: { children: string }) {
  return (
    <h3 className="px-3 pt-4 pb-1 text-xs font-medium text-muted-foreground">
      {children}
    </h3>
  );
}

export function MenuDrawer({
  menuButtonRef,
  currentConversationId,
  onNewChat,
  onSelectConversation,
  onConversationDeleted,
  onSendPrompt,
  onOpenSettings,
  setupCount,
}: MenuDrawerProps) {
  const { t } = useTranslation();
  const { drawerOpen, page } = useNavigation();
  const [conversations, setConversations] = useState<ConversationData[]>([]);
  const [showAll, setShowAll] = useState(false);

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await conversationStorage.getAllConversations());
    } catch (error) {
      console.error("❌ Failed to load conversations:", error);
      setConversations([]);
    }
  }, []);

  useEffect(() => {
    if (drawerOpen) void loadConversations();
  }, [drawerOpen, loadConversations]);

  const close = () => navigationStore.closeDrawer();
  const openTool = (tool: ToolPage) => navigationStore.openPage(tool, "menu");
  const run = (action: () => void) => () => {
    close();
    action();
  };

  const handleDelete = async (conversationId: string) => {
    try {
      await conversationStorage.deleteConversation(conversationId);
      await loadConversations();
      onConversationDeleted(conversationId);
    } catch (error) {
      console.error("❌ Failed to delete conversation:", error);
    }
  };

  const shown = showAll ? conversations : conversations.slice(0, RECENT_LIMIT);

  return (
    <Dialog
      open={drawerOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DrawerContent
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          menuButtonRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">{t("shell.menu")}</DialogTitle>
        <div className="flex h-14 shrink-0 items-center px-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("shell.closeMenu")}
            onClick={close}
          >
            <XIcon />
          </Button>
        </div>
        <nav
          aria-label={t("shell.menu")}
          className="flex min-h-0 flex-1 flex-col px-2 pb-2"
        >
          <ListRow
            icon={<SquarePenIcon />}
            label={t("shell.newChat")}
            onClick={run(onNewChat)}
          />

          <Caption>{t("shell.tools")}</Caption>
          <ListRow
            icon={<ScanSearchIcon />}
            label={t("shell.domHealth")}
            aria-current={page === "dom-health" ? "page" : undefined}
            onClick={() => openTool("dom-health")}
          />
          <ListRow
            icon={<SlidersHorizontalIcon />}
            label={t("shell.domConfig")}
            aria-current={page === "dom-config" ? "page" : undefined}
            onClick={() => revealDomConfigCard("menu")}
          />
          <ListRow
            icon={<CrosshairIcon />}
            label={t("shell.selectorChecker")}
            onClick={run(() =>
              onSendPrompt(t("investigation.welcome.selectorsPrompt")),
            )}
          />
          <ListRow
            icon={<ActivityIcon />}
            label={t("shell.networkInspector")}
            onClick={run(() =>
              onSendPrompt(t("investigation.welcome.networkPrompt")),
            )}
          />

          {conversations.length > 0 && (
            <>
              <div className="flex items-center justify-between pr-1">
                <Caption>{t("shell.recentChats")}</Caption>
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
              <ul className="space-y-0.5">
                {shown.map((conversation) => (
                  <li key={conversation.id} className="group relative">
                    <button
                      type="button"
                      aria-current={
                        conversation.id === currentConversationId
                          ? "page"
                          : undefined
                      }
                      className="flex w-full min-w-0 cursor-pointer flex-col items-start rounded-md px-3 py-2 pr-11 text-left outline-none transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring aria-[current=page]:bg-accent motion-reduce:transition-none"
                      onClick={run(() => onSelectConversation(conversation.id))}
                    >
                      <span className="w-full truncate text-sm font-medium text-foreground">
                        {conversation.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {relativeTime(conversation.updatedAt, t)}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t("conversationHistory.deleteConversation")}: ${conversation.title}`}
                      className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
                      onClick={() => void handleDelete(conversation.id)}
                    >
                      <Trash2Icon />
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="mt-auto space-y-0.5 border-t border-border pt-2">
            <ListRow
              icon={<PlugIcon />}
              label={t("shell.connections")}
              trailing={<SetupBadge count={setupCount} />}
              aria-current={page === "connections" ? "page" : undefined}
              onClick={() => openTool("connections")}
            />
            <ListRow
              icon={<SettingsIcon />}
              label={t("shell.settings")}
              onClick={run(onOpenSettings)}
            />
          </div>
        </nav>
      </DrawerContent>
    </Dialog>
  );
}
