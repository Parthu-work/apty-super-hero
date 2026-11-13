import {
  type AppSettings,
  KB_PACK_SOURCE_VERSIONS,
  type KbAptyVersion,
  kbPackManaged,
  kbPackSources,
} from "@apty/agent-core";
import { ChromeStorageAdapter } from "@apty/browser-runtime";
import { noteKbPacksChanged } from "@apty/browser-runtime/runtime/effective-settings";
import { loadOrgPolicy } from "@apty/browser-runtime/runtime/org-policy";
import { previewRedaction } from "@apty/browser-runtime/runtime/redaction-mode";
import { isOwnExtensionPage } from "@apty/browser-runtime/runtime/trusted-sender";
import { SettingsPage } from "@apty/ui";
import { I18nProvider, useTranslation } from "@apty/ui/i18n/context";
import type { Language } from "@apty/ui/i18n/types";
import { ThemeProvider } from "@apty/ui/theme/context";
import { applyRememberedTheme } from "@apty/ui/theme/index";
import type { Theme } from "@apty/ui/theme/types";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { CasesCard } from "../../components/cases/cases-card";
import { FeedbackCard } from "../../components/cases/feedback-card";
import { SupportBundleButton } from "../../components/cases/support-bundle-button";
import { settingsStorageAdapter } from "../../hooks";
import { useOrgPolicyView } from "../../hooks/use-org-policy";
import { useRequestReports } from "../../hooks/use-request-reports";
import { initLogging } from "../../lib/logging";
import {
  isOptionsNavigateMessage,
  OPTIONS_SECTIONS,
  type OptionsTab,
} from "../../lib/open-options";
import { testConnection } from "../../services/connection-check";
import { kbEgressLog } from "../../services/kb-egress-log";
import { kbPackStore } from "../../services/kb-pack";
import { kbSyncRecords, requestKbPackCheck } from "../../services/kb-pack-sync";
import { fetchModelList } from "../../services/model-list";
import { installOrgPolicySource } from "../../services/org-policy";
import { ApprovalGrantsPanel } from "./approval-grants-panel";
import { AptyClientPanel, AptyStudioPanel } from "./apty-client-panel";
import { McpBridgePanel } from "./mcp-bridge-panel";
import { PermissionsPanel } from "./permissions-panel";
import { PreflightPanel } from "./preflight-panel";
import { revealSection } from "./reveal-section";
import { SkillsOptionsTab } from "./skills-tab";
import { StoredDataPanel } from "./stored-data-panel";

const TABS = new Set<OptionsTab>(["general", "ai", "skills", "connection"]);

function tabFromUrl(): OptionsTab | undefined {
  const raw = new URLSearchParams(window.location.search).get("tab");
  if (raw && TABS.has(raw as OptionsTab)) return raw as OptionsTab;
  // A bare section link (`#preflight`) opens the tab that holds it.
  const section = window.location.hash.slice(1);
  return section in OPTIONS_SECTIONS
    ? OPTIONS_SECTIONS[section as keyof typeof OPTIONS_SECTIONS]
    : undefined;
}

/**
 * Keep the selected tab in the URL, so reload, Back and Forward work and
 * any page can link to a tab and section (`?tab=connection#apty-client`).
 * An already-open Options page is navigated by message instead of being
 * reloaded, so unsaved edits survive (see lib/open-options.ts).
 */
function useUrlTab(): [OptionsTab, (tab: OptionsTab) => void] {
  const [tab, setTab] = useState<OptionsTab>(() => tabFromUrl() ?? "general");
  const select = useCallback((next: OptionsTab, section?: string) => {
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    const url = `?${params}${section ? `#${section}` : ""}`;
    if (next !== tabFromUrl() || section) {
      window.history.pushState(null, "", url);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => setTab(tabFromUrl() ?? "general");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const id = window.location.hash.slice(1);
    return id ? revealSection(id) : undefined;
  }, []);

  useEffect(() => {
    const onMessage = (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: boolean) => void,
    ) => {
      if (!isOptionsNavigateMessage(message) || !isOwnExtensionPage(sender)) {
        return false;
      }
      const next = message.tab ?? tabFromUrl() ?? "general";
      select(next, message.section);
      if (message.section) revealSection(message.section);
      sendResponse(true);
      return false;
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [select]);

  return [tab, select];
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

installOrgPolicySource();
initLogging();
applyRememberedTheme();

/**
 * Every import or removal is announced: the redaction floor follows the
 * loaded packs (D-SEC3). A version the policy delivers cannot be imported by
 * hand unless the policy allows it (K26, D-DEL5).
 */
const knowledgeBase = {
  info: () => kbPackStore().info(),
  async importPack(text: string) {
    const policy = await loadOrgPolicy();
    const result = await kbPackStore().replace(text, {
      guard: (incoming) =>
        kbPackManaged(policy, incoming.aptyVersion)
          ? "policy_managed"
          : undefined,
    });
    if (result.ok) await noteKbPacksChanged();
    return result;
  },
  async delivery() {
    const policy = await loadOrgPolicy();
    const sources = kbPackSources(policy);
    const records = await kbSyncRecords();
    return KB_PACK_SOURCE_VERSIONS.flatMap((version) => {
      const url = sources[version];
      if (!url) return [];
      const record = records[version];
      return [
        {
          version,
          host: new URL(url).host,
          managed: kbPackManaged(policy, version),
          ...(record ? { record } : {}),
        },
      ];
    });
  },
  checkNow: requestKbPackCheck,
  async remove(version: KbAptyVersion) {
    await kbPackStore().remove(version);
    await noteKbPacksChanged();
  },
};

/** The KB send record (KB-RAG K22, S7) as Data handling shows it. */
const kbEgressLogAdapter = {
  countLast30Days: () => kbEgressLog().countSince(30),
  exportJson: () => kbEgressLog().exportJson(),
  clearAllowed: () => kbEgressLog().clearAllowed(),
  clear: () => kbEgressLog().clear(),
};

const i18nStorageAdapter = new ChromeStorageAdapter<Language>();
const themeStorageAdapter = new ChromeStorageAdapter<Theme>();

function OptionsPageContent() {
  const { skill: initialSkill } = useMemo(parseUrlParams, []);
  const [tab, setTab] = useUrlTab();
  const requestReports = useRequestReports();
  const { t } = useTranslation();

  const handleTestConnection = useCallback(
    async (settings: AppSettings) => {
      const { toolCalling } = await testConnection(settings, Date.now, t);
      return { ok: true, toolCalling };
    },
    [t],
  );

  const handleFetchModels = useCallback(
    async (settings: AppSettings) => {
      const outcome = await fetchModelList(settings, { translate: t });
      return outcome.ok
        ? { ok: true as const, models: outcome.models }
        : { ok: false as const, error: outcome.error };
    },
    [t],
  );

  const orgPolicy = useOrgPolicyView();

  return (
    <SettingsPage
      storageAdapter={settingsStorageAdapter}
      orgPolicy={orgPolicy}
      kbEgressLog={kbEgressLogAdapter}
      onTestConnection={handleTestConnection}
      onFetchModels={handleFetchModels}
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
          <PreflightPanel requestReports={requestReports} />
          <AptyClientPanel />
          <AptyStudioPanel />
          <McpBridgePanel />
        </div>
      }
      activeTab={tab}
      onTabChange={setTab}
      initialSkill={initialSkill}
      redactionPreview={previewRedaction}
      recentRequests={requestReports}
      knowledgeBase={knowledgeBase}
      knowledgeBaseExtras={
        <>
          <CasesCard
            detailActions={(record) => <SupportBundleButton record={record} />}
          />
          <FeedbackCard />
        </>
      }
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
