import type { LocalResponder } from "@apty/agent-core";
import { getAptyIntegrationConfig } from "../config.js";
import { diagnoseContentNotVisible, filesFor } from "./content-not-visible.js";
import { loadClientEvidence } from "./loader.js";
import { routeSymptom } from "./router.js";
import type { DiagnosisResult, NextCheck, NotChecked } from "./types.js";

export const RUN_DIAGNOSIS = "run_diagnosis";

const MAX_SCAN_ROWS_IN_TRANSCRIPT = 30;

const NEXT_CHECK_TEXT: Record<NextCheck, string> = {
  fixConnection:
    "Fix the connection to the Apty Client first; this is not evidence about the content.",
  reload: "Reload the problem page, then check again.",
  readStatus:
    "An empty list has several causes (nothing published here, a failed load, a failed schema check): read its status code and the Console next.",
  fixRequest: "Fix the failing request first.",
  waitForLoad: "Wait for the page to finish loading, then check again.",
  denyList:
    "Remove the entry from Settings > Data handling > body deny list to let this file be checked.",
  bodyLimit:
    "The Client did not keep this body (size limit or eviction). Reload and check again, or paste the file.",
  openResponse: "Open the response and see what the server returned.",
  manual4x: "Use the manual paste path for 4.x.",
  nameItem: "Name the item that is missing to check it in full.",
  whichOne: "Give the full name or the sourceId of the one that is missing.",
  testAsMember:
    "Test as a user known to match the segment, and confirm the widget shows for that user.",
  openItems: "Then check the open items, which the files cannot decide.",
  sendSupport:
    "Send support the Apty version, the environment name, the sourceId, a screenshot of the open widget and the trimmed entry with its request URL and status.",
};

const NOT_CHECKED_TEXT: Record<NotChecked, string> = {
  membership: "whether this user matches a segment's rule",
  "runtime-rules": "the visibility, later and recurrence rules",
};

/** What the session keeps of a check, for the model to read on later turns. */
export function transcriptOf(result: DiagnosisResult): string {
  const { verdict, subject } = result;
  const lines = [
    `Visibility check of ${subject.kind}${subject.query ? ` "${subject.query}"` : "s"} from the Apty Client's files (KB card ${result.cardPageId}; ${result.verifiedOn}).`,
    `Result: ${verdict.status.replace(/_/g, " ")}. ${verdict.headline}`,
    ...verdict.causes.map(
      (c) => `- ${c.ruleId}: ${c.summary} Fix: ${c.fix} (card ${c.cardPageId})`,
    ),
    ...result.gates
      .filter((g) => g.status === "unknown")
      .map((g) => `- Open: ${g.detail}`),
    ...(result.scan?.rows
      .filter((r) => r.blockers.length > 0)
      .slice(0, MAX_SCAN_ROWS_IN_TRANSCRIPT)
      .map((r) => `- ${r.name}: ${r.blockers.join(", ")}`) ?? []),
    ...(verdict.nextCheck
      ? [`Next: ${NEXT_CHECK_TEXT[verdict.nextCheck]}`]
      : []),
    ...(result.notChecked.length > 0
      ? [
          `Not checked from the files: ${result.notChecked.map((n) => NOT_CHECKED_TEXT[n]).join("; ")}.`,
        ]
      : []),
  ];
  return lines.join("\n");
}

/**
 * Answers a message the router recognises from the Apty Client's files, so
 * the chat can show the check without a model call. Anything else returns
 * undefined and goes to the model.
 */
export function createDiagnosisResponder(
  clientExtensionId: () => Promise<string | undefined> = async () =>
    (await getAptyIntegrationConfig()).clientExtensionId,
): LocalResponder {
  return async (input) => {
    const route = routeSymptom(input);
    if (!route) return undefined;
    const evidence = await loadClientEvidence(
      await clientExtensionId(),
      filesFor(route.kind),
    );
    const result = diagnoseContentNotVisible(evidence, route.kind, route.query);
    return {
      toolName: RUN_DIAGNOSIS,
      params: {
        kind: route.kind,
        ...(route.query ? { name: route.query } : {}),
      },
      result,
      transcript: transcriptOf(result),
    };
  };
}
