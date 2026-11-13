import { z } from "zod";
import type { KbPackSignature, KbPackUsability } from "./pack-signature.js";

/** The marker every KB pack carries; `tooling/scripts/check-no-kb-pack.mjs` fails the repository on it. */
export const KB_PACK_KIND = "apty-kb-pack";
/** The schema the builder writes (K23: signed, with `expiresAt`); `parseKbPack` also reads schema 1 and 2. */
export const KB_PACK_SCHEMA_VERSION = 3;
const KB_PACK_SCHEMA_VERSIONS: readonly unknown[] = [1, 2, 3];
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
  /** Schema 2: the card's "Symptom:" line, the problem in the user's words. */
  symptom: z.string().max(300).nullable().optional(),
  notVerifiedCount: z.number().int().nonnegative(),
  /** Schema 2: a stub ("not yet written") or routing ("start here") card has no chunks; schema 3 (K25, A4): an `absent` card says the feature has no equivalent in this version, and has none either. */
  status: z.enum(["full", "stub", "routing", "absent"]).optional(),
  /** Schema 3, an `absent` card: why there is no equivalent, at most 300 characters. */
  absentReason: z.string().max(300).optional(),
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
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  builtAt: z.string(),
  /** Schema 3 (K23, D-SEC11): when the pack stops being used. */
  expiresAt: z.string().optional(),
  /** Schema 3 (K23, D-SEC8): ES256 over the checksum; absent on an unsigned pack. */
  signature: z
    .object({
      alg: z.literal("ES256"),
      keyId: z.string().regex(/^[0-9a-f]{16}$/),
      value: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
    })
    .optional(),
  builder: z.string(),
  source: z.object({
    site: z.string(),
    space: z.string(),
    label: z.string(),
    cardCount: z.number().int().nonnegative(),
  }),
  /** Schema 1 packs are 5.x; schema 2 names the version its cards are for. */
  aptyVersion: z.enum(["4.x", "5.x", "common"]),
  retrieval: z.object({
    bm25: z.literal(true),
    /** The lowest top BM25 score that counts as covered, calibrated by `eval-kb.mjs`. */
    threshold: z.number().nonnegative().optional(),
    /** Schema 2: when the top card covers a question (`search.ts`), calibrated by `eval-kb.mjs`. */
    coverage: z
      .object({
        min: z.number().min(0).max(1),
        minIdf: z.number().nonnegative(),
        minTerms: z.number().int().nonnegative(),
      })
      .optional(),
    /** Schema 2: the KB owner's own synonym groups, added to the built-in ones (`synonyms.ts`). */
    synonyms: z
      .array(z.array(z.string().min(1).max(60)).min(2).max(30))
      .max(200)
      .optional(),
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
export type KbAptyVersion = KbPack["aptyVersion"];
export const KB_APTY_VERSIONS: readonly KbAptyVersion[] = [
  "4.x",
  "5.x",
  "common",
];
export type KbCard = z.infer<typeof cardSchema>;
export type KbChunk = z.infer<typeof chunkSchema>;

export type KbPackErrorCode =
  | "too_large"
  | "not_json"
  | "wrong_kind"
  | "wrong_schema_version"
  | "invalid"
  | "checksum_mismatch"
  /** K23: refused at import because of who signed it or its dates. */
  | "unsigned"
  | "untrusted_key"
  | "revoked_key"
  | "bad_signature"
  | "expired"
  | "not_yet_valid";

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
  if (pack.schemaVersion === 3 && pack.expiresAt === undefined) {
    return "a schema 3 pack has no expiresAt";
  }
  if (pack.schemaVersion !== 3 && pack.signature !== undefined) {
    return "only a schema 3 pack carries a signature";
  }
  const cardIds = new Set<string>();
  const chunkless = new Map<string, string>();
  for (const card of pack.cards) {
    if (cardIds.has(card.pageId)) return `card ${card.pageId} appears twice`;
    cardIds.add(card.pageId);
    if (
      card.status === "stub" ||
      card.status === "routing" ||
      card.status === "absent"
    ) {
      chunkless.set(card.pageId, card.status);
    }
    if (card.status === "absent" && pack.schemaVersion !== 3) {
      return `card ${card.pageId}: only a schema 3 pack has absent cards`;
    }
    if (card.absentReason !== undefined && card.status !== "absent") {
      return `card ${card.pageId} has an absentReason but is not absent`;
    }
  }
  if (pack.source.cardCount !== pack.cards.length) {
    return "source.cardCount does not match the cards";
  }
  for (const chunk of pack.chunks) {
    if (!cardIds.has(chunk.pageId)) {
      return `chunk ${chunk.id} names no card`;
    }
    const status = chunkless.get(chunk.pageId);
    if (status) {
      return `card ${chunk.pageId} is ${status === "stub" ? "a stub" : status === "absent" ? "an absent card" : "a routing card"} and has chunks`;
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

/** Every card with a status and a symptom: a schema 1 card is a full card with no symptom line. */
function normalized(pack: KbPack): KbPack {
  return {
    ...pack,
    cards: pack.cards.map((card) => ({
      ...card,
      symptom: card.symptom ?? null,
      status: card.status ?? "full",
    })),
  };
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
  if (!KB_PACK_SCHEMA_VERSIONS.includes(record.schemaVersion)) {
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
  const pack = normalized(parsed.data);
  if (pack.chunks.length > KB_PACK_LIMITS.maxChunks) {
    return { ok: false, code: "too_large" };
  }
  const problem = integrityProblem(pack);
  if (problem) return { ok: false, code: "invalid", detail: problem };
  // The checksum covers the pack without itself and without the signature,
  // which covers the checksum (K23 P1).
  const { sha256: expected, signature: _signature, ...rest } = record;
  if ((await sha256(canonicalJson(rest))) !== expected) {
    return { ok: false, code: "checksum_mismatch" };
  }
  return { ok: true, pack };
}

/** What the Options card and Preflight show about the loaded pack: no card text. */
export interface KbPackInfo {
  aptyVersion: KbAptyVersion;
  site: string;
  space: string;
  label: string;
  cardCount: number;
  /** Cards whose text for this version is not written yet. */
  stubCount: number;
  /** K25, A4: cards for features with no equivalent in this version. */
  absentCount?: number;
  chunkCount: number;
  builtAt: string;
  importedAt: string;
  mode: "bm25" | "hybrid";
  /** Whether the pack carries a calibrated "not covered" threshold (schema 1) or coverage settings (schema 2). */
  calibrated: boolean;
  sha256: string;
  /** K23: when it stops being used, null for a schema 1 or 2 pack. */
  expiresAt?: string | null;
  /** K23: its signature (the key id and value, no card text), null when unsigned. */
  signature?: KbPackSignature | null;
}

/** A loaded pack and whether it is used, judged when it was read (K23). */
export type KbPackState = KbPackInfo & { usability: KbPackUsability };

/**
 * Why a valid pack is not stored (KB-RAG K26): fetched, it names another
 * version than its source, it is the stored pack again, or it is not newer by
 * `builtAt` (D-DEL6); imported by hand, the policy delivers its version
 * (D-DEL5).
 */
export type KbReplaceStop =
  | "version_mismatch"
  | "unchanged"
  | "older"
  | "policy_managed";

export type KbImportResult =
  | { ok: true; info: KbPackInfo }
  | {
      ok: false;
      code: KbPackErrorCode | "read_failed" | KbReplaceStop;
      /** With `expired` or `not_yet_valid` (K23): the date that applies. */
      date?: string;
    };

export const KB_PACK_STALE_DAYS = 30;

export function describeKbPack(pack: KbPack, importedAt: string): KbPackInfo {
  return {
    aptyVersion: pack.aptyVersion,
    site: pack.source.site,
    space: pack.source.space,
    label: pack.source.label,
    cardCount: pack.cards.length,
    stubCount: pack.cards.filter((card) => card.status === "stub").length,
    absentCount: pack.cards.filter((card) => card.status === "absent").length,
    chunkCount: pack.chunks.length,
    builtAt: pack.builtAt,
    importedAt,
    mode:
      pack.retrieval.dense && pack.vectors !== undefined ? "hybrid" : "bm25",
    calibrated:
      pack.retrieval.threshold !== undefined ||
      pack.retrieval.coverage !== undefined,
    sha256: pack.sha256,
    expiresAt: pack.expiresAt ?? null,
    signature: pack.signature ?? null,
  };
}

/** Whole days since the pack was built, or undefined when its date does not parse. */
export function kbPackAgeDays(info: Pick<KbPackInfo, "builtAt">, now: Date) {
  const built = Date.parse(info.builtAt);
  if (Number.isNaN(built)) return undefined;
  return Math.max(0, Math.floor((now.getTime() - built) / 86_400_000));
}

/** Where a version's cards live when a link has no card to read its URL from. */
const KB_CARD_SPACE: Record<KbAptyVersion, string> = {
  "4.x": "https://apty.atlassian.net/wiki/spaces/A4PKH/pages/",
  "5.x": "https://apty.atlassian.net/wiki/spaces/JA/pages/",
  common: "https://apty.atlassian.net/wiki/spaces/JA/pages/",
};

/**
 * The Confluence page of a KB card: the card's own `url` when the pack
 * holds it (page ids are unique across spaces), else the space its
 * version's cards live in (JA for 5.x and a schema 1 pack).
 */
export function kbCardUrl(
  pageId: string,
  {
    url,
    site,
    space,
    aptyVersion = "5.x",
  }: {
    url?: string;
    site?: string;
    space?: string;
    aptyVersion?: KbAptyVersion;
  } = {},
): string {
  if (url) return url;
  if (site && space && SITE.test(site) && SPACE.test(space)) {
    return `https://${site}/wiki/spaces/${space}/pages/${pageId}`;
  }
  return `${KB_CARD_SPACE[aptyVersion]}${pageId}`;
}

const SITE = /^[a-z0-9.-]+$/i;
const SPACE = /^[A-Za-z0-9~_-]+$/;
const CARD_URL = /^https:\/\/([^/\s]+)\/wiki\/spaces\/([^/\s]+)\/pages\/\d+$/;

/**
 * Where a card lives, as a site and a space key rather than a URL: a tool
 * result passes them to the model and the side panel without being read as
 * a visited page by the URL policy, and `kbCardUrl` builds the link back.
 */
export function kbCardLocation(card: Pick<KbCard, "url">): {
  site: string;
  space: string;
} {
  const [, site = "", space = ""] = CARD_URL.exec(card.url) ?? [];
  return { site, space };
}
