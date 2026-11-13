/**
 * Preflight (C2): every check a demo or a first install depends on, each
 * pass / warn / fail with the exact fix. The checks themselves are pure
 * over `PreflightDeps`, so they are unit-tested with fakes; `browserDeps`
 * wires them to the real Chrome APIs and the existing checks (Test
 * Connection, the Apty Client handshake, the DOM Health frame ping).
 */
import {
  type AiDestination,
  type AppSettings,
  destinationAllowed,
  destinationOf,
  isKbSyncSuccess,
  KB_PACK_SOURCE_VERSIONS,
  KB_PACK_STALE_DAYS,
  type KbEgressDecision,
  type KbPackInfo,
  type KbPackSourceVersion,
  type KbPackUsability,
  type KbSyncRecord,
  kbPackAgeDays,
  kbPackCheckHours,
  kbPackSources,
  type OrgPolicyState,
  type ToolCallingSupport,
} from "@apty/agent-core";
import { CHECK_PACK_FILES } from "@apty/browser-runtime/apty/diagnosis/pack-files";
import {
  matchingDenyEntry,
  resourceNameFor,
} from "@apty/browser-runtime/apty/resource-body-utils";
import type { AptyServiceWorkerStatus } from "@apty/browser-runtime/apty/types";
import type { TranslationKey } from "@apty/ui/i18n/types";
import { kbSyncOutcomeMessage } from "@apty/ui/lib/kb-sync-outcome";
import { destinationRefusalMessage, isProviderConfigured } from "./ai-provider";
import { englishTranslate, type Translate } from "./model-list";

/** `info` reports a choice, such as no knowledge base, that is not a fault. */
export type CheckStatus = "pass" | "warn" | "fail" | "info";

export interface PreflightCheck {
  id:
    | "org-policy"
    | "ai-destination"
    | "kb-to-ai"
    | "ai-provider"
    | "apty-client"
    | "agent-id"
    | "bound-tab"
    | "console-bridge"
    | "clipboard"
    | "storage-access"
    | "data-handling"
    | "check-files"
    | "knowledge-base"
    | "kb-delivery";
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
  /** The loaded KB packs, one per Apty version. */
  knowledgeBase(): Promise<Array<KbPackInfo & { usability?: KbPackUsability }>>;
  /** The organization policy (KB-RAG K22). */
  orgPolicy(): Promise<OrgPolicyState>;
  /** Whether KB text may go with a chat request, and where. */
  kbEgress(): Promise<{
    decision: KbEgressDecision;
    destination?: AiDestination;
  }>;
  /** K26 (D4): the last check of each version the policy delivers. */
  kbSyncRecords?(): Promise<Partial<Record<KbPackSourceVersion, KbSyncRecord>>>;
  now?(): Date;
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

function orgPolicyCheck(policy: OrgPolicyState, t: Translate): PreflightCheck {
  const base = {
    id: "org-policy" as const,
    label: t("preflight.checks.orgPolicy.label"),
  };
  if (policy.kind === "invalid") {
    return {
      ...base,
      status: "fail",
      detail: t("preflight.checks.orgPolicy.invalid", {
        reason: policy.reason,
      }),
      fix: t("preflight.checks.orgPolicy.invalidFix"),
    };
  }
  return {
    ...base,
    status: policy.kind === "active" ? "pass" : "info",
    detail: t(
      policy.kind === "active"
        ? "preflight.checks.orgPolicy.active"
        : "preflight.checks.orgPolicy.none",
    ),
  };
}

function describeDestination(destination: AiDestination): string {
  return [destination.provider, destination.origin, destination.model]
    .filter(Boolean)
    .join(", ");
}

function aiDestinationCheck(
  policy: OrgPolicyState,
  settings: AppSettings,
  t: Translate,
): PreflightCheck {
  const destination = destinationOf(settings);
  const base = {
    id: "ai-destination" as const,
    label: t("preflight.checks.aiDestination.label"),
    section: "ai-provider",
  };
  const shown = describeDestination(destination);
  const verdict = destinationAllowed(policy, destination);
  if (!verdict.allowed) {
    return {
      ...base,
      status: "fail",
      detail: t("preflight.checks.aiDestination.refused", {
        destination: shown,
        reason: destinationRefusalMessage(
          verdict,
          policy.kind === "invalid" ? policy.reason : undefined,
          t,
        ),
      }),
      fix: t("preflight.checks.aiDestination.refusedFix"),
    };
  }
  return {
    ...base,
    status: policy.kind === "active" ? "pass" : "info",
    detail: t(
      policy.kind === "active"
        ? "preflight.checks.aiDestination.allowed"
        : "preflight.checks.aiDestination.noPolicy",
      { destination: shown },
    ),
  };
}

async function kbToAiCheck(
  deps: PreflightDeps,
  t: Translate,
): Promise<PreflightCheck> {
  const base = {
    id: "kb-to-ai" as const,
    label: t("preflight.checks.kbToAi.label"),
    section: "data-handling",
  };
  const { decision, destination } = await deps.kbEgress().catch(() => ({
    decision: { allowed: false, reason: "check-failed" as const },
    destination: undefined,
  }));
  if (decision.reason === "no-pack") {
    return {
      ...base,
      status: "info",
      detail: t("preflight.checks.kbToAi.noPack"),
    };
  }
  if (decision.reason === "demo") {
    return {
      ...base,
      status: "info",
      detail: t("preflight.checks.kbToAi.demo"),
    };
  }
  if (decision.allowed && destination) {
    return {
      ...base,
      status: "pass",
      detail: t("preflight.checks.kbToAi.allowed", {
        destination: describeDestination(destination),
      }),
    };
  }
  return {
    ...base,
    status: "pass",
    detail: t("preflight.checks.kbToAi.withheld"),
  };
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
  const policy: OrgPolicyState = await deps.orgPolicy().catch(() => ({
    kind: "invalid",
    reason: "the policy could not be read",
  }));
  const checks: PreflightCheck[] = [
    orgPolicyCheck(policy, t),
    aiDestinationCheck(policy, settings, t),
    await kbToAiCheck(deps, t),
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
  const packs = await Promise.resolve()
    .then(() => deps.knowledgeBase())
    .catch(() => []);
  const now = deps.now?.() ?? new Date();
  if (packs.length === 0) checks.push(knowledgeBaseCheck(null, now, t));
  for (const info of packs) checks.push(knowledgeBaseCheck(info, now, t));
  const records = await Promise.resolve()
    .then(() => deps.kbSyncRecords?.() ?? {})
    .catch(() => ({}));
  const delivery = kbDeliveryCheck(policy, packs, records, now, t);
  if (delivery) checks.push(delivery);

  return checks;
}

function knowledgeBaseCheck(
  info: (KbPackInfo & { usability?: KbPackUsability }) | null,
  now: Date,
  t: Translate,
): PreflightCheck {
  const base = {
    id: "knowledge-base" as const,
    label: info
      ? t("preflight.checks.knowledgeBase.labelVersion", {
          version: info.aptyVersion,
        })
      : t("preflight.checks.knowledgeBase.label"),
    section: "knowledge-base",
  };
  if (!info) {
    return {
      ...base,
      status: "info",
      detail: t("preflight.checks.knowledgeBase.notLoaded"),
      fix: t("preflight.checks.knowledgeBase.notLoadedFix"),
    };
  }
  const params = {
    count: info.cardCount,
    space: info.space,
    date: info.builtAt.slice(0, 10),
  };
  const usability = info.usability;
  if (usability && !usability.usable) {
    return {
      ...base,
      status: "fail",
      detail: t(
        `preflight.checks.knowledgeBase.unusable.${usability.reason ?? "untrusted"}`,
        {
          ...params,
          version: info.aptyVersion,
          until: usability.validity.date?.slice(0, 10) ?? "",
        },
      ),
      fix: t("preflight.checks.knowledgeBase.unusableFix"),
    };
  }
  if (usability?.validity.state === "expiring") {
    return {
      ...base,
      status: "warn",
      detail: t("preflight.checks.knowledgeBase.expiring", {
        ...params,
        days: usability.validity.daysLeft ?? 0,
      }),
      fix: t("preflight.checks.knowledgeBase.staleFix"),
    };
  }
  // The 30-day stale warning stays only for packs with no expiry date (K23 P5).
  const days = kbPackAgeDays(info, now);
  if (!info.expiresAt && days !== undefined && days > KB_PACK_STALE_DAYS) {
    return {
      ...base,
      status: "warn",
      detail: t("preflight.checks.knowledgeBase.stale", { ...params, days }),
      fix: t("preflight.checks.knowledgeBase.staleFix"),
    };
  }
  return {
    ...base,
    status: "pass",
    detail: t("preflight.checks.knowledgeBase.loaded", params),
  };
}

const minute = (iso: string) => iso.slice(0, 16).replace("T", " ");

/** Why a stored pack is not used, in the words Options uses. */
function unusableWords(usability: KbPackUsability, t: Translate): string {
  const date = usability.validity.date?.slice(0, 10) ?? "";
  switch (usability.reason) {
    case "expired":
      return t("settings.knowledgeBase.state.expired", { date });
    case "not_yet_valid":
      return t("settings.knowledgeBase.state.notYetValid", { date });
    case "revoked":
      return t("settings.knowledgeBase.state.revoked");
    case "unsigned":
      return t("settings.knowledgeBase.state.unsigned");
    default:
      return t("settings.knowledgeBase.state.untrusted");
  }
}

/**
 * "KB packs up to date" (K26, D4): only when the policy delivers a version.
 * Red when a delivered version has no usable pack; amber when one is
 * expiring, its last check failed, or it has not been checked successfully
 * in twice the check interval; green otherwise. Each line names the version
 * and the reason.
 */
function kbDeliveryCheck(
  policy: OrgPolicyState,
  packs: Array<KbPackInfo & { usability?: KbPackUsability }>,
  records: Partial<Record<KbPackSourceVersion, KbSyncRecord>>,
  now: Date,
  t: Translate,
): PreflightCheck | undefined {
  const sources = kbPackSources(policy);
  const versions = KB_PACK_SOURCE_VERSIONS.filter(
    (version) => sources[version],
  );
  if (versions.length === 0) return undefined;
  const fresh = 2 * kbPackCheckHours(policy) * 3_600_000;
  const rank = { pass: 0, warn: 1, fail: 2 } as const;
  let status: keyof typeof rank = "pass";
  const lines = versions.map((version) => {
    const info = packs.find((pack) => pack.aptyVersion === version);
    const record = records[version];
    const failed =
      record && !isKbSyncSuccess(record.outcome)
        ? kbSyncOutcomeMessage(record.outcome, t).replace(/[.。]$/u, "")
        : undefined;
    const raise = (next: keyof typeof rank) => {
      if (rank[next] > rank[status]) status = next;
    };
    if (!info || info.usability?.usable === false) {
      raise("fail");
      const reason = [
        info?.usability ? unusableWords(info.usability, t) : undefined,
        failed ??
          (info ? undefined : t("preflight.checks.kbDelivery.notDelivered")),
      ]
        .filter(Boolean)
        .join("; ");
      return t("preflight.checks.kbDelivery.noPack", { version, reason });
    }
    if (info.usability?.validity.state === "expiring") {
      raise("warn");
      return t("preflight.checks.kbDelivery.expiring", {
        version,
        days: info.usability.validity.daysLeft ?? 0,
      });
    }
    if (!record) {
      raise("warn");
      return t("preflight.checks.kbDelivery.neverChecked", { version });
    }
    if (failed) {
      raise("warn");
      return t("preflight.checks.kbDelivery.checkFailed", {
        version,
        reason: failed,
      });
    }
    const success = Date.parse(record.lastSuccessAt ?? record.lastCheckAt);
    if (now.getTime() - success > fresh) {
      raise("warn");
      return t("preflight.checks.kbDelivery.stale", {
        version,
        when: minute(record.lastSuccessAt ?? record.lastCheckAt),
      });
    }
    return t("preflight.checks.kbDelivery.current", {
      version,
      when: minute(record.lastCheckAt),
    });
  });
  return {
    id: "kb-delivery",
    label: t("preflight.checks.kbDelivery.label"),
    status,
    detail: lines.join(" "),
    section: "knowledge-base",
    ...(status === "pass" ? {} : { fix: t("preflight.checks.kbDelivery.fix") }),
  };
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
