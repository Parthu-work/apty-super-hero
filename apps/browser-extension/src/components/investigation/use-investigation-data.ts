/**
 * Reads live investigation state directly from `@apty/browser-runtime`'s
 * in-memory stores.
 *
 * Tool `execute()` functions and this side panel's React tree run in the
 * same JS realm (there is no background-service-worker round trip for tool
 * calls in this codebase — see `browser-agent-config.ts`'s `useBrowserTools`),
 * so the evidence/investigation module-level `Map`s are literally the same
 * objects a diagnostic tool call just wrote to. That means this hook can
 * read real, current state directly instead of waiting for the model to
 * report it back through a message — while still never fabricating
 * anything the model or a tool didn't actually produce.
 *
 * Polls on a short interval while the chat is actively working (a tool
 * could complete between renders) and once immediately whenever `status`
 * changes, so the UI reflects real state promptly without a bespoke event
 * bus.
 */
import {
  type CorrelationCluster,
  correlateEvidence,
  type DiagnosticEvidence,
  getEvidence,
  getInvestigation,
  type InvestigationSession,
} from "@apty/browser-runtime";
import { useEffect, useState } from "react";
import {
  type ComponentHealth,
  deriveComponentHealth,
} from "./component-health";

export interface InvestigationData {
  investigation: InvestigationSession | undefined;
  evidence: DiagnosticEvidence[];
  clusters: CorrelationCluster[];
  componentHealth: ComponentHealth[];
  likelyIncidentClusterCount: number;
}

const ACTIVE_POLL_MS = 1200;
const IDLE_POLL_MS = 5000;

function snapshot(conversationId: string | undefined): InvestigationData {
  const evidence = getEvidence(conversationId);
  const clusters = correlateEvidence(evidence);
  return {
    investigation: getInvestigation(conversationId),
    evidence,
    clusters,
    componentHealth: deriveComponentHealth(evidence),
    likelyIncidentClusterCount: clusters.filter((c) => c.likelySameIncident)
      .length,
  };
}

/**
 * `conversationId` should be the chat's `sessionId` (or `null`/`"pending"`
 * before one exists — both resolve to the same unscoped bucket the tools
 * themselves use pre-session, see `evidence-store.ts`/`investigation-session.ts`).
 * `isActive` should reflect whether the agent is currently streaming/running
 * tools, so polling backs off while idle.
 */
export function useInvestigationData(
  conversationId: string | null | undefined,
  isActive: boolean,
): InvestigationData {
  const [data, setData] = useState<InvestigationData>(() =>
    snapshot(conversationId ?? undefined),
  );

  useEffect(() => {
    setData(snapshot(conversationId ?? undefined));

    const interval = setInterval(
      () => setData(snapshot(conversationId ?? undefined)),
      isActive ? ACTIVE_POLL_MS : IDLE_POLL_MS,
    );
    return () => clearInterval(interval);
  }, [conversationId, isActive]);

  return data;
}
