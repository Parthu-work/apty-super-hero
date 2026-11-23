import type { TurnDecision } from "@apty/agent-core";
import { createContext, useContext } from "react";
import type { UIMessage } from "../../types";

/**
 * The reply a card is shown in (KB-RAG K29, D2): its decision record, so a
 * KB answer or a verdict can carry its own source line and "Why this
 * answer" instead of the turn's chips.
 */
export interface TurnInfo {
  decision?: TurnDecision;
  message: UIMessage;
}

export const TurnContext = createContext<TurnInfo | null>(null);

export function useTurn(): TurnInfo | null {
  return useContext(TurnContext);
}
