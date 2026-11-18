/**
 * The first-run checklist's rows (KB-RAG K27, R3), from the same facts
 * Preflight reads: a usable KB pack per version with its expiry, an AI key
 * or the choice to work without one, the Apty Client answering, and the
 * organization policy. Pure, so each row's three states are tested here.
 */
import type { KbPackState, OrgPolicyState } from "@apty/agent-core";
import type { OptionsSection } from "../../lib/open-options";
import type { PeerStatus } from "../../state/readiness-store";

export type FirstRunState = "ok" | "todo" | "problem" | "checking";

export type FirstRunDetail =
  | "checking"
  | "packMissing"
  | "packUnusable"
  | "packReady"
  | "packReadyNoExpiry"
  | "aiKey"
  | "aiNoKey"
  | "aiMissing"
  | "clientConnected"
  | "clientNotAnswering"
  | "clientNotSet"
  | "policyActive"
  | "policyNone"
  | "policyInvalid";

export interface FirstRunRow {
  id: "kb-4.x" | "kb-5.x" | "ai" | "client" | "policy";
  state: FirstRunState;
  /** i18n key under firstRun.rows, and its values. */
  detail: FirstRunDetail;
  values?: Record<string, string | number>;
  /** The Options section that fixes it. */
  section: OptionsSection;
}

export interface FirstRunFacts {
  /** undefined while the packs are read. */
  packs: readonly KbPackState[] | undefined;
  providerConfigured: boolean;
  noKeyMode: boolean;
  client: PeerStatus;
  /** undefined while the policy is read. */
  policy: OrgPolicyState | undefined;
}

const VERSIONS = ["4.x", "5.x"] as const;

function packRow(
  version: (typeof VERSIONS)[number],
  packs: FirstRunFacts["packs"],
): FirstRunRow {
  const base = {
    id: `kb-${version}` as const,
    section: "knowledge-base" as const,
  };
  if (!packs) return { ...base, state: "checking", detail: "checking" };
  const pack = packs.find((p) => p.aptyVersion === version);
  if (!pack) {
    return {
      ...base,
      state: "todo",
      detail: "packMissing",
      values: { version },
    };
  }
  if (!pack.usability.usable) {
    return {
      ...base,
      state: "problem",
      detail: "packUnusable",
      values: { version, reason: pack.usability.reason ?? "untrusted" },
    };
  }
  return {
    ...base,
    state: "ok",
    detail: pack.expiresAt ? "packReady" : "packReadyNoExpiry",
    values: { version, expires: (pack.expiresAt ?? "").slice(0, 10) },
  };
}

export function firstRunRows(facts: FirstRunFacts): FirstRunRow[] {
  const client: FirstRunRow = {
    id: "client",
    section: "apty-client",
    ...(facts.client.kind === "connected"
      ? { state: "ok", detail: "clientConnected" }
      : facts.client.kind === "not-answering"
        ? { state: "problem", detail: "clientNotAnswering" }
        : facts.client.kind === "checking"
          ? { state: "checking", detail: "checking" }
          : { state: "todo", detail: "clientNotSet" }),
  };
  const policy: FirstRunRow = {
    id: "policy",
    section: "preflight",
    ...(facts.policy === undefined
      ? { state: "checking", detail: "checking" }
      : facts.policy.kind === "invalid"
        ? { state: "problem", detail: "policyInvalid" }
        : facts.policy.kind === "active"
          ? { state: "ok", detail: "policyActive" }
          : { state: "ok", detail: "policyNone" }),
  };
  return [
    ...VERSIONS.map((version) => packRow(version, facts.packs)),
    {
      id: "ai",
      section: "ai-provider",
      ...(facts.providerConfigured
        ? { state: "ok", detail: "aiKey" }
        : facts.noKeyMode
          ? { state: "ok", detail: "aiNoKey" }
          : { state: "todo", detail: "aiMissing" }),
    },
    client,
    policy,
  ];
}

/** The checklist shows until every row is ready; while anything is still read, it waits. */
export function firstRunNeeded(rows: readonly FirstRunRow[]): boolean {
  if (rows.some((row) => row.state === "checking")) return false;
  return rows.some((row) => row.state !== "ok");
}
