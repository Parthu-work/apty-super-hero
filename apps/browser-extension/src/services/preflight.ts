/**
 * Preflight (C2): every check a demo or a first install depends on, each
 * pass / warn / fail with the exact fix. The checks themselves are pure
 * over `PreflightDeps`, so they are unit-tested with fakes; `browserDeps`
 * wires them to the real Chrome APIs and the existing checks (Test
 * Connection, the Apty Client handshake, the DOM Health frame ping).
 */
import type { AppSettings, ToolCallingSupport } from "@apty/agent-core";
import type { AptyServiceWorkerStatus } from "@apty/browser-runtime/apty/types";
import { isProviderConfigured } from "./ai-provider";

export type CheckStatus = "pass" | "warn" | "fail";

export interface PreflightCheck {
  id:
    | "ai-provider"
    | "apty-client"
    | "agent-id"
    | "bound-tab"
    | "console-bridge"
    | "clipboard"
    | "storage-access"
    | "data-handling";
  label: string;
  status: CheckStatus;
  detail: string;
  /** What to do, exactly; also what the copy button copies. */
  fix?: string;
  /** Options section that holds the setting to change. */
  section?: string;
}

export interface FrameAnswer {
  frameId: number;
  url: string;
  answered: boolean;
  /** The page-world script reported itself in this frame (B5). */
  bridgeSeen: boolean;
}

export interface PreflightDeps {
  loadSettings(): Promise<AppSettings>;
  testConnection(
    settings: AppSettings,
  ): Promise<{ latencyMs: number; toolCalling: ToolCallingSupport }>;
  clientId(): Promise<string | undefined>;
  /** `false` when the management permission shows the Client is missing or disabled; `undefined` when it cannot tell. */
  clientInstalled(id: string): Promise<boolean | undefined>;
  clientStatus(id: string): Promise<AptyServiceWorkerStatus>;
  clientResources(id: string): Promise<{ ok: boolean; count: number }>;
  agentId(): string;
  /** The web page the agent would work on: the most recently used http(s) tab. */
  pageTab(): Promise<{ id: number; url: string } | null>;
  frames(tabId: number): Promise<FrameAnswer[] | null>;
  bridgeRegistered(): Promise<boolean>;
  bridgeAllowedOn(url: string, settings: AppSettings): boolean;
  clipboardPermission(): Promise<PermissionState | "unsupported">;
  /** Whether a content script in the tab can read extension storage. */
  contentScriptStorage(
    tabId: number,
  ): Promise<"blocked" | "readable" | "unknown">;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

async function aiProviderCheck(
  deps: PreflightDeps,
  settings: AppSettings,
): Promise<PreflightCheck> {
  const base = {
    id: "ai-provider" as const,
    label: "AI provider",
    section: "ai-provider",
  };
  if (!isProviderConfigured(settings)) {
    return {
      ...base,
      status: "fail",
      detail: "No API key or model is set.",
      fix: "Open Settings → AI Configuration, enter the API key and a model for your provider, turn it on and click Save Settings.",
    };
  }
  try {
    const { latencyMs, toolCalling } = await deps.testConnection(settings);
    const answered = `${settings.aiModel} answered in ${latencyMs} ms`;
    if (toolCalling === "yes") {
      return {
        ...base,
        status: "pass",
        detail: `${answered} and calls tools.`,
      };
    }
    if (toolCalling === "no") {
      return {
        ...base,
        status: "fail",
        detail: `${answered} but did not call a tool. The agent needs function calling.`,
        fix: "Choose a model that supports function (tool) calling: in AI Configuration, Test Connection marks each model.",
      };
    }
    return {
      ...base,
      status: "warn",
      detail: `${answered}; whether it calls tools could not be determined.`,
      fix: "Run Test Connection in AI Configuration again; if it stays unknown, try a model the provider documents as supporting tools.",
    };
  } catch (error) {
    return {
      ...base,
      status: "fail",
      detail: `The provider did not answer: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Check the API key, AI Host and model in AI Configuration, then click Test Connection to see the provider's answer.",
    };
  }
}

const CLIENT_FIXES: Record<
  NonNullable<AptyServiceWorkerStatus["peerFailure"]>,
  (agentId: string) => string
> = {
  no_receiver: (agentId) =>
    `The Apty Client does not let this extension in. Add "${agentId}" to externally_connectable.ids in the Client's manifest.json, reload the Client in chrome://extensions, then run the checks again.`,
  no_response: () =>
    "The Apty Client answers but has no Agent bridge. Install the Agent bridge module in the Client's service worker (docs/integrations/apty/README.md) and reload the Client.",
  timeout: () =>
    "The Apty Client accepted the message but never answered. Install or update the Agent bridge module in its service worker, and check chrome://extensions for errors on the Client.",
  send_failed: () =>
    "Chrome refused to message the Apty Client. Check that the extension ID in Apty Integration is the Client's ID (32 letters a–p).",
  malformed_response: () =>
    "The Apty Client's bridge module is out of date. Update it to the current contract (docs/integrations/apty/README.md).",
};

async function aptyClientCheck(
  deps: PreflightDeps,
  agentId: string,
): Promise<PreflightCheck> {
  const base = {
    id: "apty-client" as const,
    label: "Apty Client",
    section: "apty-client",
  };
  const id = await deps.clientId();
  if (!id) {
    return {
      ...base,
      status: "fail",
      detail: "No Apty Client is connected.",
      fix: "Open Settings → Apty Integration, click Detect (or paste the Client's extension ID) and click Connect.",
    };
  }
  if ((await deps.clientInstalled(id)) === false) {
    return {
      ...base,
      status: "fail",
      detail: `No enabled extension has the ID ${id}.`,
      fix: "Install or enable the Apty Client in chrome://extensions, or correct the ID in Apty Integration.",
    };
  }
  const status = await deps.clientStatus(id);
  if (status.status !== "ok") {
    const failure = status.peerFailure ?? "timeout";
    return {
      ...base,
      status: "fail",
      detail: status.error ?? "The Apty Client did not answer.",
      fix: CLIENT_FIXES[failure](agentId),
    };
  }
  const resources = await deps.clientResources(id);
  if (!resources.ok) {
    return {
      ...base,
      status: "warn",
      detail: "The Client answers the handshake but not the request list.",
      fix: "Update the Agent bridge module in the Client: it must answer apty-debug-agent:list-observed-resources.",
    };
  }
  return {
    ...base,
    status: "pass",
    detail: `Answering: status, logs and ${resources.count} observed request(s).`,
  };
}

function frameSummary(
  frames: FrameAnswer[],
  pick: (f: FrameAnswer) => boolean,
) {
  const missing = frames.filter((f) => !pick(f));
  return {
    count: frames.length - missing.length,
    missing: missing.map((f) => `frame ${f.frameId} (${hostOf(f.url)})`),
  };
}

export async function runPreflight(
  deps: PreflightDeps,
): Promise<PreflightCheck[]> {
  const settings = await deps.loadSettings();
  const agentId = deps.agentId();
  const tab = await deps.pageTab();
  const frames = tab ? await deps.frames(tab.id) : null;

  const checks: PreflightCheck[] = [
    await aiProviderCheck(deps, settings),
    await aptyClientCheck(deps, agentId),
    {
      id: "agent-id",
      label: "This extension's ID",
      status: "pass",
      detail: agentId,
      fix: agentId,
    },
  ];

  if (!tab) {
    checks.push({
      id: "bound-tab",
      label: "Page and frames",
      status: "fail",
      detail: "No web page is open.",
      fix: "Open the application in a tab (an http or https page), click into it once, then run the checks again.",
    });
  } else if (!frames || frames.length === 0) {
    checks.push({
      id: "bound-tab",
      label: "Page and frames",
      status: "fail",
      detail: `The frames of ${hostOf(tab.url)} could not be listed.`,
      fix: "Reload the tab, then run the checks again.",
    });
  } else {
    const answering = frameSummary(frames, (f) => f.answered);
    checks.push({
      id: "bound-tab",
      label: "Page and frames",
      status:
        answering.missing.length === 0
          ? "pass"
          : answering.count > 0
            ? "warn"
            : "fail",
      detail:
        answering.missing.length === 0
          ? `${hostOf(tab.url)}: all ${frames.length} frame(s) answer.`
          : `${hostOf(tab.url)}: ${answering.count} of ${frames.length} frame(s) answer; not answering: ${answering.missing.join(", ")}.`,
      ...(answering.missing.length > 0
        ? {
            fix: "Reload the tab so every frame gets the page script. A frame that still does not answer is blocked by the page (sandboxed or a browser page).",
          }
        : {}),
    });
  }

  const bridgeBase = {
    id: "console-bridge" as const,
    label: "Console and routing capture",
    section: "troubleshooting",
  };
  if (settings.pageHooksEnabled === false) {
    checks.push({
      ...bridgeBase,
      status: "warn",
      detail:
        "Turned off: console output is read only from when you ask, and DOM Health cannot measure routing.",
      fix: 'Settings → General → Troubleshooting: turn on "Track client-side routing and capture console output from page load".',
    });
  } else if (!(await deps.bridgeRegistered())) {
    checks.push({
      ...bridgeBase,
      status: "fail",
      detail: "The page script is on in Settings but not registered.",
      fix: "Reload the extension in chrome://extensions.",
    });
  } else if (tab && !deps.bridgeAllowedOn(tab.url, settings)) {
    checks.push({
      ...bridgeBase,
      status: "warn",
      detail: `${hostOf(tab.url)} is in "Sites where that script never runs".`,
      fix: `Remove ${hostOf(tab.url)} from that list in Settings → General → Troubleshooting if this site should be captured.`,
    });
  } else if (frames && frames.length > 0) {
    const covered = frameSummary(frames, (f) => f.bridgeSeen);
    checks.push({
      ...bridgeBase,
      status: covered.missing.length === 0 ? "pass" : "warn",
      detail:
        covered.missing.length === 0
          ? `Running in all ${frames.length} frame(s).`
          : `Running in ${covered.count} of ${frames.length} frame(s); missing in ${covered.missing.join(", ")}.`,
      ...(covered.missing.length > 0
        ? {
            fix: "Reload the tab: frames loaded before the script was registered do not have it.",
          }
        : {}),
    });
  } else {
    checks.push({
      ...bridgeBase,
      status: "pass",
      detail: "Registered for every site.",
    });
  }

  const clipboard = await deps.clipboardPermission();
  checks.push({
    id: "clipboard",
    label: "Copy to clipboard",
    status:
      clipboard === "granted"
        ? "pass"
        : clipboard === "denied"
          ? "fail"
          : "warn",
    detail:
      clipboard === "granted"
        ? "Copy buttons can write to the clipboard."
        : clipboard === "denied"
          ? "Writing to the clipboard is blocked."
          : "Chrome will ask before the first copy.",
    ...(clipboard === "granted"
      ? {}
      : {
          fix: "Allow clipboard access for this extension: chrome://settings/content/clipboard.",
        }),
  });

  const storage = tab ? await deps.contentScriptStorage(tab.id) : "unknown";
  checks.push({
    id: "storage-access",
    label: "Storage access",
    status:
      storage === "blocked" ? "pass" : storage === "readable" ? "fail" : "warn",
    detail:
      storage === "blocked"
        ? "Only the extension's own pages can read its storage (API keys stay out of pages)."
        : storage === "readable"
          ? "A script in a web page can read the extension's storage, including API keys."
          : "Could not check without an open web page.",
    ...(storage === "readable"
      ? {
          fix: "Reload the extension in chrome://extensions so its service worker restricts storage again.",
        }
      : storage === "unknown"
        ? { fix: "Open a web page and run the checks again." }
        : {}),
  });

  const denyList = settings.networkBodyCaptureDenyList ?? [];
  const mode = settings.redactionMode ?? "strict";
  checks.push({
    id: "data-handling",
    label: "Data handling",
    status: mode === "off" ? "warn" : "pass",
    detail: `Response bodies: ${settings.networkBodyCaptureEnabled ? "captured" : "not captured"} · deny list: ${denyList.length} entr${denyList.length === 1 ? "y" : "ies"} · redaction: ${mode}.`,
    section: "data-handling",
    ...(mode === "off"
      ? {
          fix: "Redaction is off (development only). Settings → General → Data handling → Redaction: choose Strict before a demo with real data.",
        }
      : {}),
  });

  return checks;
}

/** Results as JSON for sharing: every string through the given redaction (strict in the app). */
export function preflightJson(
  checks: PreflightCheck[],
  redact: (text: string) => string,
  generatedAt = new Date(),
): string {
  return JSON.stringify(
    {
      schema: "apty-preflight/1",
      generatedAt: generatedAt.toISOString(),
      checks: checks.map((check) =>
        Object.fromEntries(
          Object.entries(check).map(([key, value]) => [
            key,
            typeof value === "string" && key !== "id" && key !== "status"
              ? redact(value)
              : value,
          ]),
        ),
      ),
    },
    null,
    2,
  );
}
