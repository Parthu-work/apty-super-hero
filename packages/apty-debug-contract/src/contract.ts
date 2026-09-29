/**
 * Apty debug-bridge wire contract v1.
 *
 * This is the ONLY thing a producer (Apty Client, Apty Studio, or the fake
 * fixture extensions in tooling/e2e) and the consumer (the Apty Agent
 * extension, via `packages/browser-runtime/src/apty/peer/`) both depend on.
 * Neither side reaches into the other's internals — everything crosses this
 * envelope, validated by the schemas below.
 *
 * Pull, not push (see DECISIONS.md): the agent always asks; a producer never
 * calls the agent unsolicited. This keeps a producer's obligations small (one
 * listener, one buffer) and never requires it to know the agent's identity
 * beyond checking `sender.id` against its own allow-list.
 */
import { z } from "zod";

export const CONTRACT_VERSION = 1 as const;

/** The message-type prefix every real request uses — `type` is always `${MESSAGE_PREFIX}${verb}`. */
export const MESSAGE_PREFIX = "apty-debug-agent:";

export const CONTRACT_VERBS = [
  "ping",
  "get-logs",
  "get-network",
  "set-capture",
  "clear",
] as const;
export type ContractVerb = (typeof CONTRACT_VERBS)[number];

/**
 * Verbs an OLDER, pre-contract producer might still speak. The agent's peer
 * client keeps parsing these so a producer that hasn't adopted contract v1
 * yet still yields SOME evidence — never silently nothing. New producers
 * should implement the v1 verbs above instead.
 */
export const LEGACY_VERBS = [
  "get-service-worker-status",
  "get-service-worker-logs",
  "list-observed-resources",
  "get-resource-body",
  "get-studio-status",
  "get-studio-logs",
] as const;
export type LegacyVerb = (typeof LEGACY_VERBS)[number];

/**
 * Outcome codes for one attempt to reach a peer (`ExtensionPeerClient`).
 * Every attempt resolves to `ok` or exactly one of these — never `undefined`,
 * never a bare thrown error the caller has to interpret.
 */
export const PEER_ERROR_CODES = [
  "not_installed",
  "disabled",
  "not_allowlisted_or_no_listener",
  "timeout",
  "invalid_response",
  "contract_mismatch",
  "identity_mismatch",
  "peer_error",
  "not_approved",
] as const;
export type PeerErrorCode = (typeof PEER_ERROR_CODES)[number];

/** Verb-level error codes a producer's own handler may return inside `{ok:false, error}`. Open-ended (`error.code` is a plain string) — this list is documentation, not a closed enum a producer must conform to. */
export const KNOWN_VERB_ERROR_CODES = [
  "unknown_verb",
  "invalid_params",
  "capture_disabled",
  "internal_error",
] as const;

export const logLevelSchema = z.enum([
  "trace",
  "debug",
  "log",
  "info",
  "warn",
  "error",
]);
export type LogLevel = z.infer<typeof logLevelSchema>;

export const logContextSchema = z.enum([
  "service-worker",
  "content-script",
  "popup",
]);
export type LogContext = z.infer<typeof logContextSchema>;

export const logEntrySchema = z.object({
  seq: z.number().int().nonnegative(),
  ts: z.number(),
  level: logLevelSchema,
  message: z.string().max(4000),
  context: logContextSchema,
  tabId: z.number().int().optional(),
  frameId: z.number().int().optional(),
  url: z.string().optional(),
});
export type LogEntry = z.infer<typeof logEntrySchema>;

export const networkEntrySchema = z.object({
  seq: z.number().int().nonnegative(),
  ts: z.number(),
  method: z.string(),
  url: z.string(),
  status: z.number().int().optional(),
  requestHeaders: z.record(z.string(), z.string()).optional(),
  responseHeaders: z.record(z.string(), z.string()).optional(),
  error: z.string().optional(),
});
export type NetworkEntry = z.infer<typeof networkEntrySchema>;

export const capabilitySchema = z.enum(["logs", "network", "capture-control"]);
export type Capability = z.infer<typeof capabilitySchema>;

const bufferStatsSchema = z.object({
  count: z.number().int().nonnegative(),
  oldestSeq: z.number().int().nonnegative().nullable(),
  newestSeq: z.number().int().nonnegative().nullable(),
  dropped: z.number().int().nonnegative(),
});

/**
 * `ping`'s response — deliberately the MOST strictly validated shape in this
 * contract. `product`, `extensionId`, and `contractVersion` are all
 * REQUIRED (the previous handshake made every field of this shape optional,
 * so an unrelated extension replying `{}` was reported "connected" — see
 * DECISIONS.md's identity-verification ADR).
 */
export const pingDataSchema = z.object({
  product: z.enum(["apty-client", "apty-studio"]),
  extensionId: z.string().min(1),
  version: z.string(),
  contractVersion: z.number().int().positive(),
  capabilities: z.array(capabilitySchema),
  now: z.number(),
  swStartedAt: z.number(),
  captureEnabled: z.boolean(),
  buffers: z.object({
    logs: bufferStatsSchema,
    network: bufferStatsSchema.optional(),
  }),
});
export type PingData = z.infer<typeof pingDataSchema>;

export const getLogsParamsSchema = z.object({
  sinceSeq: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(500).optional(),
  minLevel: logLevelSchema.optional(),
  contexts: z.array(logContextSchema).optional(),
});
export type GetLogsParams = z.infer<typeof getLogsParamsSchema>;

export const getLogsResponseSchema = z.object({
  entries: z.array(logEntrySchema),
  nextSeq: z.number().int().nonnegative(),
  oldestSeq: z.number().int().nonnegative().nullable(),
  dropped: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type GetLogsResponse = z.infer<typeof getLogsResponseSchema>;

export const getNetworkParamsSchema = z.object({
  sinceSeq: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(500).optional(),
  urlFilter: z.string().optional(),
});
export type GetNetworkParams = z.infer<typeof getNetworkParamsSchema>;

export const getNetworkResponseSchema = z.object({
  entries: z.array(networkEntrySchema),
  nextSeq: z.number().int().nonnegative(),
  oldestSeq: z.number().int().nonnegative().nullable(),
  dropped: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type GetNetworkResponse = z.infer<typeof getNetworkResponseSchema>;

export const setCaptureParamsSchema = z.object({
  enabled: z.boolean(),
  ttlMs: z.number().int().positive().optional(),
});
export type SetCaptureParams = z.infer<typeof setCaptureParamsSchema>;

export const setCaptureResponseSchema = z.object({
  captureEnabled: z.boolean(),
});
export type SetCaptureResponse = z.infer<typeof setCaptureResponseSchema>;

export const clearResponseSchema = z.object({}).strict();
export type ClearResponse = z.infer<typeof clearResponseSchema>;

/** Per-verb param/response schema pairs — the peer client picks the right one after unwrapping the envelope. */
export const VERB_SCHEMAS = {
  ping: { params: z.object({}).strict().optional(), response: pingDataSchema },
  "get-logs": { params: getLogsParamsSchema, response: getLogsResponseSchema },
  "get-network": {
    params: getNetworkParamsSchema,
    response: getNetworkResponseSchema,
  },
  "set-capture": {
    params: setCaptureParamsSchema,
    response: setCaptureResponseSchema,
  },
  clear: {
    params: z.object({}).strict().optional(),
    response: clearResponseSchema,
  },
} as const satisfies Record<
  ContractVerb,
  { params: z.ZodTypeAny; response: z.ZodTypeAny }
>;

export const requestEnvelopeSchema = z.object({
  v: z.literal(CONTRACT_VERSION),
  type: z.string().startsWith(MESSAGE_PREFIX),
  requestId: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type RequestEnvelope = z.infer<typeof requestEnvelopeSchema>;

export const responseErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type ResponseError = z.infer<typeof responseErrorSchema>;

export const responseEnvelopeSchema = z.discriminatedUnion("ok", [
  z.object({
    v: z.literal(CONTRACT_VERSION),
    requestId: z.string().min(1),
    ok: z.literal(true),
    data: z.unknown(),
  }),
  z.object({
    v: z.literal(CONTRACT_VERSION),
    requestId: z.string().min(1),
    ok: z.literal(false),
    error: responseErrorSchema,
  }),
]);
export type ResponseEnvelope = z.infer<typeof responseEnvelopeSchema>;

/** Build a request envelope for `verb`. `requestId` must be caller-supplied (a real UUID) so retries/timeouts can be correlated. */
export function buildRequest<V extends ContractVerb>(
  verb: V,
  requestId: string,
  params?: Record<string, unknown>,
): RequestEnvelope {
  return {
    v: CONTRACT_VERSION,
    type: `${MESSAGE_PREFIX}${verb}`,
    requestId,
    params,
  };
}

/** Strip the `MESSAGE_PREFIX` from a request's `type`, returning the verb name (contract v1 or legacy) or `null` if the message isn't shaped like one of ours at all. */
export function parseVerb(type: unknown): ContractVerb | LegacyVerb | null {
  if (typeof type !== "string") return null;
  if (LEGACY_VERBS.includes(type as LegacyVerb)) return type as LegacyVerb;
  if (!type.startsWith(MESSAGE_PREFIX)) return null;
  const verb = type.slice(MESSAGE_PREFIX.length);
  return CONTRACT_VERBS.includes(verb as ContractVerb)
    ? (verb as ContractVerb)
    : null;
}
