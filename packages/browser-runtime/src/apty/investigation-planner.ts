/**
 * Investigation planner.
 *
 * Answers "what should I investigate first?" for a reported problem,
 * deterministically — a small pattern registry maps recognizable problem
 * shapes (tooltip not showing, Studio can't select an element, works in
 * Studio but not production, workflow not triggering, widget not loading)
 * to a concrete ordered checklist of investigation steps with the tools
 * likely needed for each, falling back to a generic host-app → Apty
 * runtime → Studio → correlate plan for anything that doesn't match a
 * known pattern.
 *
 * This is a planning aid, not a constraint: the model is not required to
 * follow the plan verbatim or in order, and the registry is intentionally
 * small and easy to extend — add a new `PLAN_TEMPLATES` entry rather than
 * hard-coding new categories elsewhere.
 */

export interface PlanStep {
  id: string;
  description: string;
  suggestedTools: string[];
  status: "pending" | "done" | "skipped";
}

export interface InvestigationPlan {
  /** Which recognized problem pattern this plan matched, or "generic" if none did. */
  category: string;
  steps: PlanStep[];
}

interface PlanTemplate {
  category: string;
  /** Matches against a lowercased version of the user's problem description. */
  matches: (problemLower: string) => boolean;
  steps: Array<Omit<PlanStep, "status">>;
}

function step(
  id: string,
  description: string,
  suggestedTools: string[],
): Omit<PlanStep, "status"> {
  return { id, description, suggestedTools };
}

const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    category: "tooltip-not-showing",
    matches: (p) => p.includes("tooltip"),
    steps: [
      step("identify-page", "Identify the current page/application", [
        "get_page_metadata",
      ]),
      step(
        "check-runtime-state",
        "Check whether the Apty Client/Widget/Player is loaded and initialized",
        ["get_apty_client_diagnostics", "get_apty_widget_diagnostics"],
      ),
      step(
        "check-content-loaded",
        "Determine whether the relevant tooltip content was loaded",
        ["get_apty_widget_diagnostics", "get_apty_page_logs"],
      ),
      step("identify-target", "Identify the tooltip's target element", [
        "search_elements",
      ]),
      step(
        "check-frame-boundaries",
        "Check whether the target is inside an iframe or Shadow DOM",
        ["analyze_element_selectors"],
      ),
      step(
        "analyze-selector",
        "Analyze the configured selector against the live DOM",
        ["analyze_element_selectors"],
      ),
      step(
        "check-console-runtime",
        "Check console/runtime for related errors",
        ["get_apty_page_logs", "get_runtime_diagnostics"],
      ),
      step(
        "check-network",
        "Check for failed requests related to tooltip content",
        ["get_network_diagnostics"],
      ),
      step("correlate", "Correlate the collected evidence", [
        "get_investigation_timeline",
      ]),
      step("form-and-verify", "Form and verify a hypothesis", [
        "record_verification_attempt",
      ]),
    ],
  },
  {
    category: "studio-cannot-select",
    matches: (p) =>
      p.includes("studio") &&
      (p.includes("select") ||
        p.includes("can't pick") ||
        p.includes("cannot pick")),
    steps: [
      step(
        "check-studio-state",
        "Check Apty Studio's connection/selection state",
        ["get_apty_studio_diagnostics"],
      ),
      step("identify-page", "Identify the current page", ["get_page_metadata"]),
      step("identify-target", "Identify the target element", [
        "search_elements",
      ]),
      step(
        "check-frame-boundaries",
        "Check whether the target is inside an iframe (same/cross-origin) or Shadow DOM (open/closed)",
        ["analyze_element_selectors"],
      ),
      step(
        "analyze-selector-candidates",
        "Generate and rank selector candidates for the target",
        ["analyze_element_selectors"],
      ),
      step(
        "check-dom-lifecycle",
        "Check whether the element is dynamically created/replaced after render",
        ["get_runtime_diagnostics"],
      ),
      step("determine-failure", "Determine why selection is failing", [
        "get_investigation_timeline",
      ]),
      step("verify", "Verify the determined cause", [
        "record_verification_attempt",
      ]),
    ],
  },
  {
    category: "studio-vs-production",
    matches: (p) =>
      (p.includes("studio") ||
        p.includes("staging") ||
        p.includes("preview")) &&
      (p.includes("production") ||
        p.includes("prod ") ||
        p.includes("live site")) &&
      (p.includes("work") ||
        p.includes("doesn't") ||
        p.includes("does not") ||
        p.includes("fail")),
    steps: [
      step(
        "inspect-studio-config",
        "Inspect the Studio-side content/selector configuration",
        ["get_apty_studio_diagnostics"],
      ),
      step("inspect-publish-state", "Check content publish/environment state", [
        "get_apty_studio_diagnostics",
      ]),
      step("inspect-production-page", "Inspect the production page", [
        "get_page_metadata",
        "search_elements",
      ]),
      step(
        "check-runtime-state",
        "Check the Apty Client/Widget/Player on production",
        ["get_apty_client_diagnostics", "get_apty_widget_diagnostics"],
      ),
      step(
        "check-content-loading",
        "Check whether content loaded and target resolution succeeded on production",
        ["get_apty_widget_diagnostics", "get_network_diagnostics"],
      ),
      step(
        "analyze-selector-on-production",
        "Analyze the configured selector against the production DOM specifically",
        ["analyze_element_selectors"],
      ),
      step(
        "compare",
        "Compare Studio's expected state against production's actual state",
        ["get_investigation_timeline"],
      ),
      step("verify", "Verify the identified discrepancy", [
        "record_verification_attempt",
      ]),
    ],
  },
  {
    category: "workflow-not-triggering",
    matches: (p) =>
      p.includes("workflow") &&
      (p.includes("trigger") ||
        p.includes("start") ||
        p.includes("run") ||
        p.includes("execute")),
    steps: [
      step(
        "check-runtime-state",
        "Check whether the Apty Client/Widget/Player is initialized",
        ["get_apty_client_diagnostics"],
      ),
      step(
        "check-content-loaded",
        "Determine whether the workflow's content/config loaded",
        ["get_apty_widget_diagnostics"],
      ),
      step(
        "identify-trigger-target",
        "Identify the workflow's trigger/target element",
        ["search_elements"],
      ),
      step(
        "analyze-trigger-selector",
        "Analyze the trigger selector against the live DOM",
        ["analyze_element_selectors"],
      ),
      step(
        "check-display-conditions",
        "Check for display-condition or environment mismatches (Studio side)",
        ["get_apty_studio_diagnostics"],
      ),
      step(
        "check-console-runtime",
        "Check for runtime errors during execution",
        ["get_apty_page_logs", "get_runtime_diagnostics"],
      ),
      step("check-network", "Check network requests around the trigger", [
        "get_network_diagnostics",
      ]),
      step("correlate", "Correlate collected evidence", [
        "get_investigation_timeline",
      ]),
      step("verify", "Verify the identified cause", [
        "record_verification_attempt",
      ]),
    ],
  },
  {
    category: "widget-not-loading",
    matches: (p) =>
      (p.includes("widget") || p.includes("client") || p.includes("player")) &&
      (p.includes("not loading") ||
        p.includes("not initializ") ||
        p.includes("won't load") ||
        p.includes("doesn't load") ||
        p.includes("blank")),
    steps: [
      step("identify-page", "Identify the current page/application", [
        "get_page_metadata",
      ]),
      step(
        "check-client-status",
        "Check the Apty Client's loaded/initialized status",
        ["get_apty_client_diagnostics"],
      ),
      step(
        "check-widget-status",
        "Check the Apty Widget's loaded/initialized status",
        ["get_apty_widget_diagnostics"],
      ),
      step(
        "check-console-errors",
        "Check for console/runtime errors during load",
        ["get_apty_page_logs", "get_runtime_diagnostics"],
      ),
      step(
        "check-network",
        "Check for failed requests loading Client/Widget resources",
        ["get_network_diagnostics"],
      ),
      step(
        "check-service-worker",
        "Check the Apty service worker, if the Client/Widget relies on one",
        ["get_apty_service_worker_diagnostics"],
      ),
      step("correlate", "Correlate collected evidence", [
        "get_investigation_timeline",
      ]),
      step("verify", "Verify the identified cause", [
        "record_verification_attempt",
      ]),
    ],
  },
];

/** Generic fallback plan for problems that don't match a known pattern — the same host-app → Apty runtime → Studio → correlate → verify shape the product brief's debugging loop describes. */
const GENERIC_PLAN_STEPS: Array<Omit<PlanStep, "status">> = [
  step("identify-page", "Identify the current page/application", [
    "get_page_metadata",
  ]),
  step("check-runtime-state", "Check the Apty Client/Widget/Player's status", [
    "get_apty_client_diagnostics",
    "get_apty_widget_diagnostics",
  ]),
  step("identify-target", "Identify any relevant target element", [
    "search_elements",
  ]),
  step(
    "check-frame-boundaries",
    "Check for iframe/Shadow DOM boundaries around the target, if any",
    ["analyze_element_selectors"],
  ),
  step("check-console-runtime", "Check console/runtime for related errors", [
    "get_apty_page_logs",
    "get_runtime_diagnostics",
  ]),
  step("check-network", "Check for related failed network requests", [
    "get_network_diagnostics",
  ]),
  step(
    "check-studio",
    "Check Apty Studio state, if the problem may involve configuration",
    ["get_apty_studio_diagnostics"],
  ),
  step("correlate", "Correlate the collected evidence", [
    "get_investigation_timeline",
  ]),
  step("form-and-verify", "Form and verify a hypothesis", [
    "record_verification_attempt",
  ]),
];

/**
 * Build a deterministic investigation plan for a reported problem. Always
 * returns a usable plan — falls back to `GENERIC_PLAN_STEPS` (category
 * `"generic"`) when no specific pattern matches, rather than returning
 * nothing.
 */
export function planInvestigation(userProblem: string): InvestigationPlan {
  const problemLower = userProblem.toLowerCase();
  const template = PLAN_TEMPLATES.find((t) => t.matches(problemLower));
  const source = template?.steps ?? GENERIC_PLAN_STEPS;

  return {
    category: template?.category ?? "generic",
    steps: source.map((s) => ({ ...s, status: "pending" as const })),
  };
}
