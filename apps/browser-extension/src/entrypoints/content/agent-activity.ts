export const AGENT_ACTIVITY_REQUEST = "agent-activity";

export interface AgentActivityMessage {
  request: typeof AGENT_ACTIVITY_REQUEST;
  active: boolean;
}

export function isAgentActivityMessage(
  message: unknown,
): message is AgentActivityMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { request?: unknown }).request === AGENT_ACTIVITY_REQUEST &&
    typeof (message as { active?: unknown }).active === "boolean"
  );
}
