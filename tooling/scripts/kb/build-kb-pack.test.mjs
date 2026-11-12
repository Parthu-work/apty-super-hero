import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
    assert.equal(pack.schemaVersion, 2);
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

describe("the CLI", () => {
  const env = {
    CONFLUENCE_EMAIL: "svc@example.com",
    CONFLUENCE_TOKEN: "FIXTURE-TOKEN",
  };
  const now = () => new Date("2026-03-04T05:06:07.000Z");

  /** The CLI with `--version 5.x` unless the test passes its own (or `version: null` for none). */
  function runWith({ version = "5.x", ...options }) {
    const out = [];
    const err = [];
    const argv =
      version === null || options.argv?.includes("--version")
        ? options.argv
        : [...(options.argv ?? []), "--version", version];
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
      /Built 2 cards \(8 chunks\): 2 full, 0 stubs \(not yet written\), 0 routing; 0 malformed skipped\./,
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
