/**
 * An investigation with something in every part of the summary bar,
 * produced by the real tools: the panel keeps investigations and evidence
 * in memory only, so they are made by scripting the mock model instead of
 * being stored.
 *
 * The page asks for a widget configuration that is not there (404) and
 * throws with it, every 400 ms. The chat needs a session first: tools in a
 * new chat's first turn record under "pending", which the bar does not show
 * once the session exists, so the test greets before it investigates. The
 * steps start an investigation
 * (its plan comes from the planner), watch the network and read the
 * runtime errors (one cluster, flagged as a likely related incident), wait
 * past the correlation window and check the Apty Client (a second cluster,
 * and the component health), then mark one plan step done and one skipped,
 * add a hypothesis with its evidence and record a diagnosis.
 */

export const INVESTIGATION_PAGE = `<title>Orders</title>
<main><h1>Orders</h1></main>
<script>
  setInterval(() => {
    fetch("/api/widget-config.json").catch(() => {});
    setTimeout(() => {
      throw new Error("Apty widget: configuration request failed");
    });
  }, 400);
</script>`;

export const INVESTIGATION_PROMPT =
  "investigate why the apty widget doesn't load: check the console error and the network request";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function investigationOf(results) {
  return results.findLast((r) => r?.investigation)?.investigation;
}

/** The tool calls of the first turn, each given the results so far. */
export const INVESTIGATION_STEPS = [
  () => ({
    tool: "start_investigation",
    args: {
      userProblem: "The Apty widget doesn't load on Orders",
      suspectedComponents: ["apty-client-widget-player"],
    },
  }),
  () => ({
    tool: "get_network_diagnostics",
    args: { windowMs: 1500, onlyErrors: true },
  }),
  () => ({ tool: "get_runtime_diagnostics", args: { windowMs: 1000 } }),
  async () => {
    await sleep(2500);
    return { tool: "get_apty_client_diagnostics", args: {} };
  },
  () => ({ tool: "get_investigation_timeline", args: { windowMs: 2000 } }),
  (results) => {
    const [first, second] = investigationOf(results).plan.steps;
    return {
      tool: "update_investigation",
      args: {
        status: "analyzing",
        completedPlanStepId: first.id,
        skippedPlanStepId: second.id,
        addHypothesis: "The widget's configuration request fails",
      },
    };
  },
  (results) => {
    const timeline = results.findLast((r) => r?.clusters);
    const [hypothesis] = investigationOf(results).hypotheses;
    return {
      tool: "update_investigation",
      args: {
        updateHypothesis: {
          id: hypothesis.id,
          status: "supported",
          addSupportingEvidenceId: timeline.clusters[0].evidence[0].evidenceId,
        },
        diagnosis:
          "The widget's configuration request returns 404, so the widget never starts",
        confidence: "likely",
      },
    };
  },
];

/** The tool calls that move the diagnosis to `confidence`, in a later turn. */
export function confidenceSteps(confidence) {
  const update = () => ({
    tool: "update_investigation",
    args: { confidence },
  });
  return confidence === "confirmed"
    ? [
        () => ({
          tool: "record_verification_attempt",
          args: {
            outcome: "confirmed",
            notes: "The request still returns 404",
          },
        }),
        update,
      ]
    : [update];
}
