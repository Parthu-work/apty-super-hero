import { StatusBadge } from "@apty/ui/components/ui/badge";
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
  FileSearchIcon,
  PlugIcon,
  ScanSearchIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import type { RefObject } from "react";
import {
  navigationStore,
  type ToolPage,
  useNavigation,
} from "../../state/navigation-store";
import { SetupBadge } from "../connections/setup-badge";
import {
  openDomConfigPage,
  useDomConfigState,
} from "../investigation/dom-config/dom-config-store";
import { useDomHealthState } from "../investigation/dom-health-store";
import { domConfigStatus, domHealthStatus, type JobStatus } from "./job-status";
import { RecentChats } from "./recent-chats";

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

function JobStatusBadge({ status }: { status: JobStatus }) {
  return (
    <StatusBadge
      tone={status.tone}
      indicator={status.running ? "spinner" : undefined}
    >
      {status.label}
    </StatusBadge>
  );
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
  const health = useDomHealthState();
  const config = useDomConfigState();

  const close = () => navigationStore.closeDrawer();
  const openTool = (tool: ToolPage) => navigationStore.openPage(tool, "menu");
  const run = (action: () => void) => () => {
    close();
    action();
  };

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
            trailing={<JobStatusBadge status={domHealthStatus(health, t)} />}
            aria-current={page === "dom-health" ? "page" : undefined}
            onClick={() => openTool("dom-health")}
          />
          <ListRow
            icon={<SlidersHorizontalIcon />}
            label={t("shell.domConfig")}
            trailing={<JobStatusBadge status={domConfigStatus(config, t)} />}
            aria-current={page === "dom-config" ? "page" : undefined}
            onClick={() => openDomConfigPage("menu")}
          />
          <ListRow
            icon={<FileSearchIcon />}
            label={t("shell.harCheck")}
            aria-current={page === "har-check" ? "page" : undefined}
            onClick={() => openTool("har-check")}
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

          <RecentChats
            open={drawerOpen}
            currentConversationId={currentConversationId}
            caption={(text) => <Caption>{text}</Caption>}
            onSelect={(conversationId) => {
              close();
              onSelectConversation(conversationId);
            }}
            onDeleted={onConversationDeleted}
          />

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
