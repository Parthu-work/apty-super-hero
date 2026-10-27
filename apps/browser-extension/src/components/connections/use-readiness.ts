import { useChatContext, useConfigContext } from "@apty/ui/components/chatbot";
import { isProviderConfigured } from "../../services/ai-provider";
import {
  type PeerStatuses,
  type ReadinessStates,
  readinessStates,
  setupCount,
  usePeerStatuses,
} from "../../state/readiness-store";
import {
  type CurrentTarget,
  useCurrentTarget,
} from "../investigation/use-current-target";

export interface Readiness {
  states: ReadinessStates;
  /** Warnings only; the setup badge hides at zero. */
  setupCount: number;
  peers: PeerStatuses;
  target: CurrentTarget;
  /** The model in use, once a provider is set up. */
  model: string | undefined;
}

/** What chatting and investigating need: the AI provider, the Apty Client and Studio, and an inspectable page. */
export function useReadiness(): Readiness {
  const { settings } = useConfigContext();
  const { sessionId } = useChatContext();
  const target = useCurrentTarget(sessionId);
  const peers = usePeerStatuses();
  const providerConfigured = isProviderConfigured(settings);
  const states = readinessStates({
    providerConfigured,
    peers,
    pageInspectable: target.checking ? null : target.inspectable,
  });
  return {
    states,
    setupCount: setupCount(states),
    peers,
    target,
    model: providerConfigured ? settings.aiModel : undefined,
  };
}
