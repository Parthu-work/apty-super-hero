/**
 * KB-RAG K26 D5, D7: the publish gate (D-DEL8) and the pack host transfer,
 * on synthetic cards only. A gate failure publishes nothing; the summary
 * holds counts, ids, numbers and codes, never a card title or card text.
 */
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, before, describe, it } from "node:test";
import { buildPack, signPack } from "./build-kb-pack.mjs";
import { calibrateCoverage, loadAgentCore, readQuestions } from "./eval-kb.mjs";
import { SYNTHETIC_PAGES } from "./fixtures/synthetic-cards.mjs";
import { cardDrop, gate, qualityMisses, run } from "./publish-gate.mjs";
import { run as transfer } from "./publish-pack.mjs";

const QUESTIONS = new URL(
  "./fixtures/synthetic-questions.json",
  import.meta.url,
);
const KEY = generateKeyPairSync("ec", { namedCurve: "P-256" })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();

const build = (
  pages = SYNTHETIC_PAGES,
  builtAt = "2026-11-12T00:00:00.000Z",
  coverage = undefined,
) =>
  buildPack({
    coverage,
    pages,
    site: "synthetic.atlassian.invalid",
    space: "SY",
    label: "rag-card",
    builtAt,
    expiresAt: "2027-01-11T00:00:00.000Z",
    aptyVersion: "5.x",
  }).pack;

const SELF_OK = {
  titles: { of: 10, rank1: 10, top3: 10 },
  symptoms: { of: 10, rank1: 9, top3: 10 },
  failingTitles: [],
};

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "kb-publish-gate-"));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const titlesOf = (pack) => pack.cards.map((card) => card.title);

describe("the card-count and quality rules", () => {
  it("fails a drop of more than 10%, not 10% itself", () => {
    assert.equal(cardDrop(100, 90).dropped, false);
    assert.equal(cardDrop(100, 89).dropped, true);
    assert.equal(cardDrop(0, 0).dropped, false);
    assert.equal(cardDrop(10, 12).dropped, false);
  });

  it("names each D-KB8 number under its bar, and ignores one with no questions", () => {
    assert.deepEqual(
      qualityMisses({
        recallAt3: 0.95,
        notCoveredPrecision: 0.5,
        notCoveredRecall: null,
        layerAccuracy: 0.69,
      }),
      ["notCoveredPrecision", "layerAccuracy"],
    );
  });
});

describe("gate", () => {
  const signed = signPack(build(), KEY);

  it("passes a signed pack and summarizes it with ids and counts only", () => {
    const previous = build(SYNTHETIC_PAGES.slice(0, -1));
    const result = gate({
      version: "5.x",
      pack: signed,
      previous,
      selfReport: SELF_OK,
    });
    assert.equal(result.ok, true, result.failures.join("; "));
    const text = result.lines.join("\n");
    assert.match(
      text,
      /- Cards: \d+ \(full \d+, stub \d+, routing \d+, absent \d+\)/,
    );
    assert.match(text, new RegExp(`- Added: ${SYNTHETIC_PAGES.at(-1).id}`));
    assert.match(
      text,
      new RegExp(`- Pack sha256 \\(its checksum\\): ${signed.sha256}`),
    );
    assert.match(text, new RegExp(`- Key id: ${signed.signature.keyId}`));
    assert.match(text, /- Expires: 2027-01-11/);
    for (const title of titlesOf(signed))
      assert.ok(!text.includes(title), title);
    for (const chunk of signed.chunks) {
      assert.ok(!text.includes(chunk.text.slice(0, 40)));
    }
  });

  it("fails an unsigned pack, except in a dry run", () => {
    const pack = build();
    assert.deepEqual(
      gate({ version: "5.x", pack, selfReport: SELF_OK }).failures,
      ["unsigned"],
    );
    assert.equal(
      gate({ version: "5.x", pack, selfReport: SELF_OK, dryRun: true }).ok,
      true,
    );
  });

  it("fails another version, a failing self-check and a failing quality gate", () => {
    const result = gate({
      version: "4.x",
      pack: signed,
      selfReport: { ...SELF_OK, failingTitles: ["101"] },
      quality: {
        questions: 20,
        recallAt3: 0.5,
        notCoveredPrecision: 1,
        notCoveredRecall: 1,
        layerAccuracy: 1,
      },
    });
    assert.deepEqual(result.failures, [
      "version_mismatch (5.x)",
      "self_check (titles not in the top 3: 101)",
      "quality_gate (recallAt3)",
    ]);
    assert.match(result.lines.at(-1), /\*\*Not published\.\*\*/);
  });

  it("fails a card drop over 10% unless a manual run overrides it with a reason", () => {
    const previous = build([
      ...SYNTHETIC_PAGES,
      ...SYNTHETIC_PAGES.map((page) => ({ ...page, id: `9${page.id}` })),
    ]);
    const dropped = gate({
      version: "5.x",
      pack: signed,
      previous,
      selfReport: SELF_OK,
    });
    assert.equal(dropped.ok, false);
    assert.match(dropped.failures[0], /^card_drop \(50\.0% from \d+\)$/);
    assert.equal(
      gate({
        version: "5.x",
        pack: signed,
        previous,
        selfReport: SELF_OK,
        overrideCardDrop: true,
        reason: "",
      }).ok,
      false,
    );
    const overridden = gate({
      version: "5.x",
      pack: signed,
      previous,
      selfReport: SELF_OK,
      overrideCardDrop: true,
      reason: "FIXTURE: a group\nmoved to another space",
    });
    assert.equal(overridden.ok, true);
    assert.match(
      overridden.lines.join("\n"),
      /overridden by a manual run\. Reason: FIXTURE: a group moved to another space/,
    );
  });
});

describe("run", () => {
  it("checks a pack file end to end, writes the summary and exits 0", async () => {
    const core = await loadAgentCore();
    const questions = readQuestions(readFileSync(QUESTIONS, "utf8"));
    const { min, minIdf, minTerms } = calibrateCoverage(
      core,
      build(),
      questions,
    );
    const pack = join(dir, "pack.json");
    writeFileSync(
      pack,
      JSON.stringify(
        signPack(
          build(SYNTHETIC_PAGES, undefined, { min, minIdf, minTerms }),
          KEY,
        ),
      ),
    );
    const lines = [];
    const code = await run({
      argv: [
        "--version",
        "5.x",
        "--pack",
        pack,
        "--questions",
        QUESTIONS.pathname,
      ],
      out: (line) => lines.push(line),
    });
    const text = lines.join("\n");
    assert.match(text, /Quality gate \(\d+ questions\)/);
    assert.equal(code, 0, text);
  });

  it("exits 1 with the reason for a pack that does not parse, and 2 on a usage error", async () => {
    const pack = join(dir, "broken.json");
    writeFileSync(pack, "{}");
    const lines = [];
    assert.equal(
      await run({
        argv: ["--version", "5.x", "--pack", pack],
        out: (line) => lines.push(line),
      }),
      1,
    );
    assert.match(
      lines.join("\n"),
      /could not be checked: The pack was refused: wrong_kind/,
    );
    assert.equal(
      await run({
        argv: ["--version", "5.x", "--pack", pack, "--override-card-drop"],
        err: () => undefined,
      }),
      2,
    );
  });
});

describe("publish-pack", () => {
  const url = "https://packs.example.com/kb/5x.json?sig=SECRET";

  function host(initial) {
    let stored = initial;
    const calls = [];
    const fetchImpl = async (target, init) => {
      calls.push({ target: String(target), init });
      if (init.method === "PUT") {
        stored = Buffer.from(init.body);
        return new Response(null, { status: 201 });
      }
      return stored === undefined
        ? new Response("", { status: 404 })
        : new Response(stored, { status: 200 });
    };
    return { fetchImpl, calls, stored: () => stored };
  }

  it("uploads then reads back the same bytes", async () => {
    const fake = host(undefined);
    const lines = [];
    const env = { KB_PUBLISH_TOKEN: "FIXTURE-token" };
    const pack = join(dir, "upload.json");
    writeFileSync(pack, '{"FIXTURE":true}');
    assert.equal(
      await transfer({
        argv: ["upload", "--url", url, "--pack", pack],
        env,
        fetchImpl: fake.fetchImpl,
        out: (line) => lines.push(line),
      }),
      0,
    );
    assert.deepEqual(
      fake.calls.map((call) => call.init.method),
      ["PUT", "GET"],
    );
    assert.equal(
      fake.calls[0].init.headers.Authorization,
      "Bearer FIXTURE-token",
    );
    // Exactly these lines: no URL, host, query or token is printed.
    const sha = createHash("sha256").update('{"FIXTURE":true}').digest("hex");
    assert.deepEqual(lines, [
      `Published to the pack host: HTTP 201, read back with the same file sha256 ${sha}.`,
    ]);
  });

  it("fails when the read-back differs or the host refuses, and sends nothing in a dry run", async () => {
    const pack = join(dir, "upload2.json");
    writeFileSync(pack, '{"FIXTURE":2}');
    const errors = [];
    const tampering = async (_target, init) =>
      init.method === "PUT"
        ? new Response(null, { status: 200 })
        : new Response("{}", { status: 200 });
    assert.equal(
      await transfer({
        argv: ["upload", "--url", url, "--pack", pack],
        env: { KB_PUBLISH_TOKEN: "t" },
        fetchImpl: tampering,
        err: (line) => errors.push(line),
      }),
      1,
    );
    assert.match(errors.at(-1), /differs/);
    assert.equal(
      await transfer({
        argv: ["upload", "--url", url, "--pack", pack],
        env: { KB_PUBLISH_TOKEN: "t" },
        fetchImpl: async () => new Response(null, { status: 403 }),
        err: (line) => errors.push(line),
      }),
      1,
    );
    assert.match(errors.at(-1), /HTTP 403/);
    let called = false;
    assert.equal(
      await transfer({
        argv: ["upload", "--url", url, "--pack", pack],
        env: { KB_PUBLISH_DRY_RUN: "1" },
        fetchImpl: async () => {
          called = true;
          return new Response(null, { status: 500 });
        },
        out: () => undefined,
      }),
      0,
    );
    assert.equal(called, false);
    assert.equal(
      await transfer({
        argv: ["upload", "--url", "http://packs.example.com/x", "--pack", pack],
        env: { KB_PUBLISH_TOKEN: "t" },
        err: () => undefined,
      }),
      2,
    );
  });
});

describe("the gate's in-memory reads (no file is written)", () => {
  const PREVIOUS_URL = "https://packs.example.com/kb/5x.json?sig=SECRET";
  const NAMES_URL = "https://packs.example.com/kb/names.txt";

  function hostWith(files) {
    const calls = [];
    return {
      calls,
      fetchImpl: async (target, init) => {
        calls.push({ target: String(target), init });
        const body = files[String(target)];
        if (body === undefined) return new Response("", { status: 404 });
        if (typeof body === "number") return new Response("", { status: body });
        return new Response(body, { status: 200 });
      },
    };
  }

  async function runGate(
    files,
    extra,
    env = { KB_PUBLISH_TOKEN: "FIXTURE-token" },
  ) {
    const pack = join(dir, "gate-pack.json");
    writeFileSync(pack, JSON.stringify(signPack(build(), KEY)));
    const lines = [];
    const fake = hostWith(files);
    const code = await run({
      argv: ["--version", "5.x", "--pack", pack, ...extra],
      env,
      fetchImpl: fake.fetchImpl,
      out: (line) => lines.push(line),
      err: (line) => lines.push(line),
    });
    return { code, text: lines.join("\n"), calls: fake.calls };
  }

  it("reads the last published pack with the token, and compares against it", async () => {
    const previous = JSON.stringify(
      signPack(build(SYNTHETIC_PAGES.slice(0, -1)), KEY),
    );
    const { code, text, calls } = await runGate({ [PREVIOUS_URL]: previous }, [
      "--previous-url",
      PREVIOUS_URL,
    ]);
    assert.equal(code, 0, text);
    assert.match(
      text,
      new RegExp(`- Added: ${SYNTHETIC_PAGES.at(-1).id}$`, "m"),
    );
    assert.equal(calls[0].init.headers.Authorization, "Bearer FIXTURE-token");
  });

  it("treats a 404 as the first run, and refuses a previous pack that does not parse or cannot be read", async () => {
    const first = await runGate({}, ["--previous-url", PREVIOUS_URL]);
    assert.equal(first.code, 0, first.text);
    assert.match(first.text, /No previous published pack/);
    const signIn = await runGate(
      { [PREVIOUS_URL]: "<html>FIXTURE sign in</html>" },
      ["--previous-url", PREVIOUS_URL],
    );
    assert.equal(signIn.code, 1);
    assert.match(
      signIn.text,
      /the last published pack: The pack was refused: not_json/,
    );
    const refused = await runGate({ [PREVIOUS_URL]: 403 }, [
      "--previous-url",
      PREVIOUS_URL,
    ]);
    assert.equal(refused.code, 1);
    assert.match(refused.text, /the pack could not be read \(HTTP 403\)/);
  });

  it("fails a card that names a customer from the list, and a list that is missing", async () => {
    const named = SYNTHETIC_PAGES[0].title
      .split(/\s+/)
      .find((word) => word.length > 5);
    const hit = await runGate({ [NAMES_URL]: `${named}\n` }, [
      "--names-url",
      NAMES_URL,
    ]);
    assert.equal(hit.code, 1, hit.text);
    assert.match(hit.text, /Failed: customer_names \(pages \d+/);
    const clean = await runGate({ [NAMES_URL]: "FIXTURE Nobody Corp\n" }, [
      "--names-url",
      NAMES_URL,
    ]);
    assert.equal(clean.code, 0, clean.text);
    assert.match(clean.text, /- Customer names: 1 checked, none found/);
    const missing = await runGate({}, ["--names-url", NAMES_URL]);
    assert.equal(missing.code, 1);
    assert.match(missing.text, /customer-name list is not on the pack host/);
  });

  it("needs the token, and prints neither the URL nor the token", async () => {
    const noToken = await runGate({}, ["--previous-url", PREVIOUS_URL], {});
    assert.equal(noToken.code, 1);
    assert.match(noToken.text, /KB_PUBLISH_TOKEN is not set/);
    const { text } = await runGate({}, ["--previous-url", PREVIOUS_URL]);
    for (const secret of ["SECRET", "FIXTURE-token", "/kb/"]) {
      assert.equal(text.split(secret).length, 1, secret);
    }
  });
});

describe("the quality gate from the pack host (KB-RAG K28, A2)", () => {
  const TOKEN = "FIXTURE-publish-token";
  const QUESTIONS_URL = "https://packs.example.com/kb/questions-5x.json";
  const questionText = readFileSync(QUESTIONS, "utf8");
  let server;
  let origin;
  const requests = [];

  before(async () => {
    server = createServer((request, response) => {
      requests.push({
        url: request.url,
        authorization: request.headers.authorization,
      });
      if (request.headers.authorization !== `Bearer ${TOKEN}`) {
        response.writeHead(401).end();
      } else if (request.url === "/kb/questions-5x.json") {
        response
          .writeHead(200, { "Content-Type": "application/json" })
          .end(questionText);
      } else {
        response.writeHead(404).end();
      }
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  /** The real fetch, sent to the fake host on this machine instead of the https URL. */
  const toFakeHost = (target, init) =>
    fetch(`${origin}${new URL(target).pathname}`, init);

  async function download(
    url = QUESTIONS_URL,
    env = { KB_PUBLISH_TOKEN: TOKEN },
  ) {
    const chunks = [];
    const errors = [];
    const code = await transfer({
      argv: ["read", "--url", url],
      env,
      fetchImpl: toFakeHost,
      write: (bytes) => chunks.push(Buffer.from(bytes)),
      err: (line) => errors.push(line),
    });
    return { code, body: Buffer.concat(chunks), errors: errors.join("\n") };
  }

  async function gateFromHost(pages, coverage) {
    const { code: readCode, body } = await download();
    assert.equal(readCode, 0);
    const pack = join(dir, "host-gate-pack.json");
    writeFileSync(
      pack,
      JSON.stringify(signPack(build(pages, undefined, coverage), KEY)),
    );
    const lines = [];
    const code = await run({
      argv: ["--version", "5.x", "--pack", pack, "--questions", "-"],
      stdin: Readable.from([body]),
      out: (line) => lines.push(line),
      err: (line) => lines.push(line),
    });
    return { code, text: lines.join("\n") };
  }

  const calibrated = async () => {
    const core = await loadAgentCore();
    const { min, minIdf, minTerms } = calibrateCoverage(
      core,
      build(),
      readQuestions(questionText),
    );
    return { min, minIdf, minTerms };
  };

  it("reads the question set from the host with the token, and the gate passes on a good pack", async () => {
    const { code, text } = await gateFromHost(
      SYNTHETIC_PAGES,
      await calibrated(),
    );
    assert.equal(code, 0, text);
    assert.match(
      text,
      /- Quality gate \(13 questions\): 10 covered, 3 not covered; Recall@1 [\d.]+, Recall@3 1\.00, not covered precision [\d.]+, recall [\d.]+, layer accuracy [\d.]+/,
    );
    assert.equal(requests.at(-1).authorization, `Bearer ${TOKEN}`);
  });

  it("fails the gate on a pack that misses the questions' cards", async () => {
    const { code, text } = await gateFromHost(
      SYNTHETIC_PAGES.slice(0, 2),
      await calibrated(),
    );
    assert.equal(code, 1, text);
    assert.match(text, /Failed: .*quality_gate \(recallAt3/);
  });

  it("puts metrics only in the summary, never a question", async () => {
    const { text } = await gateFromHost(SYNTHETIC_PAGES, await calibrated());
    for (const question of JSON.parse(questionText)) {
      assert.ok(!text.includes(question.q), question.id);
      assert.ok(!text.includes(question.id), question.id);
    }
    for (const secret of [TOKEN, "packs.example.com", "questions-5x"]) {
      assert.ok(!text.includes(secret), secret);
    }
  });

  it("names the HTTP status, never the URL or token, when the question set cannot be read", async () => {
    const missing = await download(
      "https://packs.example.com/kb/questions-4x.json",
    );
    assert.equal(missing.code, 1);
    assert.match(missing.errors, /HTTP 404/);
    const refused = await download(QUESTIONS_URL, {
      KB_PUBLISH_TOKEN: "FIXTURE-wrong",
    });
    assert.equal(refused.code, 1);
    assert.match(refused.errors, /HTTP 401/);
    const noToken = await download(QUESTIONS_URL, {});
    assert.equal(noToken.code, 1);
    assert.match(noToken.errors, /KB_PUBLISH_TOKEN is not set/);
    for (const text of [missing.errors, refused.errors]) {
      assert.doesNotMatch(text, /packs\.example\.com/);
      assert.doesNotMatch(text, /FIXTURE-wrong/);
    }
    assert.equal(missing.body.length, 0);
  });

  it("says visibly that the gate is not active when there is no question set", async () => {
    for (const version of ["4.x", "5.x"]) {
      const pack = join(dir, `no-questions-${version}.json`);
      writeFileSync(
        pack,
        JSON.stringify(
          signPack(
            buildPack({
              pages: SYNTHETIC_PAGES,
              site: "synthetic.atlassian.invalid",
              space: "SY",
              label: "rag-card",
              builtAt: "2026-11-12T00:00:00.000Z",
              aptyVersion: version,
            }).pack,
            KEY,
          ),
        ),
      );
      const lines = [];
      await run({
        argv: ["--version", version, "--pack", pack],
        out: (line) => lines.push(line),
      });
      assert.ok(
        lines.includes(
          `- Quality gate not active for ${version}: no question set`,
        ),
        lines.join("\n"),
      );
    }
  });

  it("the nightly job pipes each version's question set from its repository variable", () => {
    const workflow = readFileSync(
      new URL("../../../.github/workflows/kb-packs.yml", import.meta.url),
      "utf8",
    );
    assert.match(
      workflow,
      /KB_QUESTIONS_URL_4X: \$\{\{ vars\.KB_QUESTIONS_URL_4X \}\}/,
    );
    assert.match(
      workflow,
      /KB_QUESTIONS_URL_5X: \$\{\{ vars\.KB_QUESTIONS_URL_5X \}\}/,
    );
    assert.match(
      workflow,
      /publish-pack\.mjs read --url "\$questions_url"\s*\\\s*\|\s*node tooling\/scripts\/kb\/publish-gate\.mjs "\$\{args\[@\]\}" --questions -/,
    );
    assert.match(
      workflow,
      /Quality gate not active for \$VERSION: no question set/,
    );
    assert.ok(!workflow.includes("tooling/scripts/kb/questions/"));
  });
});
