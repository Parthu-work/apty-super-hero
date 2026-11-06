import { z } from "zod";

/** The marker every KB pack carries; `tooling/scripts/check-no-kb-pack.mjs` fails the repository on it. */
export const KB_PACK_KIND = "apty-kb-pack";
export const KB_PACK_SCHEMA_VERSION = 1;
export const KB_PACK_LIMITS = {
  maxChunks: 5000,
  maxBytes: 25 * 1024 * 1024,
  maxChunkChars: 1000,
} as const;

export const KB_LAYERS = [1, 2, 3, 4] as const;
export type KbLayer = (typeof KB_LAYERS)[number];

const layerSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

const cardSchema = z.object({
  pageId: z.string().regex(/^\d+$/),
  title: z.string(),
  group: z.string(),
  verifiedOn: z.string().nullable(),
  notVerifiedCount: z.number().int().nonnegative(),
  url: z
    .string()
    .regex(/^https:\/\/[^/\s]+\/wiki\/spaces\/[^/\s]+\/pages\/\d+$/),
  updatedAt: z.string(),
});

const chunkSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  layer: layerSchema,
  heading: z.string(),
  text: z.string().max(KB_PACK_LIMITS.maxChunkChars),
  notVerified: z.boolean(),
});

const packSchema = z.object({
  kind: z.literal(KB_PACK_KIND),
  schemaVersion: z.literal(KB_PACK_SCHEMA_VERSION),
  builtAt: z.string(),
  builder: z.string(),
  source: z.object({
    site: z.string(),
    space: z.string(),
    label: z.string(),
    cardCount: z.number().int().nonnegative(),
  }),
  aptyVersion: z.literal("5.x"),
  retrieval: z.object({
    bm25: z.literal(true),
    /** The lowest top BM25 score that counts as covered, calibrated by `eval-kb.mjs`. */
    threshold: z.number().nonnegative().optional(),
    dense: z
      .object({
        model: z.string(),
        dims: z.number().int().positive(),
        /** The lowest top cosine similarity that counts as covered. */
        threshold: z.number().min(-1).max(1).optional(),
      })
      .optional(),
  }),
  cards: z.array(cardSchema),
  chunks: z.array(chunkSchema),
  vectors: z.string().optional(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export type KbPack = z.infer<typeof packSchema>;
export type KbCard = z.infer<typeof cardSchema>;
export type KbChunk = z.infer<typeof chunkSchema>;

export type KbPackErrorCode =
  | "too_large"
  | "not_json"
  | "wrong_kind"
  | "wrong_schema_version"
  | "invalid"
  | "checksum_mismatch";

export type KbPackParseResult =
  | { ok: true; pack: KbPack }
  | { ok: false; code: KbPackErrorCode; detail?: string };

/** SHA-256 of UTF-8 text as lower-case hex; Web Crypto in the browser, injected so this module stays platform-free. */
export type Sha256Hex = (text: string) => Promise<string>;

/** Keys sorted at every level, no whitespace: the text a pack's `sha256` covers (same as the builder's). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function integrityProblem(pack: KbPack): string | undefined {
  const cardIds = new Set<string>();
  for (const card of pack.cards) {
    if (cardIds.has(card.pageId)) return `card ${card.pageId} appears twice`;
    cardIds.add(card.pageId);
  }
  if (pack.source.cardCount !== pack.cards.length) {
    return "source.cardCount does not match the cards";
  }
  for (const chunk of pack.chunks) {
    if (!cardIds.has(chunk.pageId)) {
      return `chunk ${chunk.id} names no card`;
    }
    if (chunk.id !== `${chunk.pageId}#L${chunk.layer}`) {
      return `chunk ${chunk.id} does not match its page and layer`;
    }
  }
  const dense = pack.retrieval.dense;
  if (dense && pack.vectors === undefined)
    return "dense retrieval without vectors";
  if (pack.vectors !== undefined) {
    if (!dense) return "vectors without dense retrieval";
    const bytes = decodedLength(pack.vectors);
    if (bytes !== pack.chunks.length * dense.dims * 4) {
      return "vectors do not match the chunks and dims";
    }
  }
  return undefined;
}

function decodedLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

/** The pack's vectors as one Float32Array per chunk, in chunk order. */
export function decodeVectors(pack: KbPack): Float32Array[] {
  const dense = pack.retrieval.dense;
  if (!dense || pack.vectors === undefined) return [];
  const binary = atob(pack.vectors);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const all = new Float32Array(bytes.buffer);
  return pack.chunks.map((_, i) =>
    all.subarray(i * dense.dims, (i + 1) * dense.dims),
  );
}

/**
 * Parses an imported pack file. The pack is untrusted input: its size is
 * checked before parsing, then its kind, schema version, shape, limits,
 * internal references and checksum, each failure with its own code.
 */
export async function parseKbPack(
  text: string,
  { sha256 }: { sha256: Sha256Hex },
): Promise<KbPackParseResult> {
  if (new TextEncoder().encode(text).length > KB_PACK_LIMITS.maxBytes) {
    return { ok: false, code: "too_large" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: "not_json" };
  }
  const record =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  if (record.kind !== KB_PACK_KIND) return { ok: false, code: "wrong_kind" };
  if (record.schemaVersion !== KB_PACK_SCHEMA_VERSION) {
    return { ok: false, code: "wrong_schema_version" };
  }
  const parsed = packSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      code: "invalid",
      detail: issue ? `${issue.path.join(".")}: ${issue.message}` : undefined,
    };
  }
  const pack = parsed.data;
  if (pack.chunks.length > KB_PACK_LIMITS.maxChunks) {
    return { ok: false, code: "too_large" };
  }
  const problem = integrityProblem(pack);
  if (problem) return { ok: false, code: "invalid", detail: problem };
  const { sha256: expected, ...rest } = record;
  if ((await sha256(canonicalJson(rest))) !== expected) {
    return { ok: false, code: "checksum_mismatch" };
  }
  return { ok: true, pack };
}
