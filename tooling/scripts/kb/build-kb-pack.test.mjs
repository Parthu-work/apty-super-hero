import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildPack,
  canonicalJson,
  customerNameHits,
  diffPacks,
  fetchCardPages,
  packSha256,
  parseCard,
  readNameList,
  run,
  storageToText,
} from "./build-kb-pack.mjs";

const SITE = "fixture.atlassian.net";
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "kb-pack-"));
  dirs.push(dir);
  return dir;
}

function layer(n, heading, items) {
  return `<h2>Layer ${n}: ${heading}</h2><ol>${items.map((item) => `<li><p>${item}</p></li>`).join("")}</ol>`;
}

function cardBody({
  layers = 4,
  verified = true,
  layer2 = "FIXTURE: open the invented Glow panel.",
  symptom = "the FIXTURE banner never glows.",
} = {}) {
  const intro = `<h1>KB card: FIXTURE banner never glows</h1><p>${symptom === null ? "" : `Symptom: ${symptom}<br/>`}${
    verified ? "Verified on: FIXTURE code, commit 0000000, 2026-01-01." : ""
  }</p>`;
  const all = [
    layer(1, "FIXTURE banner, settings", [
      "In Studio, turn on &quot;Glowing Banner&quot; (FIXTURE setting).",
    ]),
    layer(2, "FIXTURE banner, page checks", [layer2]),
    layer(3, "FIXTURE banner, data", [
      "NOT VERIFIED: glow.json lists glowIds (FIXTURE).",
    ]),
    layer(4, "FIXTURE banner, contact support", [
      "Send support: the FIXTURE version.",
    ]),
  ];
  return intro + all.slice(0, layers).join("");
}

function page(id, overrides = {}) {
  return {
    id,
    title: `RAG Card: FIXTURE card ${id}`,
    body: cardBody(),
    updatedAt: "2026-02-01T00:00:00.000Z",
    group: "FIXTURE group",
    ...overrides,
  };
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: async () => body,
  };
}

/**
 * A fake Confluence: CQL search in pages of `perPage`, v2 bodies and parents.
 * Search results carry titles as Confluence's do: `titles` overrides one.
 */
function fakeConfluence({
  ids,
  perPage = 2,
  bodies = {},
  titles = {},
  before,
} = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    const early = before?.(url, calls.length);
    if (early) return early;
    const { pathname, searchParams } = new URL(url);
    if (pathname === "/wiki/rest/api/search") {
      const start = Number(searchParams.get("cursor") ?? 0);
      const slice = ids.slice(start, start + perPage);
      const more = start + perPage < ids.length;
      return jsonResponse({
        results: slice.map((id) => ({
          content: {
            id,
            type: "page",
            title: titles[id] ?? `RAG Card: FIXTURE card ${id}`,
          },
        })),
        _links: {
          base: `https://${SITE}/wiki`,
          ...(more
            ? {
                next: `/rest/api/search?cql=x&limit=${perPage}&cursor=${start + perPage}`,
              }
            : {}),
        },
      });
    }
    const pageMatch = /^\/wiki\/api\/v2\/pages\/(\d+)$/.exec(pathname);
    if (pageMatch) {
      const id = pageMatch[1];
      if (id === "900") {
        return jsonResponse({ id, title: "RAG Cards: FIXTURE parent" });
      }
      return jsonResponse({
        id,
        title: `RAG Card: FIXTURE card ${id}`,
        parentId: "900",
        version: { createdAt: "2026-02-01T00:00:00.000Z" },
        body: { storage: { value: bodies[id] ?? cardBody() } },
      });
    }
    return jsonResponse({}, { status: 404 });
  };
  return { fetchImpl, calls };
}

describe("storageToText", () => {
  it("keeps one line per block, list items, entities and CDATA, and drops macro parameters", () => {
    const html =
      "<p>A&nbsp;&quot;b&quot; &amp; c&#039;s &#x2192; d</p><ul><li><p>one</p></li><li>two</li></ul>" +
      '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">js</ac:parameter>' +
      "<ac:plain-text-body><![CDATA[if (a < b) go();]]></ac:plain-text-body></ac:structured-macro>" +
      "<p>x<br/>y</p><table><tr><td>k</td><td>v</td></tr></table>";
    assert.equal(
      storageToText(html),
      [
        'A "b" & c\'s → d',
        "- one",
        "- two",
        "if (a < b) go();",
        "x",
        "y",
        "k v",
      ].join("\n"),
    );
  });
});

describe("storageToText against crafted markup", () => {
  it("drops script, style and macro parameters whole, and leaves no tag fragment when tags are nested", () => {
    const text = storageToText(
      '<p>x <scr<script>alert(1)</script>ipt y</p><script>var a = "<b>";</script><style>p{}</style><p>z</p>',
    );
    assert.ok(!text.includes("<"), text);
    assert.ok(!text.includes("var a"), text);
    assert.ok(!text.includes("p{}"), text);
    assert.match(text, /z$/);
  });
});

describe("parseCard", () => {
  it("splits a card into its four layers, with the Verified on line and NOT VERIFIED marks", () => {
    const { card, chunks } = parseCard(page("101"), {
      site: SITE,
      space: "FX",
      group: "FIXTURE group",
    });
    assert.deepEqual(card, {
      pageId: "101",
      title: "FIXTURE card 101",
      group: "FIXTURE group",
      verifiedOn: "Verified on: FIXTURE code, commit 0000000, 2026-01-01.",
      symptom: "the FIXTURE banner never glows.",
      notVerifiedCount: 1,
      status: "full",
      url: `https://${SITE}/wiki/spaces/FX/pages/101`,
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    assert.deepEqual(
      chunks.map(({ id, layer, notVerified }) => [id, layer, notVerified]),
      [
        ["101#L1", 1, false],
        ["101#L2", 2, false],
        ["101#L3", 3, true],
        ["101#L4", 4, false],
      ],
    );
    assert.equal(chunks[0].heading, "Layer 1: FIXTURE banner, settings");
    assert.equal(
      chunks[0].text,
      '- In Studio, turn on "Glowing Banner" (FIXTURE setting).',
    );
  });

  it("skips a card with a missing layer, layers out of order or a layer over 1,000 characters", () => {
    const options = { site: SITE, space: "FX" };
    assert.deepEqual(
      parseCard(page("1", { body: cardBody({ layers: 3 }) }), options),
      {
        skipped: "has 3 layers, not 4",
      },
    );
    const swapped = cardBody().replace("Layer 2:", "Layer 9:");
    assert.deepEqual(parseCard(page("2", { body: swapped }), options), {
      skipped: "layers are numbered 1, 9, 3, 4, not 1-4",
    });
    const long = cardBody({ layer2: "x".repeat(1001) });
    assert.match(
      parseCard(page("3", { body: long }), options).skipped,
      /layer 2 has 1003 characters, over 1000/,
    );
  });

  it("reads the Symptom line, at most 300 characters, or null without one", () => {
    const options = { site: SITE, space: "FX" };
    const none = parseCard(
      page("5", { body: cardBody({ symptom: null }) }),
      options,
    );
    assert.equal(none.card.symptom, null);
    const long = parseCard(
      page("6", {
        body: cardBody({ symptom: `  FIXTURE ${"y".repeat(400)}` }),
      }),
      options,
    );
    assert.equal(long.card.symptom.length, 300);
    assert.ok(long.card.symptom.startsWith("FIXTURE y"));
  });

  it("keeps a stub and a routing card with no chunks, and skips a malformed one with its reason", () => {
    const options = { site: SITE, space: "FX" };
    const intro = (text) =>
      `<p>Symptom: FIXTURE gadgets cannot be exported.</p><p>${text}</p>`;
    const stub = parseCard(
      page("31", { body: intro("The 4.x version not yet written (FIXTURE).") }),
      options,
    );
    assert.equal(stub.card.status, "stub");
    assert.equal(stub.card.symptom, "FIXTURE gadgets cannot be exported.");
    assert.deepEqual(stub.chunks, []);
    const generic = parseCard(
      page("32", { body: intro("FIXTURE: this card is not yet written.") }),
      options,
    );
    assert.equal(generic.card.status, "stub");
    const routing = parseCard(
      page("33", {
        title: "RAG Card: Start here: FIXTURE gadget questions",
        body: "<p>FIXTURE: read the gadget cards below.</p>",
      }),
      options,
    );
    assert.equal(routing.card.status, "routing");
    assert.equal(routing.card.title, "Start here: FIXTURE gadget questions");
    assert.deepEqual(routing.chunks, []);
    assert.deepEqual(
      parseCard(page("34", { body: "<p>FIXTURE: nothing here.</p>" }), options),
      { skipped: "has 0 layers, not 4" },
    );
  });

  it("gives null for a card with no Verified on line", () => {
    const parsed = parseCard(
      page("4", { body: cardBody({ verified: false }) }),
      {
        site: SITE,
        space: "FX",
      },
    );
    assert.equal(parsed.card.verifiedOn, null);
  });
});

describe("fetchCardPages", () => {
  const base = {
    site: SITE,
    space: "FX",
    label: "rag-card",
    email: "svc@example.com",
    token: "FIXTURE-TOKEN",
  };

  it("follows the search's next links, reads each body and parent once, with Basic auth", async () => {
    const { fetchImpl, calls } = fakeConfluence({ ids: ["30", "4", "200"] });
    const pages = await fetchCardPages({ ...base, fetchImpl });
    assert.deepEqual(
      pages.map(({ id, group }) => [id, group]),
      [
        ["4", "FIXTURE parent"],
        ["30", "FIXTURE parent"],
        ["200", "FIXTURE parent"],
      ],
    );
    const searches = calls.filter(({ url }) =>
      url.includes("/rest/api/search"),
    );
    assert.equal(searches.length, 2);
    assert.match(
      decodeURIComponent(searches[0].url),
      /cql=space="FX" AND label="rag-card" AND type=page&limit=50/,
    );
    assert.equal(
      calls.filter(({ url }) => url.endsWith("/pages/900")).length,
      1,
    );
    const expected = `Basic ${Buffer.from("svc@example.com:FIXTURE-TOKEN").toString("base64")}`;
    assert.ok(calls.every(({ auth }) => auth === expected));
  });

  it('by default reads the "RAG Card:" pages under RAG Answer Cards, not their group pages', async () => {
    const { fetchImpl, calls } = fakeConfluence({
      ids: ["5", "900", "6"],
      titles: { 900: "RAG Cards: FIXTURE parent" },
    });
    const { label: _label, ...noLabel } = base;
    const pages = await fetchCardPages({
      ...noLabel,
      root: "1496711169",
      fetchImpl,
    });
    assert.deepEqual(
      pages.map(({ id, group }) => [id, group]),
      [
        ["5", "FIXTURE parent"],
        ["6", "FIXTURE parent"],
      ],
    );
    assert.match(
      decodeURIComponent(calls[0].url),
      /cql=space="FX" AND ancestor=1496711169 AND type=page&limit=50/,
    );
  });

  it("waits for Retry-After on 429 and retries up to 3 times", async () => {
    const waits = [];
    const { fetchImpl } = fakeConfluence({
      ids: ["1"],
      before: (_url, n) =>
        n <= 2
          ? jsonResponse({}, { status: 429, headers: { "Retry-After": "2" } })
          : undefined,
    });
    const pages = await fetchCardPages({
      ...base,
      fetchImpl,
      sleep: async (ms) => waits.push(ms),
    });
    assert.equal(pages.length, 1);
    assert.deepEqual(waits, [2000, 2000]);

    const always = fakeConfluence({
      ids: ["1"],
      before: () => jsonResponse({}, { status: 429 }),
    });
    const backoff = [];
    await assert.rejects(
      fetchCardPages({
        ...base,
        fetchImpl: always.fetchImpl,
        sleep: async (ms) => backoff.push(ms),
      }),
      /still rate limited after 3 retries/,
    );
    assert.deepEqual(backoff, [1000, 2000, 4000]);
  });

  it("names a scoped token when CQL search is refused, without echoing the token", async () => {
    const { fetchImpl } = fakeConfluence({
      ids: [],
      before: () => jsonResponse({}, { status: 401 }),
    });
    await assert.rejects(fetchCardPages({ ...base, fetchImpl }), (error) => {
      assert.match(error.message, /CQL search returned 401.*classic API token/);
      assert.ok(!error.message.includes("FIXTURE-TOKEN"));
      return true;
    });
  });
});

describe("buildPack", () => {
  const args = {
    site: SITE,
    space: "FX",
    label: "rag-card",
    builtAt: "2026-03-01T00:00:00.000Z",
  };

  it("sorts cards by page id, skips malformed ones and checksums the canonical JSON", () => {
    const pages = [
      page("20"),
      page("3", { body: cardBody({ layers: 2 }) }),
      page("100"),
    ];
    const coverage = { min: 0.45, minIdf: 2.1, minTerms: 1 };
    const { pack, skipped } = buildPack({ ...args, pages, coverage });
    assert.equal(pack.schemaVersion, 3);
    assert.deepEqual(
      pack.cards.map((card) => card.pageId),
      ["20", "100"],
    );
    assert.deepEqual(
      pack.chunks.map((chunk) => chunk.id),
      [
        "20#L1",
        "20#L2",
        "20#L3",
        "20#L4",
        "100#L1",
        "100#L2",
        "100#L3",
        "100#L4",
      ],
    );
    assert.deepEqual(skipped, [
      {
        pageId: "3",
        title: "RAG Card: FIXTURE card 3",
        reason: "has 2 layers, not 4",
        kind: "malformed",
      },
    ]);
    assert.deepEqual(pack.source, {
      site: SITE,
      space: "FX",
      label: "rag-card",
      cardCount: 2,
    });
    assert.deepEqual(pack.retrieval, { bm25: true, coverage });
    const { sha256, ...rest } = pack;
    assert.equal(
      sha256,
      createHash("sha256").update(canonicalJson(rest)).digest("hex"),
    );
    assert.deepEqual(buildPack({ ...args, pages, coverage }).pack, pack);
  });

  it("uses the canonical JSON agent-core checks: keys sorted at every level, no whitespace", () => {
    const value = { b: [2, { d: 1, c: "x" }], a: null, e: undefined };
    assert.equal(canonicalJson(value), '{"a":null,"b":[2,{"c":"x","d":1}]}');
    // The same vector is pinned in packages/agent-core/src/kb/pack.test.ts.
    assert.equal(
      packSha256({ z: 1, a: { y: "é", b: [true] }, sha256: "ignored" }),
      "07fffc8e05a1ca99dcc9aee6659de41c76190270b19b59e1ea7a0bfd11a5ebe3",
    );
  });
});

describe("customer names and diff", () => {
  const { pack } = buildPack({
    pages: [
      page("1"),
      page("2", {
        body: cardBody({ layer2: "FIXTURE: ask Contoso Corp first." }),
      }),
    ],
    site: SITE,
    space: "FX",
    label: "rag-card",
    builtAt: "2026-03-01T00:00:00.000Z",
  });

  it("finds a listed name as a whole word in any case, and names only page ids", () => {
    const names = readNameList(
      "# FIXTURE deny list\ncontoso corp\n\nNorthwind  # not in the cards\n",
    );
    assert.deepEqual(names, ["contoso corp", "Northwind"]);
    assert.deepEqual(customerNameHits(pack, ["contoso corp"]), ["2"]);
    assert.deepEqual(customerNameHits(pack, ["Northwind", "Glowin"]), []);
    assert.deepEqual(customerNameHits(pack, ["glow"]), ["1", "2"]);
    assert.deepEqual(customerNameHits(pack, []), []);
  });

  it("lists cards added, changed and removed", () => {
    const { pack: next } = buildPack({
      pages: [
        page("2", { body: cardBody({ layer2: "FIXTURE: changed text." }) }),
        page("3"),
      ],
      site: SITE,
      space: "FX",
      label: "rag-card",
      builtAt: "2026-03-02T00:00:00.000Z",
    });
    assert.deepEqual(diffPacks(pack, next), {
      added: [{ pageId: "3", title: "FIXTURE card 3" }],
      changed: [{ pageId: "2", title: "FIXTURE card 2" }],
      removed: [{ pageId: "1", title: "FIXTURE card 1" }],
    });
    assert.deepEqual(diffPacks(next, next), {
      added: [],
      changed: [],
      removed: [],
    });
  });
});

/** A signing key made for these tests, written outside the repository. */
const TEST_KEY = (() => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const dir = mkdtempSync(join(tmpdir(), "kb-test-key-"));
  const file = join(dir, "test-key.pem");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  writeFileSync(file, pem, { mode: 0o600 });
  return { file, pem, publicKey };
})();

describe("the CLI", () => {
  const env = {
    CONFLUENCE_EMAIL: "svc@example.com",
    CONFLUENCE_TOKEN: "FIXTURE-TOKEN",
  };
  const now = () => new Date("2026-03-04T05:06:07.000Z");

  /** The CLI with `--version 5.x` unless the test passes its own (or `version: null` for none), signed with a test key unless `--unsigned`. */
  function runWith({ version = "5.x", ...options }) {
    const out = [];
    const err = [];
    const versioned =
      version === null || options.argv?.includes("--version")
        ? options.argv
        : [...(options.argv ?? []), "--version", version];
    const argv =
      versioned.includes("--unsigned") || versioned.includes("--sign-key")
        ? versioned
        : [...versioned, "--sign-key", TEST_KEY.file];
    const result = run({
      env,
      now,
      sleep: async () => {},
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      ...options,
      argv,
    });
    return result.then((code) => ({
      code,
      out: out.join("\n"),
      err: err.join("\n"),
    }));
  }

  it("writes the pack under ~/apty-kb by default and prints ids and counts, never card text or the token", async () => {
    const home = tempDir();
    const { fetchImpl } = fakeConfluence({ ids: ["7", "8"] });
    const result = await runWith({
      argv: ["--space", "FX", "--site", SITE],
      fetchImpl,
      home,
    });
    assert.equal(result.code, 0, result.err);
    const file = join(home, "apty-kb", "apty-kb-FX-5.x-20260304.kbpack.json");
    const pack = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(pack.cards.length, 2);
    assert.equal(pack.builtAt, "2026-03-04T05:06:07.000Z");
    assert.equal(packSha256(pack), pack.sha256);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.match(
      result.out,
      /Built 2 cards \(8 chunks\): 2 full, 0 stubs \(not yet written\), 0 routing, 0 not in this version; skipped 0 malformed, 0 other_format\./,
    );
    assert.match(result.out, /NOT VERIFIED statements: 7, 8/);
    assert.match(result.out, /no --coverage-min/);
    assert.match(
      result.out,
      /Titles: rank 1 \d+ of 2 \([\d.]+%\), top 3 \d+ of 2/,
    );
    assert.match(result.out, /Symptom lines: rank 1 \d+ of \d+/);
    for (const secret of [
      "Glowing Banner",
      "glowIds",
      "FIXTURE-TOKEN",
      "Glow panel",
    ]) {
      assert.ok(!result.out.includes(secret), secret);
      assert.ok(!result.err.includes(secret), secret);
    }
  });

  it("prints the diff against an older pack", async () => {
    const dir = tempDir();
    const { pack: old } = buildPack({
      pages: [page("7", { group: "FIXTURE parent" }), page("9")],
      site: SITE,
      space: "FX",
      label: "rag-card",
      builtAt: "2026-01-01T00:00:00.000Z",
    });
    writeFileSync(join(dir, "old.json"), JSON.stringify(old));
    const { fetchImpl } = fakeConfluence({ ids: ["7", "8"] });
    const result = await runWith({
      argv: [
        "--site",
        SITE,
        "--space",
        "FX",
        "--diff",
        "old.json",
        "--out",
        "new.json",
      ],
      fetchImpl,
      cwd: dir,
    });
    assert.equal(result.code, 0, result.err);
    assert.match(result.out, /added 8 "FIXTURE card 8"/);
    assert.match(result.out, /removed 9 "FIXTURE card 9"/);
    assert.doesNotMatch(result.out, /changed 7/);
  });

  it("fails on a customer name, naming the page id and writing nothing", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "names.txt"), "Glowing Banner\n");
    const { fetchImpl } = fakeConfluence({ ids: ["7"] });
    const result = await runWith({
      argv: [
        "--site",
        SITE,
        "--customer-names",
        "names.txt",
        "--out",
        "p.json",
      ],
      fetchImpl,
      cwd: dir,
    });
    assert.equal(result.code, 1);
    assert.match(result.err, /Customer names found in pages 7;/);
    assert.ok(!result.err.includes("Glowing Banner"));
    assert.throws(() => statSync(join(dir, "p.json")));
  });

  it("refuses to write inside the repository, and needs the credentials", async () => {
    const { fetchImpl, calls } = fakeConfluence({ ids: ["7"] });
    const inside = await runWith({
      argv: ["--out", join(REPO_ROOT, "x.json")],
      fetchImpl,
    });
    assert.equal(inside.code, 1);
    assert.match(inside.err, /outside this repository/);

    const noToken = await runWith({
      argv: [],
      fetchImpl,
      env: { CONFLUENCE_EMAIL: "a" },
    });
    assert.equal(noToken.code, 1);
    assert.match(noToken.err, /Set CONFLUENCE_EMAIL and CONFLUENCE_TOKEN/);
    assert.equal(calls.length, 0);
  });

  it("names the cards with no Symptom line, and adds the owner's synonym groups", async () => {
    const dir = tempDir();
    const out = join(dir, "p.kbpack.json");
    const synonyms = join(dir, "synonyms.txt");
    writeFileSync(
      synonyms,
      "# FIXTURE vocabulary\nFIXTURE gizmo, gadget,  widgetry\n\nlonely\nsprocket,cog\n",
    );
    const { fetchImpl } = fakeConfluence({
      ids: ["7", "8"],
      bodies: { 8: cardBody({ symptom: null }) },
    });
    const result = await runWith({
      argv: ["--space", "FX", "--out", out, "--synonyms", synonyms],
      fetchImpl,
    });
    assert.equal(result.code, 0, result.err);
    assert.match(result.out, /no Symptom line in 8\b/);
    assert.doesNotMatch(result.out, /no Symptom line in 7\b/);
    const pack = JSON.parse(readFileSync(out, "utf8"));
    assert.deepEqual(pack.retrieval.synonyms, [
      ["FIXTURE gizmo", "gadget", "widgetry"],
      ["sprocket", "cog"],
    ]);
  });

  it("labels the pack with its Apty version: 4.x for A4PKH by default, and asks for it for JA or another space", async () => {
    const home = tempDir();
    const { fetchImpl } = fakeConfluence({ ids: ["7"] });
    const fourX = await runWith({
      argv: ["--space", "A4PKH", "--root", "1509720081", "--site", SITE],
      version: null,
      fetchImpl,
      home,
    });
    assert.equal(fourX.code, 0, fourX.err);
    const file = join(
      home,
      "apty-kb",
      "apty-kb-A4PKH-4.x-20260304.kbpack.json",
    );
    const pack = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(pack.aptyVersion, "4.x");
    assert.equal(
      pack.cards[0].url,
      `https://${SITE}/wiki/spaces/A4PKH/pages/7`,
    );

    for (const space of ["JA", "FX"]) {
      const missing = await runWith({
        argv: ["--space", space],
        version: null,
        fetchImpl,
      });
      assert.equal(missing.code, 1);
      assert.match(
        missing.err,
        new RegExp(
          `Pass --version 4\\.x, 5\\.x or common: space ${space} holds cards of more than one version`,
        ),
      );
    }
    const common = await runWith({
      argv: ["--space", "FX", "--out", join(tempDir(), "c.kbpack.json")],
      version: "common",
      fetchImpl,
    });
    assert.equal(common.code, 0, common.err);
    const wrong = await runWith({
      argv: ["--space", "FX"],
      version: "6.x",
      fetchImpl,
    });
    assert.match(wrong.err, /--version takes 4\.x, 5\.x or common/);
  });

  it("writes the calibrated coverage settings into the pack", async () => {
    const out = join(tempDir(), "p.kbpack.json");
    const { fetchImpl } = fakeConfluence({ ids: ["7"] });
    const result = await runWith({
      argv: [
        "--space",
        "FX",
        "--out",
        out,
        "--coverage-min",
        "0.35",
        "--coverage-min-idf",
        "2.4",
      ],
      fetchImpl,
    });
    assert.equal(result.code, 0, result.err);
    const pack = JSON.parse(readFileSync(out, "utf8"));
    assert.deepEqual(pack.retrieval.coverage, {
      min: 0.35,
      minIdf: 2.4,
      minTerms: 1,
    });
    assert.doesNotMatch(result.out, /no --coverage-min/);
  });

  it("names an empty label and a bad option", async () => {
    const { fetchImpl } = fakeConfluence({ ids: [] });
    const empty = await runWith({
      argv: ["--out", join(tempDir(), "p.json")],
      fetchImpl,
    });
    assert.equal(empty.code, 1);
    assert.match(
      empty.err,
      /No page in space JA matches: "RAG Card:" pages under page 1496711169\./,
    );
    for (const [flag, value, message] of [
      ["--root", "1 OR space=X", /--root takes a page id/],
      ["--label", 'x" OR label="y', /--label takes one label/],
      ["--space", "JA OR x", /--space takes a space key/],
    ]) {
      const refused = await runWith({ argv: [flag, value], fetchImpl });
      assert.match(refused.err, message);
    }
    for (const [flag, value, message] of [
      ["--coverage-min", "1.5", /--coverage-min takes a number from 0 to 1/],
      [
        "--coverage-min-idf",
        "-1",
        /--coverage-min-idf takes a number of 0 or more/,
      ],
      ["--threshold", "2", /Unknown or incomplete option: --threshold/],
    ]) {
      const bad = await runWith({ argv: [flag, value], fetchImpl });
      assert.match(bad.err, message);
    }
    const unknown = await runWith({ argv: ["--token", "x"], fetchImpl });
    assert.match(unknown.err, /Unknown or incomplete option: --token/);
  });
});

describe("a builder that says what it is doing (KB-RAG K25, A5)", () => {
  const options = { site: SITE, space: "FX" };

  it("a page with headings but no Layer N: headings is other_format, with its first five headings", () => {
    const body = [
      "What to copy",
      "Where it lives",
      "Mirror of the 4.x card",
      "Redaction",
      "Glossary",
      "Sixth heading",
    ]
      .map((h) => `<h2>FIXTURE ${h}</h2><p>FIXTURE text.</p>`)
      .join("");
    assert.deepEqual(parseCard(page("41", { body }), options), {
      skipped: "has headings but no Layer N: headings",
      kind: "other_format",
      headings: [
        "FIXTURE What to copy",
        "FIXTURE Where it lives",
        "FIXTURE Mirror of the 4.x card",
        "FIXTURE Redaction",
        "FIXTURE Glossary",
      ],
    });
    assert.deepEqual(
      parseCard(page("42", { body: cardBody({ layers: 3 }) }), options),
      { skipped: "has 3 layers, not 4" },
    );
  });

  it("names other_format pages with their headings on the summary, and progress goes to stderr only", async () => {
    const home = tempDir();
    const { fetchImpl } = fakeConfluence({
      ids: Array.from({ length: 12 }, (_, i) => String(i + 1)),
      bodies: {
        5: "<h3>FIXTURE Section A</h3><p>x</p><h3>FIXTURE Section B</h3>",
      },
    });
    const out = [];
    const err = [];
    let tick = 0;
    const code = await run({
      argv: ["--space", "FX", "--site", SITE, "--version", "5.x", "--unsigned"],
      env: {
        CONFLUENCE_EMAIL: "svc@example.com",
        CONFLUENCE_TOKEN: "FIXTURE-TOKEN",
      },
      fetchImpl,
      home,
      sleep: async () => {},
      clock: () => {
        tick += 1500;
        return tick;
      },
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    });
    assert.equal(code, 0, err.join("\n"));
    assert.match(out.join("\n"), /skipped 0 malformed, 1 other_format\./);
    assert.match(
      out.join("\n"),
      /other_format, skipped 5 "RAG Card: FIXTURE card 5": no Layer N: headings; its headings: FIXTURE Section A \| FIXTURE Section B/,
    );
    assert.deepEqual(err, [
      "Listing pages…",
      "Fetched 10 of 12 pages",
      "Fetched 12 of 12 pages",
      "Fetched in 1.5 s",
    ]);
    for (const line of out)
      assert.doesNotMatch(line, /Listing pages|Fetched \d+ of/);

    const quiet = [];
    await run({
      argv: [
        "--space",
        "FX",
        "--site",
        SITE,
        "--version",
        "5.x",
        "--quiet",
        "--unsigned",
      ],
      env: {
        CONFLUENCE_EMAIL: "svc@example.com",
        CONFLUENCE_TOKEN: "FIXTURE-TOKEN",
      },
      fetchImpl,
      home,
      sleep: async () => {},
      out: () => {},
      err: (line) => quiet.push(line),
    });
    assert.deepEqual(quiet, []);
  });

  it("cuts off a request that never answers, retries it, then names the path and how to check access", async () => {
    let calls = 0;
    const slept = [];
    const never = async () => {
      calls++;
      return new Promise(() => {});
    };
    await assert.rejects(
      fetchCardPages({
        site: SITE,
        space: "FX",
        label: "rag-card",
        email: "svc@example.com",
        token: "FIXTURE-TOKEN",
        fetchImpl: never,
        sleep: async (ms) => slept.push(ms),
        timeoutMs: 20,
      }),
      (error) => {
        assert.match(
          error.message,
          /^\/wiki\/rest\/api\/search did not answer within 0\.02 seconds after 3 retries\. Check access with: curl/,
        );
        assert.match(
          error.message,
          /200: access works; 401: wrong email or token; 403: a scoped token/,
        );
        assert.doesNotMatch(
          error.message,
          /FIXTURE-TOKEN|space%3D|rag-card|svc@example/,
        );
        return true;
      },
    );
    assert.equal(calls, 4);
    assert.deepEqual(slept, [1000, 2000, 4000]);
  });

  it("retries a network error, and --timeout takes seconds", async () => {
    let calls = 0;
    const { fetchImpl } = fakeConfluence({ ids: ["7"] });
    const flaky = async (url, init) => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed");
      return fetchImpl(url, init);
    };
    const pages = await fetchCardPages({
      site: SITE,
      space: "FX",
      label: "rag-card",
      email: "svc@example.com",
      token: "FIXTURE-TOKEN",
      fetchImpl: flaky,
      sleep: async () => {},
    });
    assert.equal(pages.length, 1);
    const err = [];
    const code = await run({
      argv: ["--space", "FX", "--version", "5.x", "--timeout", "0"],
      env: { CONFLUENCE_EMAIL: "a", CONFLUENCE_TOKEN: "b" },
      out: () => {},
      err: (line) => err.push(line),
    });
    assert.equal(code, 1);
    assert.match(err.join("\n"), /--timeout takes a number of seconds/);
  });
});

describe("signing in the builder (KB-RAG K23 P2)", () => {
  const env = {
    CONFLUENCE_EMAIL: "svc@example.com",
    CONFLUENCE_TOKEN: "FIXTURE-TOKEN",
  };
  const now = () => new Date("2026-11-12T00:00:00.000Z");

  async function build(extra, environment = env) {
    const home = tempDir();
    const { fetchImpl } = fakeConfluence({ ids: ["7"] });
    const out = [];
    const err = [];
    const code = await run({
      argv: ["--space", "FX", "--site", SITE, "--version", "5.x", ...extra],
      env: environment,
      now,
      fetchImpl,
      home,
      sleep: async () => {},
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    });
    const file = join(home, "apty-kb", "apty-kb-FX-5.x-20261112.kbpack.json");
    return { code, out: out.join("\n"), err: err.join("\n"), file };
  }

  it("writes schema 3, signed, expiring in 60 days, and the signature verifies with the public key", async () => {
    const result = await build(["--sign-key", TEST_KEY.file]);
    assert.equal(result.code, 0, result.err);
    const pack = JSON.parse(readFileSync(result.file, "utf8"));
    assert.equal(pack.schemaVersion, 3);
    assert.equal(pack.expiresAt, "2027-01-11T00:00:00.000Z");
    assert.equal(packSha256(pack), pack.sha256);
    const der = TEST_KEY.publicKey.export({ type: "spki", format: "der" });
    const keyId = createHash("sha256").update(der).digest("hex").slice(0, 16);
    assert.deepEqual(Object.keys(pack.signature).sort(), [
      "alg",
      "keyId",
      "value",
    ]);
    assert.equal(pack.signature.keyId, keyId);
    assert.ok(
      verify(
        "sha256",
        Buffer.from(`apty-kb-pack-signature/1\n${pack.sha256}\n${keyId}`),
        { key: TEST_KEY.publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(pack.signature.value, "base64"),
      ),
    );
    assert.match(
      result.out,
      new RegExp(`signed with key ${keyId}; expires 2027-01-11`),
    );
    for (const text of [result.out, result.err]) {
      assert.ok(!text.includes("PRIVATE KEY"), "never prints the key");
      assert.ok(
        !text.includes(TEST_KEY.pem.split("\n")[1]),
        "never prints the key",
      );
    }
  });

  it("reads the key from KB_PACK_SIGNING_KEY too, and takes --expires-days", async () => {
    const result = await build(["--expires-days", "180"], {
      ...env,
      KB_PACK_SIGNING_KEY: TEST_KEY.file,
    });
    assert.equal(result.code, 0, result.err);
    assert.equal(
      JSON.parse(readFileSync(result.file, "utf8")).expiresAt,
      "2027-05-11T00:00:00.000Z",
    );
  });

  it("refuses a pack valid for more than 180 days, and an unsigned pack without --unsigned", async () => {
    const long = await build([
      "--sign-key",
      TEST_KEY.file,
      "--expires-days",
      "181",
    ]);
    assert.equal(long.code, 1);
    assert.match(
      long.err,
      /--expires-days takes a whole number of days, 1 to 180/,
    );
    const unsigned = await build([]);
    assert.equal(unsigned.code, 1);
    assert.match(unsigned.err, /Pass --sign-key/);
  });

  it("--unsigned writes a schema 3 pack with no signature and says no extension uses it without allowUnsignedPacks", async () => {
    const result = await build(["--unsigned"]);
    assert.equal(result.code, 0, result.err);
    const pack = JSON.parse(readFileSync(result.file, "utf8"));
    assert.equal(pack.schemaVersion, 3);
    assert.equal(pack.signature, undefined);
    assert.match(
      result.out,
      /unsigned \(--unsigned\): no SE's extension uses it unless the policy sets allowUnsignedPacks/,
    );
  });

  it("refuses a key that is not ECDSA P-256", async () => {
    const dir = tempDir();
    const rsa = join(dir, "rsa.pem");
    writeFileSync(
      rsa,
      generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
        type: "pkcs8",
        format: "pem",
      }),
    );
    const result = await build(["--sign-key", rsa]);
    assert.equal(result.code, 1);
    assert.match(result.err, /not an ECDSA P-256 key/);
  });
});

describe("kb:keygen (KB-RAG K23 P2)", async () => {
  const { run: keygen } = await import("./kb-keygen.mjs");

  it("refuses a directory inside the repository", () => {
    const err = [];
    assert.equal(
      keygen({
        argv: ["--out", "tmp-keys"],
        cwd: REPO_ROOT,
        err: (l) => err.push(l),
        out: () => {},
      }),
      1,
    );
    assert.match(err.join("\n"), /never goes in this repository/);
  });

  it("writes the private key with mode 600 and the public key with its keyId; prints no private key", () => {
    const dir = join(tempDir(), "keys");
    const out = [];
    assert.equal(
      keygen({
        argv: ["--out", dir, "--name", "FIXTURE owner"],
        out: (l) => out.push(l),
      }),
      0,
    );
    const keyId = /keyId: ([0-9a-f]{16})/.exec(out.join("\n"))?.[1];
    assert.ok(keyId);
    const privatePath = join(dir, `kb-signing-key-${keyId}.pem`);
    assert.equal(statSync(privatePath).mode & 0o777, 0o600);
    const entry = JSON.parse(
      readFileSync(join(dir, `kb-signing-key-${keyId}.public.json`), "utf8"),
    );
    assert.deepEqual(Object.keys(entry).sort(), ["keyId", "name", "spki"]);
    assert.equal(
      createHash("sha256")
        .update(Buffer.from(entry.spki, "base64"))
        .digest("hex")
        .slice(0, 16),
      keyId,
    );
    assert.ok(!out.join("\n").includes("PRIVATE KEY"));
  });
});

describe('"not in this version" pages (KB-RAG K25, A4)', () => {
  it("classifies a page whose text before any heading says there is no 4.x equivalent as absent, with its reason", () => {
    const parsed = parseCard(
      page("51", {
        body: "<p>Symptom: FIXTURE funnel chart for workflows.</p><p>No 4.x equivalent: the FIXTURE funnel chart arrived with 5.x analytics. There is no setting for it.</p><p>This page is not an answer card.</p><h2>FIXTURE See also</h2>",
      }),
      { site: SITE, space: "FX" },
    );
    assert.equal(parsed.card.status, "absent");
    assert.equal(
      parsed.card.absentReason,
      "the FIXTURE funnel chart arrived with 5.x analytics.",
    );
    assert.equal(parsed.card.symptom, "FIXTURE funnel chart for workflows.");
    assert.deepEqual(parsed.chunks, []);
  });

  it("counts absent cards on the summary line, and the pack verifies with them", async () => {
    const home = tempDir();
    const { fetchImpl } = fakeConfluence({
      ids: ["7", "8"],
      bodies: {
        8: "<p>Symptom: FIXTURE x.</p><p>No 5.x equivalent: FIXTURE gone in 5.x.</p>",
      },
    });
    const out = [];
    const code = await run({
      argv: [
        "--space",
        "FX",
        "--site",
        SITE,
        "--version",
        "5.x",
        "--sign-key",
        TEST_KEY.file,
      ],
      env: {
        CONFLUENCE_EMAIL: "svc@example.com",
        CONFLUENCE_TOKEN: "FIXTURE-TOKEN",
      },
      fetchImpl,
      home,
      sleep: async () => {},
      out: (line) => out.push(line),
      err: () => {},
    });
    assert.equal(code, 0);
    assert.match(out.join("\n"), /0 routing, 1 not in this version; skipped/);
    assert.match(out.join("\n"), /not in this version 8 "FIXTURE card 8"/);
  });
});
