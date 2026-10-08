/**
 * Browser Extension App Root
 * Simple wrapper using browser-specific hooks
 */

import { ChromeStorageAdapter } from "@apty/browser-runtime";
import { useAgent, useChatConfig } from "@apty/ui";
import ChatBot from "@apty/ui/components/chatbot";
import { ErrorBoundary } from "@apty/ui/components/error/ErrorBoundary";
import type { InterventionMode } from "@apty/ui/components/intervention";
import { I18nProvider } from "@apty/ui/i18n/context";
import type { Language } from "@apty/ui/i18n/types";
import { ThemeProvider } from "@apty/ui/theme/context";
import type { Theme } from "@apty/ui/theme/types";
import type { AuthCheckResult } from "@apty/ui/types";
import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { AGENT_ACTIVITY_REQUEST } from "../entrypoints/content/agent-activity";
import { chromeStorageAdapter } from "../hooks";
import {
  BROWSER_AGENT_CONFIG,
  useBrowserContextProviders,
  useBrowserModelFactory,
  useBrowserStorage,
  useBrowserTools,
  useSelectRelevantTools,
} from "../hooks/browser-agent-config";
import { openOptions } from "../lib/open-options";
import { isProviderConfigured } from "../services/ai-provider";
import { resolveConversationRunContext } from "../services/conversation-tab-binding";
import { InputModeProvider } from "../state/input-mode-context";
import { InterventionModeProvider } from "../state/intervention-mode-context";
import { ApprovalPrompt } from "./approval-prompt";
import { AutomationModeInputToolbar } from "./automation-mode-toolbar";
import { BrowserChatHeader } from "./browser-chat-header";
import { BrowserChatInputArea } from "./browser-chat-input-area";
import { BrowserContextLoader } from "./browser-context-loader";
import { BrowserMessageActions } from "./browser-message-actions";
import { BrowserMessageList } from "./browser-message-list";
import { ChatImagesListener } from "./chat-images-listener";
import { InterventionUI } from "./intervention-ui";
import {
  AptyToolDisplay,
  AptyToolFooter,
} from "./investigation/apty-tool-display";
import { DebuggingWelcomeScreen } from "./investigation/debugging-welcome-screen";
import { DomHealthCard } from "./investigation/dom-health-card";
import { InvestigationSummaryBar } from "./investigation/investigation-summary-bar";
import { ReadinessCheck } from "./readiness-check";
import { SetupNeededCard } from "./setup-needed-card";

const i18nStorageAdapter = new ChromeStorageAdapter<Language>();
const themeStorageAdapter = new ChromeStorageAdapter<Theme>();

/**
 * While the AI is generating, tells the active tab every few seconds so its
 * content script shows the breathing border. Content scripts can't read
 * extension storage, so the panel messages the tab directly.
 */
function useConversationHeartbeat() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTabRef = useRef<number | null>(null);

  const notify = useCallback((tabId: number, active: boolean) => {
    chrome.tabs
      .sendMessage(
        tabId,
        { request: AGENT_ACTIVITY_REQUEST, active },
        { frameId: 0 },
      )
      .catch(() => {});
  }, []);

  const start = useCallback(() => {
    if (intervalRef.current) return;

    const tick = async () => {
      const [tab] = await chrome.tabs
        .query({ active: true, currentWindow: true })
        .catch(() => []);
      if (tab?.id === undefined) return;
      if (lastTabRef.current !== null && lastTabRef.current !== tab.id) {
        notify(lastTabRef.current, false);
      }
      lastTabRef.current = tab.id;
      notify(tab.id, true);
    };
    void tick();
    intervalRef.current = setInterval(tick, 2000);
  }, [notify]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (lastTabRef.current !== null) {
      notify(lastTabRef.current, false);
      lastTabRef.current = null;
    }
  }, [notify]);

  useEffect(() => stop, [stop]);

  return { start, stop };
}

/**
 * Pre-flight configuration check.
 *
 * Apty's agent is BYOK-only: there is no external login/proxy fallback, so
 * a message can only be sent once a provider + API key are configured.
 */
async function checkAuth(
  settings: ReturnType<typeof useChatConfig>["settings"],
): Promise<AuthCheckResult> {
  if (isProviderConfigured(settings)) {
    return { needsAuth: false, hasCustomConfig: true };
  }
  return { needsAuth: true, hasCustomConfig: false };
}

function ChatApp() {
  const { settings, isLoading } = useChatConfig({
    storageAdapter: chromeStorageAdapter,
    autoLoad: true,
  });

  const storage = useBrowserStorage();
  const modelFactory = useBrowserModelFactory();
  const contextProviders = useBrowserContextProviders();
  const tools = useBrowserTools();
  const selectTools = useSelectRelevantTools();

  const { agent, error } = useAgent({
    settings,
    isLoading,
    modelFactory,
    storage,
    contextProviders,
    tools,
    ...BROWSER_AGENT_CONFIG,
  });

  const heartbeat = useConversationHeartbeat();

  // Keep a ref to settings so the auth check always sees latest values
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const handleCheckAuth = useCallback(() => checkAuth(settingsRef.current), []);

  // First-run / not-configured dead end: instead of injecting messages into
  // the conversation, show one dismissible setup card that carries the
  // draft the user tried to send.
  const [authDraft, setAuthDraft] = useState<string | null>(null);
  const handleNeedsAuth = useCallback((draftText: string) => {
    setAuthDraft(draftText);
  }, []);
  const handleOpenSettingsFromSetupCard = useCallback(() => {
    void openOptions({ section: "ai-provider" });
  }, []);
  useEffect(() => {
    if (authDraft !== null && isProviderConfigured(settings)) {
      setAuthDraft(null);
    }
  }, [authDraft, settings]);

  const handleStatusChange = useCallback(
    (status: string) => {
      if (status === "streaming" || status === "submitted") {
        heartbeat.start();
      } else {
        heartbeat.stop();
      }
    },
    [heartbeat],
  );

  const [interventionMode, setInterventionMode] =
    useState<InterventionMode>("passive");

  // Sidepanel lifecycle: port connection + cleanup on hide/close
  useEffect(() => {
    // Long-lived port so the background can detect sidepanel disconnect
    const port = chrome.runtime.connect({ name: "sidepanel" });

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Stop any active recording
        chrome.runtime.sendMessage({ request: "stop-recording" }).catch(() => {
          /* background may be busy */
        });
        // Stop element capture on the active tab
        chrome.runtime
          .sendMessage({
            request: "relay-to-active-tab",
            message: { request: "stop-capture" },
          })
          .catch(() => {
            /* tab may be closed */
          });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      port.disconnect();
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <InputModeProvider>
      <InterventionModeProvider
        mode={interventionMode}
        setMode={setInterventionMode}
      >
        <ChatBot
          agent={agent}
          configError={error}
          initialSettings={settings}
          storageAdapter={chromeStorageAdapter}
          config={{
            getRunContext: resolveConversationRunContext,
            selectTools,
          }}
          handlers={{
            onStatusChange: handleStatusChange,
            checkAuthBeforeSend: handleCheckAuth,
            onNeedsAuth: handleNeedsAuth,
          }}
          components={{
            Header: BrowserChatHeader,
            MessageList: BrowserMessageList,
            InputArea: BrowserChatInputArea,
          }}
          slots={{
            beforeMessages: () =>
              authDraft !== null ? (
                <SetupNeededCard
                  draftText={authDraft}
                  onOpenSettings={handleOpenSettingsFromSetupCard}
                  onDismiss={() => setAuthDraft(null)}
                />
              ) : null,
            afterMessages: () => (
              <>
                <InterventionUI
                  mode={interventionMode}
                  onModeChange={setInterventionMode}
                />
                <ChatImagesListener />
              </>
            ),
            messageActions: (props) => <BrowserMessageActions {...props} />,
            inputToolbar: (props) => <AutomationModeInputToolbar {...props} />,
            promptExtras: () => (
              <>
                <ApprovalPrompt />
                <InvestigationSummaryBar />
                <DomHealthCard />
                <BrowserContextLoader />
              </>
            ),
            emptyState: (props) => (
              <DebuggingWelcomeScreen
                {...props}
                readiness={<ReadinessCheck settings={settings} />}
              />
            ),
            toolDisplay: (props) => <AptyToolDisplay {...props} />,
            toolFooter: (props) => <AptyToolFooter {...props} />,
          }}
        />
      </InterventionModeProvider>
    </InputModeProvider>
  );
}

export function renderChatApp() {
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    return;
  }

  const App = () => (
    <ErrorBoundary>
      <I18nProvider storageAdapter={i18nStorageAdapter}>
        <ThemeProvider storageAdapter={themeStorageAdapter}>
          <ChatApp />
        </ThemeProvider>
      </I18nProvider>
    </ErrorBoundary>
  );

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
