#!/usr/bin/env node
/**
 * Builds a KB pack from the RAG Answer Cards in Confluence
 * (docs/tasks/kb-rag/MASTER.md, K1). Run by the KB owner on their own
 * machine; the pack holds internal card text, so it is written outside this
 * public repository and never printed: the summary names ids, titles and
 * counts only.
 *
 * Usage:
 *   CONFLUENCE_EMAIL=… CONFLUENCE_TOKEN=… pnpm kb:pack [--site apty.atlassian.net]
 *     [--space JA] [--root <pageId> | --label <label>] [--version 4.x|5.x|common]
 *     [--out <file>]
 *     [--coverage-min <0-1>] [--coverage-min-idf <idf>]
 *     [--synonyms <file>] [--customer-names <file>] [--diff <old pack>]
 *     [--timeout <seconds>] (each request, default 30) [--quiet] (no
 *     progress lines on stderr)
 *     --sign-key <PKCS#8 PEM file> (or KB_PACK_SIGNING_KEY) [--expires-days
 *     <1-180>, default 60] | --unsigned
 *
 * Writes schema 3 (K23): signed with the KB owner's key (pnpm kb:keygen),
 * with an expiresAt. The key is read from the file and never printed.
 *
 * The cards are the pages titled "RAG Card: …" under the RAG Answer Cards
 * page (`--root`, default 1496711169 in JA), each group page's title as
 * their group; `--label` selects labelled pages instead.
 *
 * The token is a read-only service account's classic API token, read from the
 * environment, never written or logged.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatSelfCheck, loadAgentCore, selfCheck } from "./eval-kb.mjs";

export const BUILDER = "build-kb-pack 1.0.0";
const PACK_KIND = "apty-kb-pack";
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MAX_CHUNK_CHARS = 1000;
const MAX_SYMPTOM_CHARS = 300;
const SYMPTOM_LINE = /^Symptom:\s*/i;
const NOT_YET_WRITTEN = [
  /\b(?:4|5)\.x version not yet written\b/i,
  /not yet written/i,
];
const ROUTING_TITLE = /^start here\b/i;
const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_SECONDS = 30;
const LAYER_HEADING = /^Layer\s+(\d+)\s*:/i;
const NOT_VERIFIED = /\bNOT VERIFIED\b/g;
const TITLE_PREFIX = /^RAG Card:\s*/i;
const GROUP_PREFIX = /^RAG Cards:\s*/i;
/** The RAG Answer Cards page in JA, whose descendants are the cards. */
export const RAG_ANSWER_CARDS_PAGE = "1496711169";
/**
 * The Apty version a space's cards are for, when the space holds one
 * version only (D-KB6); JA and any other space need `--version`.
 */
const SPACE_VERSIONS = { A4PKH: "4.x" };
const VERSIONS = ["4.x", "5.x", "common"];

/** The search's own defaults (agent-core `KB_COVERAGE_DEFAULTS`), for a flag given alone. */
const COVERAGE_DEFAULTS = { min: 0.5, minIdf: 1.5, minTerms: 1 };
const DEFAULTS = {
  site: "apty.atlassian.net",
  space: "JA",
  root: RAG_ANSWER_CARDS_PAGE,
};

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  rarr: "→",
};

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code =
        name[1].toLowerCase() === "x"
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "tr",
  "table",
  "tbody",
  "thead",
  "blockquote",
  "pre",
  "ac:task",
  "ac:layout-cell",
]);
/** Elements whose content is not text: skipped to their closing tag. */
const SKIPPED_TAGS = new Set(["script", "style", "ac:parameter"]);
const TAG_NAME = /^\/?([a-z][\w:.-]*)/i;

/**
 * Confluence storage XHTML to plain text: one line per block, list items as
 * "- ". A single pass over the markup, with no regular expression removing
 * tags, so nothing a crafted body nests can survive a partial removal.
 */
export function storageToText(html) {
  let out = "";
  let skipping = null;
  let afterListItem = false;
  let i = 0;
  while (i < html.length) {
    if (html.startsWith("<![CDATA[", i)) {
      const end = html.indexOf("]]>", i + 9);
      const stop = end === -1 ? html.length : end;
      if (!skipping) {
        out += html.slice(i + 9, stop);
        afterListItem = false;
      }
      i = stop + 3;
      continue;
    }
    if (html[i] === "<") {
      const close = html.indexOf(">", i + 1);
      if (close === -1) {
        if (!skipping) out += decodeEntities(html.slice(i));
        break;
      }
      const tag = html.slice(i + 1, close);
      i = close + 1;
      const name = TAG_NAME.exec(tag)?.[1]?.toLowerCase();
      if (!name) continue;
      const closing = tag.startsWith("/");
      if (skipping) {
        if (closing && name === skipping) skipping = null;
        continue;
      }
      if (!closing && SKIPPED_TAGS.has(name) && !tag.endsWith("/")) {
        skipping = name;
      } else if (name === "li" && !closing) {
        out += "\n- ";
        afterListItem = true;
        continue;
      } else if (name === "br") {
        out += "\n";
      } else if (BLOCK_TAGS.has(name)) {
        if (!(afterListItem && name === "p" && !closing)) out += "\n";
      } else if (name === "td" || name === "th") {
        out += " ";
      }
      afterListItem = false;
      continue;
    }
    const next = html.indexOf("<", i);
    const stop = next === -1 ? html.length : next;
    if (!skipping) {
      const text = decodeEntities(html.slice(i, stop));
      out += text;
      if (text.trim()) afterListItem = false;
    }
    i = stop;
  }
  return out
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter((line) => line && line !== "-")
    .join("\n");
}

/** Keys sorted at every level, no whitespace: the text the pack's sha256 covers. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The checksum: the canonical JSON of the pack without itself and without the signature (K23 P1). */
export function packSha256(pack) {
  const { sha256: _ignored, signature: _signature, ...rest } = pack;
  return createHash("sha256").update(canonicalJson(rest)).digest("hex");
}

function comparePageIds(a, b) {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * One Confluence page as a card and its four layer chunks, or the reason it
 * is skipped. A card with fewer or more than four layers, out of order, or
 * a layer over 1,000 characters is never guessed at.
 */
export function parseCard(page, { site, space, group = "" }) {
  const html = page.body ?? "";
  const headings = [...html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)];
  const layers = headings
    .map((match) => ({
      match,
      heading: storageToText(match[1]).replace(/\n/g, " "),
    }))
    .filter(({ heading }) => LAYER_HEADING.test(heading));
  const numbers = layers.map(
    ({ heading }) => Number(LAYER_HEADING.exec(heading)[1]) || 0,
  );
  const title = page.title.replace(TITLE_PREFIX, "").trim();
  const card = (intro, status) => {
    const lines = intro.split("\n");
    const symptomLine = lines.find((line) => SYMPTOM_LINE.test(line));
    return {
      pageId: page.id,
      title,
      group,
      verifiedOn: lines.find((line) => /^Verified on:/i.test(line)) ?? null,
      symptom: symptomLine
        ? symptomLine
            .replace(SYMPTOM_LINE, "")
            .trim()
            .slice(0, MAX_SYMPTOM_CHARS) || null
        : null,
      notVerifiedCount: 0,
      status,
      url: `https://${site}/wiki/spaces/${space}/pages/${page.id}`,
      updatedAt: page.updatedAt ?? "",
    };
  };
  if (layers.length === 0) {
    const text = storageToText(html);
    if (ROUTING_TITLE.test(title)) {
      return { card: card(text, "routing"), chunks: [] };
    }
    if (NOT_YET_WRITTEN.some((pattern) => pattern.test(text))) {
      return { card: card(text, "stub"), chunks: [] };
    }
  }
  if (layers.length === 0 && headings.length > 0) {
    return {
      skipped: "has headings but no Layer N: headings",
      kind: "other_format",
      headings: headings
        .slice(0, 5)
        .map((match) => storageToText(match[1]).replace(/\n/g, " ")),
    };
  }
  if (layers.length !== 4) {
    return { skipped: `has ${layers.length} layers, not 4` };
  }
  if (numbers.join() !== "1,2,3,4") {
    return { skipped: `layers are numbered ${numbers.join(", ")}, not 1-4` };
  }
  const intro = storageToText(html.slice(0, layers[0].match.index));

  const chunks = [];
  for (const [i, { match, heading }] of layers.entries()) {
    const start = match.index + match[0].length;
    const end = layers[i + 1]?.match.index ?? html.length;
    const text = storageToText(html.slice(start, end));
    const layer = i + 1;
    if (text.length > MAX_CHUNK_CHARS) {
      return {
        skipped: `layer ${layer} has ${text.length} characters, over ${MAX_CHUNK_CHARS}`,
      };
    }
    chunks.push({
      id: `${page.id}#L${layer}`,
      pageId: page.id,
      layer,
      heading,
      text,
      notVerified: (text.match(NOT_VERIFIED) ?? []).length > 0,
    });
  }
  const notVerifiedCount = chunks.reduce(
    (sum, chunk) => sum + (chunk.text.match(NOT_VERIFIED) ?? []).length,
    0,
  );
  return {
    card: { ...card(intro, "full"), notVerifiedCount },
    chunks,
  };
}

/** How long a pack is used by default, and at most (D-SEC11). */
export const EXPIRES_DAYS = { default: 60, max: 180 };
const DAY_MS = 86_400_000;
const SIGNATURE_CONTEXT = "apty-kb-pack-signature/1";

function defaultExpiry(builtAt) {
  const built = Date.parse(builtAt);
  return new Date(
    (Number.isNaN(built) ? 0 : built) + EXPIRES_DAYS.default * DAY_MS,
  ).toISOString();
}

/** A public key's id: the first 16 hex characters of the SHA-256 of its SPKI DER. */
export function keyIdOf(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}

/**
 * The pack signed with an ECDSA P-256 private key (PKCS#8 PEM text): ES256
 * over "apty-kb-pack-signature/1\n<sha256>\n<keyId>", the raw 64-byte
 * signature in base64, the form WebCrypto checks (K23 P1).
 */
export function signPack(pack, privateKeyPem) {
  const privateKey = createPrivateKey(privateKeyPem);
  if (
    privateKey.asymmetricKeyType !== "ec" ||
    privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  ) {
    throw new BuildError("The signing key is not an ECDSA P-256 key.");
  }
  const keyId = keyIdOf(createPublicKey(privateKey));
  const value = sign(
    "sha256",
    Buffer.from(`${SIGNATURE_CONTEXT}\n${pack.sha256}\n${keyId}`, "utf8"),
    { key: privateKey, dsaEncoding: "ieee-p1363" },
  ).toString("base64");
  return { ...pack, signature: { alg: "ES256", keyId, value } };
}

/** Thrown for a failure the KB owner has to act on; the message holds no card text. */
export class BuildError extends Error {}

/** A request that timed out or could not be sent; retried, then a BuildError. */
class RequestFailed extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
}

/** How the KB owner checks the credentials; in docs/development/kb-rag.md too. */
const ACCESS_CHECK =
  'Check access with: curl -s -o /dev/null -w "%{http_code}\\n" -u "$CONFLUENCE_EMAIL:$CONFLUENCE_TOKEN" "https://<site>/wiki/rest/api/search?cql=type=page&limit=1" (200: access works; 401: wrong email or token; 403: a scoped token, use a classic one).';

/**
 * Fetches the cards: by default every "RAG Card: …" page under `root` in
 * the space, or with `label` every page carrying it; CQL search for ids,
 * then each body in storage format, and each parent's title, without its
 * "RAG Cards:" prefix, as the card's group.
 */
export async function fetchCardPages({
  site,
  space,
  root,
  label,
  email,
  token,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  timeoutMs = DEFAULT_TIMEOUT_SECONDS * 1000,
  progress = () => {},
}) {
  const origin = `https://${site}`;
  const headers = {
    Accept: "application/json",
    Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
  };

  /** One request, cut off after `timeoutMs`; a timeout or network error is retried like a 429. */
  async function fetchOnce(url) {
    const controller = new AbortController();
    let timer;
    const timedOut = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new RequestFailed("timeout"));
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        fetchImpl(url, { headers, signal: controller.signal }).catch(
          (error) => {
            throw error instanceof RequestFailed
              ? error
              : new RequestFailed("network");
          },
        ),
        timedOut,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function getJson(url, { search = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await fetchOnce(url);
      } catch (error) {
        if (!(error instanceof RequestFailed)) throw error;
        if (attempt < MAX_RETRIES) {
          await sleep(2 ** attempt * 1000);
          continue;
        }
        const path = new URL(url).pathname;
        throw new BuildError(
          `${path} ${
            error.kind === "timeout"
              ? `did not answer within ${timeoutMs / 1000} seconds`
              : "could not be reached"
          } after ${MAX_RETRIES} retries. ${ACCESS_CHECK.replace("<site>", site)}`,
        );
      }
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const header = response.headers?.get?.("Retry-After");
        const seconds = header ? Number(header) : Number.NaN;
        await sleep(
          Number.isFinite(seconds) && seconds >= 0
            ? seconds * 1000
            : 2 ** attempt * 1000,
        );
        continue;
      }
      const path = new URL(url).pathname;
      if (search && (response.status === 401 || response.status === 403)) {
        throw new BuildError(
          `CQL search returned ${response.status}. A scoped API token routes to the v2 API, which has no CQL search: use a classic API token of a read-only service account.`,
        );
      }
      if (response.status === 429) {
        throw new BuildError(
          `${path} is still rate limited after ${MAX_RETRIES} retries; try again later.`,
        );
      }
      if (!response.ok) {
        throw new BuildError(`${path} returned ${response.status}.`);
      }
      return response.json();
    }
  }

  const cql = label
    ? `space="${space}" AND label="${label}" AND type=page`
    : `space="${space}" AND ancestor=${root} AND type=page`;
  let next = `${origin}/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=50`;
  const ids = [];
  progress("Listing pages…");
  while (next) {
    const page = await getJson(next, { search: true });
    for (const result of page.results ?? []) {
      const id = result.content?.id ?? result.id;
      const title = result.content?.title ?? result.title ?? "";
      if (!label && !TITLE_PREFIX.test(title)) continue;
      if (id && !ids.includes(String(id))) ids.push(String(id));
    }
    const link = page._links?.next;
    if (!link) break;
    next = link.startsWith("http")
      ? link
      : link.startsWith("/wiki/")
        ? `${origin}${link}`
        : `${page._links?.base ?? `${origin}/wiki`}${link}`;
  }

  const parents = new Map();
  const pages = [];
  const sorted = ids.sort(comparePageIds);
  for (const id of sorted) {
    const page = await getJson(
      `${origin}/wiki/api/v2/pages/${id}?body-format=storage`,
    );
    let group = "";
    if (page.parentId) {
      if (!parents.has(page.parentId)) {
        const parent = await getJson(
          `${origin}/wiki/api/v2/pages/${page.parentId}`,
        );
        parents.set(
          page.parentId,
          (parent.title ?? "").replace(GROUP_PREFIX, "").trim(),
        );
      }
      group = parents.get(page.parentId);
    }
    pages.push({
      id: String(page.id),
      title: page.title ?? "",
      body: page.body?.storage?.value ?? "",
      updatedAt: page.version?.createdAt ?? "",
      group,
    });
    if (pages.length % 10 === 0 || pages.length === sorted.length) {
      progress(`Fetched ${pages.length} of ${sorted.length} pages`);
    }
  }
  return pages;
}

/** The pack for these pages, sorted by page id, with its checksum; and the pages skipped (malformed, or in another format). */
export function buildPack({
  pages,
  site,
  space,
  label,
  builtAt,
  coverage,
  synonyms,
  aptyVersion = "5.x",
  expiresAt = defaultExpiry(builtAt),
}) {
  const cards = [];
  const chunks = [];
  const skipped = [];
  for (const page of [...pages].sort((a, b) => comparePageIds(a.id, b.id))) {
    const parsed = parseCard(page, { site, space, group: page.group });
    if (parsed.skipped) {
      skipped.push({
        pageId: page.id,
        title: page.title,
        reason: parsed.skipped,
        kind: parsed.kind ?? "malformed",
        ...(parsed.headings ? { headings: parsed.headings } : {}),
      });
      continue;
    }
    cards.push(parsed.card);
    chunks.push(...parsed.chunks);
  }
  const retrieval = { bm25: true };
  if (coverage !== undefined) retrieval.coverage = coverage;
  if (synonyms?.length) retrieval.synonyms = synonyms;
  const pack = {
    kind: PACK_KIND,
    schemaVersion: 3,
    builtAt,
    expiresAt,
    builder: BUILDER,
    source: { site, space, label, cardCount: cards.length },
    aptyVersion,
    retrieval,
    cards,
    chunks,
  };
  return { pack: { ...pack, sha256: packSha256(pack) }, skipped };
}

/**
 * The KB owner's synonym groups from a local file: one group per line,
 * members separated by commas, `#` starts a comment; a line with fewer
 * than two members is not a group.
 */
export function readSynonymGroups(text) {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/#.*/, "")
        .split(",")
        .map((member) => member.trim())
        .filter(Boolean),
    )
    .filter((group) => group.length >= 2);
}

/** Customer names from a local file: one per line, `#` starts a comment. */
export function readNameList(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Page ids of cards that name any of `names`, as a whole word, in any case. */
export function customerNameHits(pack, names) {
  if (names.length === 0) return [];
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${names.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`,
    "iu",
  );
  const hits = new Set();
  for (const card of pack.cards) {
    if (
      pattern.test(`${card.title}\n${card.group}\n${card.verifiedOn ?? ""}`)
    ) {
      hits.add(card.pageId);
    }
  }
  for (const chunk of pack.chunks) {
    if (pattern.test(`${chunk.heading}\n${chunk.text}`)) hits.add(chunk.pageId);
  }
  return [...hits].sort(comparePageIds);
}

function cardFingerprint(pack, card) {
  const chunks = pack.chunks.filter((chunk) => chunk.pageId === card.pageId);
  return canonicalJson({
    title: card.title,
    group: card.group,
    verifiedOn: card.verifiedOn,
    chunks: chunks.map(({ layer, heading, text }) => ({
      layer,
      heading,
      text,
    })),
  });
}

/** Cards added, changed and removed between two packs, as `{ pageId, title }`. */
export function diffPacks(previous, current) {
  const before = new Map(previous.cards.map((card) => [card.pageId, card]));
  const after = new Map(current.cards.map((card) => [card.pageId, card]));
  const pick = ({ pageId, title }) => ({ pageId, title });
  const byId = (a, b) => comparePageIds(a.pageId, b.pageId);
  return {
    added: current.cards
      .filter((card) => !before.has(card.pageId))
      .map(pick)
      .sort(byId),
    removed: previous.cards
      .filter((card) => !after.has(card.pageId))
      .map(pick)
      .sort(byId),
    changed: current.cards
      .filter(
        (card) =>
          before.has(card.pageId) &&
          cardFingerprint(previous, before.get(card.pageId)) !==
            cardFingerprint(current, card),
      )
      .map(pick)
      .sort(byId),
  };
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  const flags = {
    "--site": "site",
    "--space": "space",
    "--root": "root",
    "--label": "label",
    "--out": "out",
    "--coverage-min": "coverageMin",
    "--coverage-min-idf": "coverageMinIdf",
    "--customer-names": "customerNames",
    "--synonyms": "synonyms",
    "--version": "version",
    "--diff": "diff",
    "--timeout": "timeout",
    "--sign-key": "signKey",
    "--expires-days": "expiresDays",
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--quiet" || argv[i] === "--unsigned") {
      options[argv[i].slice(2)] = true;
      continue;
    }
    const key = flags[argv[i]];
    if (!key || argv[i + 1] === undefined) {
      throw new BuildError(`Unknown or incomplete option: ${argv[i]}`);
    }
    options[key] = argv[++i];
  }
  if (!/^[A-Za-z0-9~_-]+$/.test(options.space)) {
    throw new BuildError("--space takes a space key.");
  }
  if (!/^\d+$/.test(options.root)) {
    throw new BuildError("--root takes a page id.");
  }
  if (options.label !== undefined && !/^[\w.-]+$/.test(options.label)) {
    throw new BuildError("--label takes one label.");
  }
  if (options.version !== undefined && !VERSIONS.includes(options.version)) {
    throw new BuildError("--version takes 4.x, 5.x or common.");
  }
  options.version ??= SPACE_VERSIONS[options.space];
  if (options.version === undefined) {
    throw new BuildError(
      `Pass --version 4.x, 5.x or common: space ${options.space} holds cards of more than one version, or of an unknown one.`,
    );
  }
  if (options.expiresDays !== undefined) {
    const days = Number(options.expiresDays);
    if (!Number.isInteger(days) || days < 1 || days > EXPIRES_DAYS.max) {
      throw new BuildError(
        `--expires-days takes a whole number of days, 1 to ${EXPIRES_DAYS.max}.`,
      );
    }
    options.expiresDays = days;
  }
  if (options.timeout !== undefined) {
    const seconds = Number(options.timeout);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600) {
      throw new BuildError("--timeout takes a number of seconds, 1 to 600.");
    }
    options.timeout = seconds;
  }
  if (options.coverageMin !== undefined) {
    const min = Number(options.coverageMin);
    if (!Number.isFinite(min) || min < 0 || min > 1) {
      throw new BuildError("--coverage-min takes a number from 0 to 1.");
    }
    options.coverageMin = min;
  }
  if (options.coverageMinIdf !== undefined) {
    const minIdf = Number(options.coverageMinIdf);
    if (!Number.isFinite(minIdf) || minIdf < 0) {
      throw new BuildError("--coverage-min-idf takes a number of 0 or more.");
    }
    options.coverageMinIdf = minIdf;
  }
  return options;
}

/**
 * The self-check (KB-RAG K25, A3) on the pack just written: its two totals
 * and the titles that do not find their own card. Never stops the build.
 */
async function selfCheckLines(pack) {
  let core;
  try {
    core = await loadAgentCore();
  } catch {
    return [
      "  self-check skipped: build @apty/agent-core first (npm run build), then run pnpm kb:eval --self-check --pack <file>.",
    ];
  }
  const lines = formatSelfCheck(selfCheck(core, pack)).split("\n");
  return lines.slice(1, 4).map((line) => `  ${line}`);
}

function insideRepository(path) {
  const rel = relative(REPO_ROOT, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** The CLI, with its inputs injected for tests. Returns the exit code. */
export async function run({
  argv,
  env,
  fetchImpl = fetch,
  sleep,
  now = () => new Date(),
  clock = () => Date.now(),
  home = homedir(),
  cwd = process.cwd(),
  out: print = (line) => console.log(line),
  err: printError = (line) => console.error(line),
}) {
  try {
    const options = parseArgs(argv);
    const email = env.CONFLUENCE_EMAIL;
    const token = env.CONFLUENCE_TOKEN;
    if (!email || !token) {
      throw new BuildError(
        "Set CONFLUENCE_EMAIL and CONFLUENCE_TOKEN (a read-only service account's classic API token) in the environment.",
      );
    }
    const builtAt = now().toISOString();
    const signKeyPath = options.signKey ?? env.KB_PACK_SIGNING_KEY;
    if (!signKeyPath && !options.unsigned) {
      throw new BuildError(
        "Pass --sign-key <private key file> (or set KB_PACK_SIGNING_KEY): an unsigned pack is used by no SE's extension. --unsigned builds one anyway, for a policy with allowUnsignedPacks.",
      );
    }
    const signingKey = signKeyPath
      ? readFileSync(resolve(cwd, signKeyPath), "utf8")
      : undefined;
    const expiresAt = new Date(
      Date.parse(builtAt) +
        (options.expiresDays ?? EXPIRES_DAYS.default) * DAY_MS,
    ).toISOString();
    const outPath = resolve(
      cwd,
      options.out ??
        join(
          home,
          "apty-kb",
          `apty-kb-${options.space}-${options.version}-${builtAt.slice(0, 10).replace(/-/g, "")}.kbpack.json`,
        ),
    );
    if (insideRepository(outPath)) {
      throw new BuildError(
        "The pack holds internal card text: write it outside this repository (the default is ~/apty-kb/).",
      );
    }
    const names = options.customerNames
      ? readNameList(readFileSync(resolve(cwd, options.customerNames), "utf8"))
      : [];
    const synonyms = options.synonyms
      ? readSynonymGroups(readFileSync(resolve(cwd, options.synonyms), "utf8"))
      : undefined;
    const previous = options.diff
      ? JSON.parse(readFileSync(resolve(cwd, options.diff), "utf8"))
      : undefined;

    const selection = options.label
      ? `label "${options.label}"`
      : `"RAG Card:" pages under page ${options.root}`;
    const started = clock();
    const progress = options.quiet ? () => {} : printError;
    const pages = await fetchCardPages({
      site: options.site,
      space: options.space,
      root: options.root,
      label: options.label,
      email,
      token,
      fetchImpl,
      sleep,
      timeoutMs: (options.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
      progress,
    });
    progress(`Fetched in ${((clock() - started) / 1000).toFixed(1)} s`);
    if (pages.length === 0) {
      throw new BuildError(
        `No page in space ${options.space} matches: ${selection}.`,
      );
    }
    const built = buildPack({
      pages,
      expiresAt,
      site: options.site,
      space: options.space,
      label: options.label ?? `ancestor:${options.root}`,
      builtAt,
      synonyms,
      aptyVersion: options.version,
      coverage:
        options.coverageMin === undefined &&
        options.coverageMinIdf === undefined
          ? undefined
          : {
              ...COVERAGE_DEFAULTS,
              ...(options.coverageMin !== undefined
                ? { min: options.coverageMin }
                : {}),
              ...(options.coverageMinIdf !== undefined
                ? { minIdf: options.coverageMinIdf }
                : {}),
            },
    });

    const { skipped } = built;
    const selfChecked = await selfCheckLines(built.pack);
    const pack = signingKey ? signPack(built.pack, signingKey) : built.pack;
    const hits = customerNameHits(pack, names);
    if (hits.length > 0) {
      throw new BuildError(
        `Customer names found in pages ${hits.join(", ")}; hide them in the cards and build again.`,
      );
    }

    const count = (status) =>
      pack.cards.filter((card) => card.status === status).length;
    const skippedAs = (kind) => skipped.filter((s) => s.kind === kind);
    print(
      `Built ${pack.cards.length} cards (${pack.chunks.length} chunks): ${count("full")} full, ${count("stub")} stubs (not yet written), ${count("routing")} routing; skipped ${skippedAs("malformed").length} malformed, ${skippedAs("other_format").length} other_format. Apty ${options.version}, from ${options.site}, space ${options.space}, ${selection}.`,
    );
    for (const card of pack.cards.filter((c) => c.status === "stub")) {
      print(`  stub ${card.pageId} "${card.title}": not yet written`);
    }
    for (const { pageId, title, reason } of skippedAs("malformed")) {
      print(`  malformed, skipped ${pageId} "${title}": ${reason}`);
    }
    for (const { pageId, title, headings } of skippedAs("other_format")) {
      print(
        `  other_format, skipped ${pageId} "${title}": no Layer N: headings; its headings: ${headings.join(" | ")}`,
      );
    }
    const flagged = pack.cards.filter((card) => card.notVerifiedCount > 0);
    if (flagged.length > 0) {
      print(
        `  ${flagged.length} cards carry NOT VERIFIED statements: ${flagged.map((card) => card.pageId).join(", ")}`,
      );
    }
    for (const card of pack.cards.filter(
      (c) => c.symptom === null && c.status !== "routing",
    )) {
      print(`  no Symptom line in ${card.pageId} "${card.title}"`);
    }
    const unverified = pack.cards.filter((card) => card.verifiedOn === null);
    if (unverified.length > 0) {
      print(
        `  warning: no "Verified on" line in ${unverified.map((card) => card.pageId).join(", ")}`,
      );
    }
    if (pack.retrieval.coverage === undefined) {
      print(
        "  warning: no --coverage-min or --coverage-min-idf; the default coverage settings apply until kb:eval --calibrate suggests values.",
      );
    }
    if (previous) {
      const diff = diffPacks(previous, pack);
      for (const kind of ["added", "changed", "removed"]) {
        for (const { pageId, title } of diff[kind]) {
          print(`  ${kind} ${pageId} "${title}"`);
        }
      }
      if (Object.values(diff).every((list) => list.length === 0)) {
        print("  no card changed since the previous pack");
      }
    }

    mkdirSync(dirname(outPath), { recursive: true });
    const body = `${JSON.stringify(pack)}\n`;
    writeFileSync(outPath, body, { mode: 0o600 });
    print(
      `Wrote ${outPath} (${Buffer.byteLength(body)} bytes, sha256 ${pack.sha256.slice(0, 12)}…). Share it on the restricted internal page only.`,
    );
    print(
      pack.signature
        ? `  signed with key ${pack.signature.keyId}; expires ${pack.expiresAt.slice(0, 10)}.`
        : "  warning: unsigned (--unsigned): no SE's extension uses it unless the policy sets allowUnsignedPacks.",
    );
    for (const line of selfChecked) print(line);
    return 0;
  } catch (error) {
    if (error instanceof BuildError) {
      printError(error.message);
      return 1;
    }
    const code = error?.cause?.code ? `: ${error.cause.code}` : "";
    printError(`Build failed (${error?.name ?? "Error"}${code}).`);
    return 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await run({
    argv: process.argv.slice(2),
    env: process.env,
  });
}
