import type { AppSettings } from "@apty/agent-core";
import { ChromeStorageAdapter } from "@apty/browser-runtime";
import { SettingsPage } from "@apty/ui";
import { I18nProvider } from "@apty/ui/i18n/context";
import type { Language } from "@apty/ui/i18n/types";
import { ThemeProvider } from "@apty/ui/theme/context";
import type { Theme } from "@apty/ui/theme/types";
import type { LanguageModel } from "ai";
import { generateText } from "ai";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { chromeStorageAdapter } from "../../hooks";
import { initLogging } from "../../lib/logging";
import type { OptionsTab } from "../../lib/open-options";
import {
  createAIProvider,
  describeConnectionTestError,
} from "../../services/ai-provider";
import { ApprovalGrantsPanel } from "./approval-grants-panel";
import { AptyClientPanel } from "./apty-client-panel";
import { McpBridgePanel } from "./mcp-bridge-panel";
import { PermissionsPanel } from "./permissions-panel";
import { SkillsOptionsTab } from "./skills-tab";
import { StoredDataPanel } from "./stored-data-panel";

const TABS = new Set<OptionsTab>(["general", "ai", "skills", "connection"]);

function tabFromUrl(): OptionsTab | undefined {
  const raw = new URLSearchParams(window.location.search).get("tab");
  return raw && TABS.has(raw as OptionsTab) ? (raw as OptionsTab) : undefined;
}

/**
 * Keep the selected tab in the URL, so reload, Back and Forward work and
 * any page can link to a tab and section (`?tab=connection#apty-client`).
 */
function useUrlTab(): [OptionsTab, (tab: OptionsTab) => void] {
  const [tab, setTab] = useState<OptionsTab>(() => tabFromUrl() ?? "general");
  useEffect(() => {
    const onPopState = () => setTab(tabFromUrl() ?? "general");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const select = useCallback((next: OptionsTab) => {
    setTab(next);
    if (next !== tabFromUrl()) {
      window.history.pushState(null, "", `?tab=${next}`);
    }
  }, []);
  return [tab, select];
}

/** On load, scroll to and briefly highlight the section named in the URL hash. */
function useScrollToHashSection() {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const frame = requestAnimationFrame(() => {
      const section = document.getElementById(id);
      if (!section) return;
      section.scrollIntoView({ block: "start" });
      section.classList.add("ring-2", "ring-primary");
      setTimeout(
        () => section.classList.remove("ring-2", "ring-primary"),
        2000,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, []);
}

/** Parse and validate URL params for deep-linking. */
function parseUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const rawSkill = params.get("skill");
  // Bound skill name length to prevent abuse
  const skill = rawSkill ? rawSkill.slice(0, 200) : undefined;
  return { skill };
}

import "../../styles/tailwind.css";

initLogging();

const i18nStorageAdapter = new ChromeStorageAdapter<Language>();
const themeStorageAdapter = new ChromeStorageAdapter<Theme>();

function OptionsPageContent() {
  const { skill: initialSkill } = useMemo(parseUrlParams, []);
  const [tab, setTab] = useUrlTab();
  useScrollToHashSection();

  const TEST_CONNECTION_TIMEOUT_MS = 20_000;

  const handleTestConnection = useCallback(async (settings: AppSettings) => {
    const modelId = settings.aiModel;
    if (!modelId) {
      throw new Error("No model selected. Choose a model for this provider.");
    }

    const provider = createAIProvider(settings);

    try {
      await generateText({
        model: provider(modelId) as LanguageModel,
        prompt: "Hi",
        // Without this, a request to an unreachable or misconfigured host
        // (e.g. a website URL typed into "AI Host" instead of an API
        // endpoint) can hang indefinitely with no error and no way for the
        // "Test connection" button to ever stop spinning. maxRetries: 0
        // so a test fails fast and clearly instead of silently retrying.
        timeout: TEST_CONNECTION_TIMEOUT_MS,
        maxRetries: 0,
      });
      return true;
    } catch (error) {
      // Re-throw with a sanitized message (never the raw error, which some
      // providers' SDKs attach request/response bodies to) so the settings
      // UI's existing catch block can show *why* the connection failed
      // instead of a generic "Connection test failed".
      console.error("Connection test failed:", error);
      const isAbort =
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError");
      if (isAbort) {
        throw new Error(
          `Connection test timed out after ${TEST_CONNECTION_TIMEOUT_MS / 1000}s — the host may be unreachable, or this provider's "AI Host" field may be set to the wrong URL (a website instead of an API endpoint).`,
        );
      }
      throw new Error(describeConnectionTestError(error));
    }
  }, []);

  return (
    <SettingsPage
      storageAdapter={chromeStorageAdapter}
      onTestConnection={handleTestConnection}
      skillsContent={<SkillsOptionsTab initialSkill={initialSkill} />}
      permissionsContent={
        <div className="space-y-6">
          <PermissionsPanel />
          <ApprovalGrantsPanel />
          <StoredDataPanel />
        </div>
      }
      connectionContent={
        <div className="space-y-6">
          <AptyClientPanel />
          <McpBridgePanel />
        </div>
      }
      activeTab={tab}
      onTabChange={setTab}
      initialSkill={initialSkill}
    />
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <I18nProvider storageAdapter={i18nStorageAdapter}>
        <ThemeProvider storageAdapter={themeStorageAdapter}>
          <OptionsPageContent />
        </ThemeProvider>
      </I18nProvider>
    </React.StrictMode>,
  );
}
