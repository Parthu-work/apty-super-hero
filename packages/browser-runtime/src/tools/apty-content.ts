/**
 * The model's way to Apty's published content when the Apty Client does not
 * report its calls: the same read-only GETs the player makes, fetched by the
 * Agent (`../apty/replay/`). The check packs call the same functions without
 * the model.
 *
 * SECURITY: no tool takes a URL. The host is the page's Apty content URL or
 * an origin the organization policy names (`contentOrigin` must be one of
 * them); a file must be in the player's catalogue; IDs must be plain path
 * segments. Bodies pass the body deny list and redaction before the model
 * sees a summary, and live in memory for the case only.
 */
import {
  type AptyContentContext,
  type AptyFileResult,
  tool,
} from "@apty/agent-core";
import { z } from "zod";
import { recordEvidence } from "../apty/evidence-store.js";
import { MAX_INLINE_BODY_CHARS } from "../apty/extension-network-inspector.js";
import { recordToolCall } from "../apty/index.js";
import { summarizeJsonBody } from "../apty/json-body-summary.js";
import {
  caseReplay,
  pinContext,
  pinnedContext,
} from "../apty/replay/case-replay.js";
import type { ToolRunContext } from "./tab-utils";

const ID = z
  .string()
  .regex(/^[\w-]{1,128}$/)
  .describe("An Apty ID as the SE gave it (letters, digits, - and _).");

const runOf = (context: unknown) => (context as ToolRunContext)?.context;

/** What a context says about itself; the host only as an origin. */
function describe(context: AptyContentContext) {
  return {
    version: context.version,
    tenantId: context.tenantId,
    applicationId: context.applicationId,
    environmentId: context.environmentId,
    mode: context.mode,
    idsFrom: context.idsFrom,
    contentHost: new URL(context.contentURL).origin,
  };
}

/** The case's pinned context, or the one the page shows. */
async function contextFor(context: unknown) {
  const run = runOf(context);
  const pinned = pinnedContext(run?.conversationId);
  const replay = caseReplay(run?.conversationId, run?.tabId ?? undefined);
  if (pinned) return { ok: true as const, context: pinned, replay };
  const resolved = await replay.source.resolveContext();
  return resolved.ok
    ? { ok: true as const, context: resolved.context, replay }
    : { ...resolved, replay };
}

export const resolveAptyContextTool = tool({
  name: "resolve_apty_context",
  description:
    "Find the Apty tenant, application, environment, version and mode for this case: from the IDs the SE gave (pass them), or else from the page's Apty config and its URL. " +
    "IDs given here are pinned for the case: the checks then read the published files for them. Read-only; makes at most one request (app-urls.json). " +
    "On failure returns a named reason: ids_missing, no_apty, host_not_allowed, no_environment_match, or a fetch failure.",
  parameters: z.object({
    tenantId: ID.optional(),
    applicationId: ID.optional(),
    environmentId: ID.optional(),
    version: z.enum(["4.x", "5.x"]).optional(),
    contentOrigin: z
      .string()
      .optional()
      .describe(
        "Only when the SE names a content host and the page has no Apty: must be an origin the organization policy allows.",
      ),
  }),
  execute: async (input, context) => {
    const run = runOf(context);
    recordToolCall(run?.conversationId, "resolve_apty_context");
    const replay = caseReplay(run?.conversationId, run?.tabId ?? undefined);
    const resolved = await replay.source.resolveContext({
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.applicationId ? { applicationId: input.applicationId } : {}),
      ...(input.environmentId ? { environmentId: input.environmentId } : {}),
      ...(input.version ? { version: input.version } : {}),
      ...(input.contentOrigin ? { contentURL: input.contentOrigin } : {}),
    });
    if (!resolved.ok) return resolved;
    const given = Boolean(
      input.tenantId || input.applicationId || input.environmentId,
    );
    if (given) pinContext(run?.conversationId, resolved.context);
    return { ok: true, pinned: given, ...describe(resolved.context) };
  },
});

export const listAptyFilesTool = tool({
  name: "list_apty_files",
  description:
    "List the content files the Apty player requests for this case's tenant, application and environment, with each one's scope and purpose, and for 5.x whether content-config.json lists a publish time for it. " +
    "Read-only; makes at most one request (content-config.json).",
  parameters: z.object({}),
  execute: async (_input, context) => {
    recordToolCall(runOf(context)?.conversationId, "list_apty_files");
    const found = await contextFor(context);
    if (!found.ok)
      return { ok: false, failure: found.failure, detail: found.detail };
    const { context: ctx, replay } = found;
    const files = replay.source.listFiles(ctx.version);
    let listed: (scope: string, name: string) => boolean | undefined = () =>
      undefined;
    if (ctx.version === "5.x") {
      const config = await replay.source.fetchFile(ctx, "content-config.json");
      if (config.ok) {
        const json = config.json as Record<string, unknown>;
        const app = (json[`app-${ctx.applicationId}`] ?? {}) as Record<
          string,
          unknown
        >;
        const env = (app[`env-${ctx.environmentId}`] ?? {}) as Record<
          string,
          unknown
        >;
        listed = (scope, name) =>
          scope === "tenant"
            ? name in json
            : scope === "application"
              ? name in app
              : scope === "environment"
                ? name in env
                : undefined;
      }
    }
    return {
      ok: true,
      ...describe(ctx),
      files: files.map((f) => ({
        name: f.name,
        scope: f.scope,
        purpose: f.purpose,
        ...(f.needs ? { needs: f.needs } : {}),
        ...(listed(f.scope, f.name) !== undefined
          ? { inContentConfig: listed(f.scope, f.name) }
          : {}),
      })),
      note: "inContentConfig says whether content-config.json lists a publish time; fetch_apty_file is the proof a file is published now.",
    };
  },
});

function failureOut(result: AptyFileResult & { ok: false }) {
  return {
    ok: false,
    file: result.file,
    failure: result.failure,
    ...(result.httpStatus !== undefined
      ? { httpStatus: result.httpStatus }
      : {}),
    detail: result.detail,
  };
}

export const fetchAptyFileTool = tool({
  name: "fetch_apty_file",
  description:
    "Fetch one of Apty's published content files for this case (the same GET the player makes, by the Agent, no credentials), e.g. 'tooltip.json', 'segment.json', 'workflow-<id>.json'. " +
    "Returns 'published now', not proof of what the Apty Client loaded. Read response.json (root type, item count, keys) first, then page with get_evidence_json(evidenceId, path). " +
    "Named failures: not_published, http_<code>, network, timeout, schema_mismatch, host_not_allowed, ids_missing, body_denied (do not try another way), too_large, unparsable, unknown_file. Never fabricated.",
  parameters: z.object({
    file: z
      .string()
      .min(1)
      .max(200)
      .describe("A file name from list_apty_files, or workflow-<id>.json."),
    workflowId: ID.optional(),
    userId: ID.optional(),
    chatId: ID.optional(),
    fresh: z
      .boolean()
      .default(false)
      .describe(
        "Ask the host again instead of the copy fetched earlier in this case.",
      ),
  }),
  execute: async ({ file, workflowId, userId, chatId, fresh }, context) => {
    const run = runOf(context);
    recordToolCall(run?.conversationId, "fetch_apty_file", { file });
    const found = await contextFor(context);
    if (!found.ok)
      return { ok: false, file, failure: found.failure, detail: found.detail };
    const result = await found.replay.source.fetchFile(
      found.context,
      file,
      {
        ...(workflowId ? { workflowId } : {}),
        ...(userId ? { userId } : {}),
        ...(chatId ? { chatId } : {}),
      },
      { fresh },
    );
    if (!result.ok) return failureOut(result);
    const evidence = recordEvidence({
      conversationId: run?.conversationId,
      source: "network",
      type: "network-response",
      timestamp: result.fetchedAt,
      tabId: null,
      scope: "shared",
      requestId: `replay:${result.path}`,
      url: `${found.context.contentURL}/${result.path}`,
      data: {
        replay: true,
        resourceName: file,
        status: result.httpStatus,
        mimeType: "application/json",
        isBinary: false,
        body: result.text,
      },
    });
    const summarized = summarizeJsonBody(result.text, MAX_INLINE_BODY_CHARS);
    return {
      ok: true,
      file,
      source: "published file, fetched by the Agent",
      httpStatus: result.httpStatus,
      fetchedAt: new Date(result.fetchedAt).toISOString(),
      fromCache: result.fromCache,
      ...describe(found.context),
      response: {
        evidenceId: evidence.evidenceId,
        json: summarized?.summary,
        bodyPreview:
          summarized?.preview ?? result.text.slice(0, MAX_INLINE_BODY_CHARS),
      },
    };
  },
});

export const aptyContentTools = [
  resolveAptyContextTool,
  listAptyFilesTool,
  fetchAptyFileTool,
];
