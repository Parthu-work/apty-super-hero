import type { AppSettings } from "@apty/agent-core";
import { SettingsPage } from "@apty/ui";
import { I18nProvider } from "@apty/ui/i18n/context";
import type { Language } from "@apty/ui/i18n/types";
import { ThemeProvider } from "@apty/ui/theme/context";
import type { Theme } from "@apty/ui/theme/types";
import { ChromeStorageAdapter } from "@apty/browser-runtime";
import type { LanguageModel } from "ai";
import { generateText } from "ai";
import React, { useCallback, useMemo } from "react";
import ReactDOM from "react-dom/client";
import { chromeStorageAdapter } from "../../hooks";
import {
  createAIProvider,
  describeConnectionTestError,
} from "../../lib/ai-provider";
import { AptyClientPanel } from "./apty-client-panel";
import { McpBridgePanel } from "./mcp-bridge-panel";
import { SkillsOptionsTab } from "./skills-tab";

/** Parse and validate URL params for deep-linking. */
function parseUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const tabAllowlist = new Set(["general", "ai", "skills", "connection"]);
  const rawTab = params.get("tab");
  const tab =
    rawTab && tabAllowlist.has(rawTab)
      ? (rawTab as "general" | "ai" | "skills" | "connection")
      : undefined;
  const rawSkill = params.get("skill");
  // Bound skill name length to prevent abuse
  const skill = rawSkill ? rawSkill.slice(0, 200) : undefined;
  return { tab, skill };
}

import "../../styles/tailwind.css";

const i18nStorageAdapter = new ChromeStorageAdapter<Language>();
const themeStorageAdapter = new ChromeStorageAdapter<Theme>();

function OptionsPageContent() {
  const { tab: initialTab, skill: initialSkill } = useMemo(parseUrlParams, []);

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
      });
      return true;
    } catch (error) {
      // Re-throw with a sanitized message (never the raw error, which some
      // providers' SDKs attach request/response bodies to) so the settings
      // UI's existing catch block can show *why* the connection failed
      // instead of a generic "Connection test failed".
      console.error("Connection test failed:", error);
      throw new Error(describeConnectionTestError(error));
    }
  }, []);

  return (
    <SettingsPage
      storageAdapter={chromeStorageAdapter}
      onTestConnection={handleTestConnection}
      skillsContent={<SkillsOptionsTab initialSkill={initialSkill} />}
      connectionContent={
        <div className="space-y-6">
          <AptyClientPanel />
          <McpBridgePanel />
        </div>
      }
      initialTab={initialTab}
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
