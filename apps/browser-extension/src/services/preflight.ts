/**
 * Preflight (C2): every check a demo or a first install depends on, each
 * pass / warn / fail with the exact fix. The checks themselves are pure
 * over `PreflightDeps`, so they are unit-tested with fakes; `browserDeps`
 * wires them to the real Chrome APIs and the existing checks (Test
 * Connection, the Apty Client handshake, the DOM Health frame ping).
 */
import type { AppSettings, ToolCallingSupport } from "@apty/agent-core";
import { CHECK_PACK_FILES } from "@apty/browser-runtime/apty/diagnosis/pack-files";
import {
  matchingDenyEntry,
  resourceNameFor,
} from "@apty/browser-runtime/apty/resource-body-utils";
import type { AptyServiceWorkerStatus } from "@apty/browser-runtime/apty/types";
import type { TranslationKey } from "@apty/ui/i18n/types";
import { isProviderConfigured } from "./ai-provider";
import { englishTranslate, type Translate } from "./model-list";

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
    | "data-handling"
    | "check-files";
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
  /** `urls` are the calls' URLs, when the source gives them. */
  clientResources(
    id: string,
  ): Promise<{ ok: boolean; count: number; urls?: string[] }>;
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
  t: Translate,
): Promise<PreflightCheck> {
  const base = {
    id: "ai-provider" as const,
    label: t("preflight.checks.aiProvider.label"),
    section: "ai-provider",
  };
  if (!isProviderConfigured(settings)) {
    return {
      ...base,
      status: "fail",
      detail: t("preflight.checks.aiProvider.notConfigured"),
      fix: t("preflight.checks.aiProvider.notConfiguredFix"),
    };
  }
  try {
    const { latencyMs, toolCalling } = await deps.testConnection(settings);
    const answered = { model: settings.aiModel ?? "", latency: latencyMs };
    if (toolCalling === "yes") {
      return {
        ...base,
        status: "pass",
        detail: t("preflight.checks.aiProvider.callsTools", answered),
      };
    }
    if (toolCalling === "no") {
      return {
        ...base,
        status: "fail",
        detail: t("preflight.checks.aiProvider.noTools", answered),
        fix: t("preflight.checks.aiProvider.noToolsFix"),
      };
    }
    return {
      ...base,
      status: "warn",
      detail: t("preflight.checks.aiProvider.toolsUnknown", answered),
      fix: t("preflight.checks.aiProvider.toolsUnknownFix"),
    };
  } catch (error) {
    return {
      ...base,
      status: "fail",
      detail: t("preflight.checks.aiProvider.noAnswer", {
        error: error instanceof Error ? error.message : String(error),
      }),
      fix: t("preflight.checks.aiProvider.noAnswerFix"),
    };
  }
}

const CLIENT_FIXES: Record<
  NonNullable<AptyServiceWorkerStatus["peerFailure"]>,
  TranslationKey
> = {
  no_receiver: "preflight.checks.aptyClient.fixNoReceiver",
  no_response: "preflight.checks.aptyClient.fixNoResponse",
  timeout: "preflight.checks.aptyClient.fixTimeout",
  send_failed: "preflight.checks.aptyClient.fixSendFailed",
  malformed_response: "preflight.checks.aptyClient.fixMalformed",
};

async function aptyClientCheck(
  deps: PreflightDeps,
  agentId: string,
  t: Translate,
): Promise<{ check: PreflightCheck; urls?: string[] }> {
  const base = {
    id: "apty-client" as const,
    label: t("preflight.checks.aptyClient.label"),
    section: "apty-client",
  };
  const id = await deps.clientId();
  if (!id) {
    return {
      check: {
        ...base,
        status: "fail",
        detail: t("preflight.checks.aptyClient.notConnected"),
        fix: t("preflight.checks.aptyClient.notConnectedFix"),
      },
    };
  }
  if ((await deps.clientInstalled(id)) === false) {
    return {
      check: {
        ...base,
        status: "fail",
        detail: t("preflight.checks.aptyClient.notInstalled", { id }),
        fix: t("preflight.checks.aptyClient.notInstalledFix"),
      },
    };
  }
  const status = await deps.clientStatus(id);
  if (status.status !== "ok") {
    const failure = status.peerFailure ?? "timeout";
    return {
      check: {
        ...base,
        status: "fail",
        detail: status.error ?? t("preflight.checks.aptyClient.noAnswer"),
        fix: t(CLIENT_FIXES[failure], { agentId }),
      },
    };
  }
  const resources = await deps.clientResources(id);
  if (!resources.ok) {
    return {
      check: {
        ...base,
        status: "warn",
        detail: t("preflight.checks.aptyClient.noResources"),
        fix: t("preflight.checks.aptyClient.noResourcesFix"),
      },
    };
  }
  return {
    check: {
      ...base,
      status: "pass",
      detail: t("preflight.checks.aptyClient.answering", {
        count: resources.count,
      }),
    },
    urls: resources.urls,
  };
}

/** Whether the body deny list hides a file the visibility checks read (C5). */
function checkFilesCheck(
  urls: readonly string[],
  denyList: readonly string[],
  t: Translate,
): PreflightCheck {
  const blocked = new Map<string, Set<string>>();
  for (const url of urls) {
    const name = resourceNameFor(url);
    if (!CHECK_PACK_FILES.includes(name)) continue;
    const entry = matchingDenyEntry(url, denyList);
    if (entry === null) continue;
    blocked.set(entry, (blocked.get(entry) ?? new Set()).add(name));
  }
  const base = {
    id: "check-files" as const,
    label: t("preflight.checks.checkFiles.label"),
    section: "data-handling",
  };
  if (blocked.size === 0) {
    return {
      ...base,
      status: "pass",
      detail: t("preflight.checks.checkFiles.readable"),
    };
  }
  const entries = [...blocked.keys()].map((e) => `“${e}”`).join(", ");
  const files = [...new Set([...blocked.values()].flatMap((f) => [...f]))]
    .sort()
    .join(", ");
  return {
    ...base,
    status: "warn",
    detail: t("preflight.checks.checkFiles.blocked", { entries, files }),
    fix: t("preflight.checks.checkFiles.fix", { entries }),
  };
}

function frameSummary(
  frames: FrameAnswer[],
  pick: (f: FrameAnswer) => boolean,
  t: Translate,
) {
  const missing = frames.filter((f) => !pick(f));
  return {
    count: frames.length - missing.length,
    missing: missing.map((f) =>
      t("preflight.checks.frame", { id: f.frameId, host: hostOf(f.url) }),
    ),
  };
}

export async function runPreflight(
  deps: PreflightDeps,
  t: Translate = englishTranslate,
): Promise<PreflightCheck[]> {
  const settings = await deps.loadSettings();
  const agentId = deps.agentId();
  const tab = await deps.pageTab();
  const frames = tab ? await deps.frames(tab.id) : null;

  const client = await aptyClientCheck(deps, agentId, t);
  const checks: PreflightCheck[] = [
    await aiProviderCheck(deps, settings, t),
    client.check,
    {
      id: "agent-id",
      label: t("preflight.checks.agentId.label"),
      status: "pass",
      detail: agentId,
      fix: agentId,
    },
  ];

  const pageLabel = t("preflight.checks.boundTab.label");
  if (!tab) {
    checks.push({
      id: "bound-tab",
      label: pageLabel,
      status: "fail",
      detail: t("preflight.checks.boundTab.noPage"),
      fix: t("preflight.checks.boundTab.noPageFix"),
    });
  } else if (!frames || frames.length === 0) {
    checks.push({
      id: "bound-tab",
      label: pageLabel,
      status: "fail",
      detail: t("preflight.checks.boundTab.framesUnlisted", {
        host: hostOf(tab.url),
      }),
      fix: t("preflight.checks.boundTab.reloadFix"),
    });
  } else {
    const answering = frameSummary(frames, (f) => f.answered, t);
    checks.push({
      id: "bound-tab",
      label: pageLabel,
      status:
        answering.missing.length === 0
          ? "pass"
          : answering.count > 0
            ? "warn"
            : "fail",
      detail:
        answering.missing.length === 0
          ? t("preflight.checks.boundTab.allAnswer", {
              host: hostOf(tab.url),
              total: frames.length,
            })
          : t("preflight.checks.boundTab.someAnswer", {
              host: hostOf(tab.url),
              count: answering.count,
              total: frames.length,
              missing: answering.missing.join(", "),
            }),
      ...(answering.missing.length > 0
        ? { fix: t("preflight.checks.boundTab.someAnswerFix") }
        : {}),
    });
  }

  const bridgeBase = {
    id: "console-bridge" as const,
    label: t("preflight.checks.consoleBridge.label"),
    section: "troubleshooting",
  };
  if (settings.pageHooksEnabled === false) {
    checks.push({
      ...bridgeBase,
      status: "warn",
      detail: t("preflight.checks.consoleBridge.off"),
      fix: t("preflight.checks.consoleBridge.offFix"),
    });
  } else if (!(await deps.bridgeRegistered())) {
    checks.push({
      ...bridgeBase,
      status: "fail",
      detail: t("preflight.checks.consoleBridge.notRegistered"),
      fix: t("preflight.checks.consoleBridge.reloadExtensionFix"),
    });
  } else if (tab && !deps.bridgeAllowedOn(tab.url, settings)) {
    const host = hostOf(tab.url);
    checks.push({
      ...bridgeBase,
      status: "warn",
      detail: t("preflight.checks.consoleBridge.excluded", { host }),
      fix: t("preflight.checks.consoleBridge.excludedFix", { host }),
    });
  } else if (frames && frames.length > 0) {
    const covered = frameSummary(frames, (f) => f.bridgeSeen, t);
    checks.push({
      ...bridgeBase,
      status: covered.missing.length === 0 ? "pass" : "warn",
      detail:
        covered.missing.length === 0
          ? t("preflight.checks.consoleBridge.allFrames", {
              total: frames.length,
            })
          : t("preflight.checks.consoleBridge.someFrames", {
              count: covered.count,
              total: frames.length,
              missing: covered.missing.join(", "),
            }),
      ...(covered.missing.length > 0
        ? { fix: t("preflight.checks.consoleBridge.someFramesFix") }
        : {}),
    });
  } else {
    checks.push({
      ...bridgeBase,
      status: "pass",
      detail: t("preflight.checks.consoleBridge.everySite"),
    });
  }

  const clipboard = await deps.clipboardPermission();
  checks.push({
    id: "clipboard",
    label: t("preflight.checks.clipboard.label"),
    status:
      clipboard === "granted"
        ? "pass"
        : clipboard === "denied"
          ? "fail"
          : "warn",
    detail: t(
      clipboard === "granted"
        ? "preflight.checks.clipboard.granted"
        : clipboard === "denied"
          ? "preflight.checks.clipboard.denied"
          : "preflight.checks.clipboard.prompt",
    ),
    ...(clipboard === "granted"
      ? {}
      : { fix: t("preflight.checks.clipboard.fix") }),
  });

  const storage = tab ? await deps.contentScriptStorage(tab.id) : "unknown";
  checks.push({
    id: "storage-access",
    label: t("preflight.checks.storage.label"),
    status:
      storage === "blocked" ? "pass" : storage === "readable" ? "fail" : "warn",
    detail: t(`preflight.checks.storage.${storage}`),
    ...(storage === "readable"
      ? { fix: t("preflight.checks.storage.readableFix") }
      : storage === "unknown"
        ? { fix: t("preflight.checks.storage.unknownFix") }
        : {}),
  });

  const denyList = settings.networkBodyCaptureDenyList ?? [];
  const mode = settings.redactionMode ?? "strict";
  checks.push({
    id: "data-handling",
    label: t("preflight.checks.dataHandling.label"),
    status: mode === "off" ? "warn" : "pass",
    detail: t("preflight.checks.dataHandling.detail", {
      bodies: t(
        settings.networkBodyCaptureEnabled
          ? "preflight.checks.dataHandling.captured"
          : "preflight.checks.dataHandling.notCaptured",
      ),
      entries: t(
        denyList.length === 1
          ? "preflight.checks.dataHandling.entryOne"
          : "preflight.checks.dataHandling.entryMany",
        { count: denyList.length },
      ),
      mode: t(`redactionModes.${mode}`),
    }),
    section: "data-handling",
    ...(mode === "off"
      ? { fix: t("preflight.checks.dataHandling.offFix") }
      : {}),
  });
  if (client.urls) checks.push(checkFilesCheck(client.urls, denyList, t));

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
