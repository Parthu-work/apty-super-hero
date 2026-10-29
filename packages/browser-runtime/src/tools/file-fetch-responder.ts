/**
 * Answers "get segments.json" without the model: a message that only asks
 * for one of the Apty Client's files runs the same privacy-wrapped
 * `inspect_extension_network` tool the model would call, so the chat shows
 * the same result and full-response viewer, and the session keeps the same
 * tool result for follow-up questions. A message with anything else in it
 * ("get segments.json and count the inactive ones") goes to the model.
 */
import type { FunctionTool, LocalResponder } from "@apty/agent-core";
import { browserToolGroups } from "./index.js";

const INSPECT = "inspect_extension_network";

const FILE_NAME = /^[\w./-]*\w\.(?:json|js|css|html|xml|txt|csv)$/i;
const VERBS = new Set([
  "get",
  "show",
  "read",
  "fetch",
  "open",
  "view",
  "display",
  "print",
  "give",
  "pull",
]);
const POLITE = new Set(["please", "can", "could", "would", "you"]);
const FILLER = new Set([
  ...VERBS,
  ...POLITE,
  "me",
  "us",
  "the",
  "a",
  "an",
  "data",
  "contents",
  "content",
  "body",
  "response",
  "raw",
  "full",
  "whole",
  "file",
  "of",
  "from",
  "in",
  "inside",
  "apty",
  "client",
  "client's",
  "again",
  "its",
]);

function bare(word: string): string {
  return word.replace(/^["'“‘`(]+|["'”’`),:;]+$/g, "");
}

/** @internal The resource a message asks for, when fetching it is all the message asks. */
export function routeFileRequest(
  message: string,
): { resourceQuery: string } | undefined {
  const words = message
    .trim()
    .replace(/[?!.]+$/, "")
    .split(/\s+/)
    .map(bare)
    .filter(Boolean);
  const files = words.filter((w) => FILE_NAME.test(w));
  if (files.length !== 1) return undefined;
  const rest = words
    .filter((w) => !FILE_NAME.test(w))
    .map((w) => w.toLowerCase());
  const verb = rest.find((w) => !POLITE.has(w));
  if (!verb || !VERBS.has(verb)) return undefined;
  if (!rest.every((w) => FILLER.has(w))) return undefined;
  return { resourceQuery: files[0] as string };
}

function inspectTool(): FunctionTool {
  const found = browserToolGroups.extensionNetwork.find(
    (t) => t.name === INSPECT,
  );
  if (!found) throw new Error(`${INSPECT} is not registered`);
  return found as unknown as FunctionTool;
}

export function createFileFetchResponder(
  tool: () => FunctionTool = inspectTool,
): LocalResponder {
  return async (input, { runContext }) => {
    const route = routeFileRequest(input);
    if (!route) return undefined;
    const result = await tool().invoke(
      { context: runContext } as never,
      JSON.stringify(route),
    );
    return {
      toolName: INSPECT,
      params: route,
      result,
      transcript: typeof result === "string" ? result : JSON.stringify(result),
    };
  };
}
