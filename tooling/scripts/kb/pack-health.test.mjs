/**
 * KB-RAG K28 A3: pipeline health. The pack-age check against a fake pack
 * host (fresh, 49 hours old, unreadable), and the failure alert that opens
 * or updates one `kb-pipeline` issue. Synthetic cards only.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import { buildPack, signPack } from "./build-kb-pack.mjs";
import { SYNTHETIC_PAGES } from "./fixtures/synthetic-cards.mjs";
import { MAX_PACK_AGE_HOURS, run as packAge } from "./pack-age.mjs";
import {
  ALERT_LABEL,
  failingSteps,
  raiseAlert,
  resolveAlert,
} from "./pipeline-alert.mjs";

const NOW = new Date("2026-11-19T12:00:00.000Z");
const TOKEN = "FIXTURE-publish-token";
const KEY = generateKeyPairSync("ec", { namedCurve: "P-256" })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();

const packBuiltHoursAgo = (hours, aptyVersion = "5.x") =>
  JSON.stringify(
    signPack(
      buildPack({
        pages: SYNTHETIC_PAGES,
        site: "synthetic.atlassian.invalid",
        space: "SY",
        label: "rag-card",
        builtAt: new Date(NOW.getTime() - hours * 3_600_000).toISOString(),
        aptyVersion,
      }).pack,
      KEY,
    ),
  );

const FILES = new Map([
  ["/kb/fresh.json", packBuiltHoursAgo(3)],
  ["/kb/old.json", packBuiltHoursAgo(49)],
  ["/kb/sign-in.json", "<html>FIXTURE sign in</html>"],
  ["/kb/4x.json", packBuiltHoursAgo(3, "4.x")],
]);

describe("pack-age", () => {
  let server;
  let origin;
  before(async () => {
    server = createServer((request, response) => {
      const body = FILES.get(request.url);
      if (request.headers.authorization !== `Bearer ${TOKEN}`) {
        response.writeHead(401).end();
      } else if (request.url === "/kb/forbidden.json") {
        response.writeHead(403).end();
      } else if (!body) {
        response.writeHead(404).end();
      } else {
        response.writeHead(200).end(body);
      }
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  const toFakeHost = (target, init) =>
    fetch(`${origin}${new URL(target).pathname}`, init);

  async function check(argv, env = { KB_PUBLISH_TOKEN: TOKEN }) {
    const lines = [];
    const code = await packAge({
      argv,
      env,
      now: () => NOW,
      fetchImpl: toFakeHost,
      out: (line) => lines.push(line),
      err: (line) => lines.push(line),
    });
    return { code, text: lines.join("\n") };
  }

  const url = (path) => `https://packs.example.com${path}`;

  it("passes a pack built 3 hours ago", async () => {
    const { code, text } = await check([
      "--version",
      "5.x",
      "--url",
      url("/kb/fresh.json"),
    ]);
    assert.equal(code, 0, text);
    assert.match(
      text,
      /^- KB pack 5\.x: built 2026-11-19T09:00:00\.000Z, 3\.0 hours ago\.$/m,
    );
  });

  it(`fails a pack built 49 hours ago (more than ${MAX_PACK_AGE_HOURS})`, async () => {
    const { code, text } = await check([
      "--version",
      "5.x",
      "--url",
      url("/kb/old.json"),
    ]);
    assert.equal(code, 1);
    assert.match(text, /49\.0 hours ago: older than 48 hours\./);
  });

  it("fails a pack that cannot be read or does not parse, naming only the reason", async () => {
    for (const [path, reason] of [
      ["/kb/sign-in.json", /The pack was refused: not_json/],
      ["/kb/forbidden.json", /HTTP 403/],
      ["/kb/missing.json", /not on the pack host \(HTTP 404\)/],
    ]) {
      const { code, text } = await check([
        "--version",
        "5.x",
        "--url",
        url(path),
      ]);
      assert.equal(code, 1, path);
      assert.match(text, reason);
      assert.match(text, /could not be read/);
      for (const secret of [TOKEN, "packs.example.com", path]) {
        assert.ok(!text.includes(secret), secret);
      }
    }
  });

  it("fails a pack of another version, and needs the token", async () => {
    const wrong = await check([
      "--version",
      "5.x",
      "--url",
      url("/kb/4x.json"),
    ]);
    assert.equal(wrong.code, 1);
    assert.match(wrong.text, /is a 4\.x pack/);
    const noToken = await check(
      ["--version", "5.x", "--url", url("/kb/fresh.json")],
      {},
    );
    assert.equal(noToken.code, 1);
    assert.match(noToken.text, /KB_PUBLISH_TOKEN is not set/);
  });

  it("checks several versions and fails when any one is old", async () => {
    const { code, text } = await check([
      "--version",
      "4.x",
      "--url",
      url("/kb/4x.json"),
      "--version",
      "5.x",
      "--url",
      url("/kb/old.json"),
    ]);
    assert.equal(code, 1);
    assert.match(text, /KB pack 4\.x: built .*3\.0 hours ago\.$/m);
    assert.match(text, /KB pack 5\.x: .*older than 48 hours/);
  });
});

function fakeGitHub(openIssues = [], comments = {}) {
  const calls = [];
  const record =
    (name, result = {}) =>
    async (params) => {
      calls.push({ name, params });
      return { data: typeof result === "function" ? result(params) : result };
    };
  return {
    calls,
    github: {
      rest: {
        issues: {
          createLabel: record("createLabel"),
          listForRepo: record("listForRepo", openIssues),
          create: record("create", { number: 41 }),
          createComment: record("createComment", { id: 7 }),
          listComments: record(
            "listComments",
            (params) => comments[params.issue_number] ?? [],
          ),
          update: record("update", {}),
        },
      },
      paginate: async (method, params) => (await method(params)).data,
    },
  };
}

describe("pipeline-alert", () => {
  const RUN = {
    owner: "example-org",
    repo: "example-repo",
    workflow: "KB packs",
    runUrl: "https://github.com/example-org/example-repo/actions/runs/123",
    failures: ["pack (5.x) / Gate"],
  };

  it("names the failing jobs' failing steps", () => {
    assert.deepEqual(
      failingSteps([
        {
          name: "pack (4.x)",
          conclusion: "success",
          steps: [{ name: "Gate", conclusion: "success" }],
        },
        {
          name: "pack (5.x)",
          conclusion: "failure",
          steps: [
            { name: "Build the pack", conclusion: "success" },
            { name: "Gate", conclusion: "failure" },
          ],
        },
        { name: "age", conclusion: "failure", steps: [] },
      ]),
      ["pack (5.x) / Gate", "age"],
    );
  });

  it(`opens one issue labelled ${ALERT_LABEL} with the run link and the failing step`, async () => {
    const fake = fakeGitHub([]);
    const result = await raiseAlert({ github: fake.github, ...RUN });
    assert.deepEqual(result, { action: "opened", number: 41 });
    const created = fake.calls.find((call) => call.name === "create").params;
    assert.deepEqual(created.labels, [ALERT_LABEL]);
    assert.match(created.body, /actions\/runs\/123/);
    assert.match(created.body, /- pack \(5\.x\) \/ Gate/);
    assert.equal(
      fake.calls.filter((call) => call.name === "createComment").length,
      0,
    );
  });

  it("comments on the open issue instead of opening another, ignoring pull requests", async () => {
    const fake = fakeGitHub([
      { number: 9, pull_request: {} },
      { number: 12 },
      { number: 15 },
    ]);
    const result = await raiseAlert({ github: fake.github, ...RUN });
    assert.deepEqual(result, { action: "updated", number: 12 });
    assert.equal(fake.calls.filter((call) => call.name === "create").length, 0);
    const comment = fake.calls.find(
      (call) => call.name === "createComment",
    ).params;
    assert.equal(comment.issue_number, 12);
    assert.match(comment.body, /actions\/runs\/123/);
    const list = fake.calls.find((call) => call.name === "listForRepo").params;
    assert.equal(list.labels, ALERT_LABEL);
    assert.equal(list.state, "open");
  });

  it("still opens the issue when the label already exists", async () => {
    const fake = fakeGitHub([]);
    fake.github.rest.issues.createLabel = async () => {
      throw Object.assign(new Error("exists"), { status: 422 });
    };
    assert.equal(
      (await raiseAlert({ github: fake.github, ...RUN })).action,
      "opened",
    );
  });
});

const workflowText = (name) =>
  readFileSync(
    new URL(`../../../.github/workflows/${name}`, import.meta.url),
    "utf8",
  );

describe("pipeline-alert: green again", () => {
  const GREEN = {
    owner: "example-org",
    repo: "example-repo",
    workflow: "KB packs",
    runUrl: "https://github.com/example-org/example-repo/actions/runs/200",
  };
  const failedBody = (workflow, run) =>
    `**${workflow}** failed: https://github.com/example-org/example-repo/actions/runs/${run}\n\nFailing steps:`;

  it("comments Green again with the run link and closes the open kb-pipeline issue", async () => {
    const fake = fakeGitHub([
      { number: 12, body: failedBody("KB packs", 150) },
    ]);
    const result = await resolveAlert({ github: fake.github, ...GREEN });
    assert.deepEqual(result, { action: "closed", numbers: [12] });
    const comment = fake.calls.find(
      (call) => call.name === "createComment",
    ).params;
    assert.equal(comment.issue_number, 12);
    assert.equal(
      comment.body,
      "Green again: https://github.com/example-org/example-repo/actions/runs/200",
    );
    const update = fake.calls.find((call) => call.name === "update").params;
    assert.deepEqual(
      {
        number: update.issue_number,
        state: update.state,
        reason: update.state_reason,
      },
      { number: 12, state: "closed", reason: "completed" },
    );
  });

  it("does nothing when no kb-pipeline issue is open", async () => {
    const fake = fakeGitHub([{ number: 9, pull_request: {} }]);
    assert.deepEqual(await resolveAlert({ github: fake.github, ...GREEN }), {
      action: "none",
      numbers: [],
    });
    assert.equal(fake.calls.filter((call) => call.name === "update").length, 0);
    assert.equal(
      fake.calls.filter((call) => call.name === "createComment").length,
      0,
    );
  });

  it("leaves the issue open while its latest failure is another workflow's", async () => {
    const fake = fakeGitHub(
      [{ number: 12, body: failedBody("KB packs", 150) }],
      {
        12: [
          { body: failedBody("KB pack health", 160) },
          { body: "a person's note" },
        ],
      },
    );
    assert.equal(
      (await resolveAlert({ github: fake.github, ...GREEN })).action,
      "none",
    );
    const health = fakeGitHub(
      [{ number: 12, body: failedBody("KB packs", 150) }],
      {
        12: [{ body: failedBody("KB pack health", 160) }],
      },
    );
    assert.deepEqual(
      await resolveAlert({
        github: health.github,
        ...GREEN,
        workflow: "KB pack health",
      }),
      { action: "closed", numbers: [12] },
    );
  });
});

describe("the workflows' failure alert", () => {
  for (const name of ["kb-packs.yml", "kb-pack-health.yml"]) {
    it(`${name} raises the kb-pipeline alert with its own token when it fails`, () => {
      const text = workflowText(name);
      const start = text.indexOf("\n  alert:\n");
      assert.ok(start > 0, "an alert job");
      const alert = text.slice(start);
      assert.match(alert, /\n {4}if: failure\(\)\n/);
      assert.match(alert, /\n {6}issues: write\n/);
      assert.match(alert, /tooling\/scripts\/kb\/pipeline-alert\.mjs/);
      assert.match(alert, /alertForRun\(\{ github, context, workflow: /);
      assert.ok(!alert.includes("secrets."), "no secret in the alert job");
    });
  }

  it("kb-pack-health.yml checks both versions' pack age on a schedule", () => {
    const text = workflowText("kb-pack-health.yml");
    assert.match(text, /schedule:\n\s+# .*\n\s+- cron: /);
    assert.match(text, /--version 4\.x --url "\$KB_PUBLISH_URL_4X"/);
    assert.match(text, /--version 5\.x --url "\$KB_PUBLISH_URL_5X"/);
    assert.match(text, /node tooling\/scripts\/kb\/pack-age\.mjs/);
  });
});
