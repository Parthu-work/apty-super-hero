/**
 * KB-RAG K28 A5: the optional Chrome Web Store upload, against a fake
 * OAuth server and Web Store API on this machine. Synthetic ids and
 * secrets only.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { REQUIRED_ENV, run } from "./publish-webstore.mjs";

const ENV = {
  CWS_PUBLISH: "1",
  CWS_CLIENT_ID: "FIXTURE-client-id",
  CWS_CLIENT_SECRET: "FIXTURE-client-secret",
  CWS_REFRESH_TOKEN: "FIXTURE-refresh-token",
  CWS_PUBLISHER_ID: "fixture-publisher",
  CWS_ITEM_ID: "abcdefghijklmnopabcdefghijklmnop",
};
const ACCESS_TOKEN = "FIXTURE-access-token";
const SECRETS = [ENV.CWS_CLIENT_SECRET, ENV.CWS_REFRESH_TOKEN, ACCESS_TOKEN];

let server;
let base;
let dir;
let zip;
let requests;
let behaviour;

const ITEM = `/v2/publishers/${ENV.CWS_PUBLISHER_ID}/items/${ENV.CWS_ITEM_ID}`;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "apty-webstore-"));
  zip = join(dir, "apty-agent-v9.9.9-webstore.zip");
  writeFileSync(zip, Buffer.from("PK\u0003\u0004FIXTURE zip bytes"));
  server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body,
      });
      const json = (status, value) =>
        response
          .writeHead(status, { "Content-Type": "application/json" })
          .end(JSON.stringify(value));
      if (request.url === "/token") {
        const form = new URLSearchParams(body.toString());
        if (
          form.get("client_id") !== ENV.CWS_CLIENT_ID ||
          form.get("client_secret") !== ENV.CWS_CLIENT_SECRET ||
          form.get("refresh_token") !== ENV.CWS_REFRESH_TOKEN ||
          form.get("grant_type") !== "refresh_token"
        ) {
          return json(400, { error: "invalid_grant" });
        }
        return json(200, { access_token: ACCESS_TOKEN, expires_in: 3599 });
      }
      if (request.headers.authorization !== `Bearer ${ACCESS_TOKEN}`) {
        return json(401, { error: { status: "UNAUTHENTICATED" } });
      }
      if (request.url === `/upload${ITEM}:upload`) {
        if (behaviour.uploadStatus !== 200) {
          return json(behaviour.uploadStatus, {
            error: { status: "PERMISSION_DENIED" },
          });
        }
        return json(200, {
          itemId: ENV.CWS_ITEM_ID,
          uploadState: behaviour.uploadState,
          crxVersion: "9.9.9",
        });
      }
      if (request.url === `${ITEM}:fetchStatus`) {
        return json(200, {
          itemId: ENV.CWS_ITEM_ID,
          lastAsyncUploadState: behaviour.polledStates.shift() ?? "SUCCEEDED",
        });
      }
      if (request.url === `${ITEM}:publish`) {
        return json(200, { itemId: ENV.CWS_ITEM_ID, state: "PENDING_REVIEW" });
      }
      return json(404, {});
    });
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  requests = [];
  behaviour = { uploadStatus: 200, uploadState: "SUCCEEDED", polledStates: [] };
});

async function publish(env = ENV, argv = ["--zip", zip]) {
  const lines = [];
  const code = await run({
    argv,
    env,
    urls: { oauth: `${base}/token`, api: base, upload: `${base}/upload` },
    pollMs: 1,
    out: (line) => lines.push(line),
    err: (line) => lines.push(line),
  });
  return { code, text: lines.join("\n") };
}

describe("publish-webstore", () => {
  it("uploads the -webstore zip and publishes it, printing ids and states only", async () => {
    const { code, text } = await publish();
    assert.equal(code, 0, text);
    assert.deepEqual(
      requests.map((request) => `${request.method} ${request.url}`),
      ["POST /token", `POST /upload${ITEM}:upload`, `POST ${ITEM}:publish`],
    );
    const upload = requests[1];
    assert.equal(upload.authorization, `Bearer ${ACCESS_TOKEN}`);
    assert.deepEqual(upload.body, readFileSync(zip));
    assert.deepEqual(JSON.parse(requests[2].body.toString()), {
      publishType: "DEFAULT_PUBLISH",
    });
    assert.match(
      text,
      /Uploaded version 9\.9\.9 to item abcdefghijklmnopabcdefghijklmnop/,
    );
    assert.match(text, /Published: PENDING_REVIEW/);
    for (const secret of SECRETS) assert.ok(!text.includes(secret), secret);
  });

  it("waits for an upload still in progress", async () => {
    behaviour.uploadState = "IN_PROGRESS";
    behaviour.polledStates = ["IN_PROGRESS", "SUCCEEDED"];
    const { code, text } = await publish();
    assert.equal(code, 0, text);
    assert.equal(
      requests.filter((request) => request.url.endsWith(":fetchStatus")).length,
      2,
    );
  });

  it("fails with the status, never a secret, when the store refuses", async () => {
    behaviour.uploadStatus = 403;
    const refused = await publish();
    assert.equal(refused.code, 1);
    assert.match(refused.text, /upload failed: HTTP 403 \(PERMISSION_DENIED\)/);
    behaviour.uploadStatus = 200;
    behaviour.uploadState = "FAILED";
    const failed = await publish();
    assert.equal(failed.code, 1);
    assert.match(failed.text, /upload state FAILED/);
    const badGrant = await publish({
      ...ENV,
      CWS_REFRESH_TOKEN: "FIXTURE-old",
    });
    assert.equal(badGrant.code, 1);
    assert.match(badGrant.text, /access token failed: HTTP 400/);
    for (const { text } of [refused, failed, badGrant]) {
      for (const secret of [...SECRETS, "FIXTURE-old"]) {
        assert.ok(!text.includes(secret), secret);
      }
    }
    assert.ok(
      !requests.some((request) => request.url.endsWith(":publish")),
      "nothing published after a failed upload",
    );
  });

  it("skips visibly when CWS_PUBLISH is not 1, or a secret or the store id is missing", async () => {
    const off = await publish({ ...ENV, CWS_PUBLISH: "" });
    assert.equal(off.code, 0);
    assert.match(
      off.text,
      /^- Chrome Web Store: skipped \(the repository variable CWS_PUBLISH is not 1\)\.$/m,
    );
    const missing = await publish({
      ...ENV,
      CWS_CLIENT_SECRET: "",
      CWS_ITEM_ID: "",
    });
    assert.equal(missing.code, 0);
    assert.match(
      missing.text,
      /^- Chrome Web Store: skipped \(not set: CWS_CLIENT_SECRET, CWS_ITEM_ID\)\.$/m,
    );
    assert.equal(requests.length, 0);
    assert.deepEqual(REQUIRED_ENV, [
      "CWS_CLIENT_ID",
      "CWS_CLIENT_SECRET",
      "CWS_REFRESH_TOKEN",
      "CWS_PUBLISHER_ID",
      "CWS_ITEM_ID",
    ]);
  });

  it("refuses a zip that is not the -webstore package", async () => {
    const pinned = join(dir, "apty-agent-v9.9.9.zip");
    writeFileSync(pinned, "PK");
    const { code, text } = await publish(ENV, ["--zip", pinned]);
    assert.equal(code, 2);
    assert.match(text, /-webstore\.zip/);
    assert.equal(requests.length, 0);
  });
});

describe("the release workflow's Web Store step", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const job = workflow.slice(workflow.indexOf("\n  webstore:\n"));

  it("runs after the release, with the secrets only in its env", () => {
    assert.ok(job.length > 1, "a webstore job");
    assert.match(job, /\n {4}needs: publish\n/);
    assert.match(job, /CWS_PUBLISH: \$\{\{ vars\.CWS_PUBLISH \}\}/);
    assert.match(job, /CWS_ITEM_ID: \$\{\{ vars\.CWS_ITEM_ID \}\}/);
    for (const name of [
      "CWS_CLIENT_ID",
      "CWS_CLIENT_SECRET",
      "CWS_REFRESH_TOKEN",
    ]) {
      assert.match(
        job,
        new RegExp(`${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`),
      );
    }
    assert.match(
      job,
      /node tooling\/scripts\/publish-webstore\.mjs --zip "apty-agent-\$\{GITHUB_REF_NAME\}-webstore\.zip" >> "\$GITHUB_STEP_SUMMARY"/,
    );
    assert.match(job, /\n {6}contents: read\n/);
  });
});
