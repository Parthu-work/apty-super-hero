import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  agentIdsFromReference,
  buildTestRecorder,
  notA5xClient,
} from "./build-client-test-recorder.mjs";

const FAKE_CLIENT = fileURLToPath(
  new URL("../e2e/fixtures/fake-5x-client", import.meta.url),
);
const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function work() {
  const dir = mkdtempSync(join(tmpdir(), "recorder-test-"));
  dirs.push(dir);
  return dir;
}

/** The fake Client zipped as a store download would be, optionally changed first. */
function zipClient(change) {
  const dir = work();
  const copy = join(dir, "client");
  execFileSync("cp", ["-r", FAKE_CLIENT, copy]);
  change?.(copy);
  const zip = join(dir, "client.zip");
  execFileSync("zip", ["-qr", zip, "."], { cwd: copy });
  return zip;
}

function unzip(zip) {
  const dir = work();
  execFileSync("unzip", ["-q", zip, "-d", dir]);
  return dir;
}

describe("build-client-test-recorder", () => {
  it("allows only the real Agent IDs from the reference module, never its placeholder", () => {
    assert.deepEqual(agentIdsFromReference(), [
      "bpiondflhhdplemamgggcdajclmoeple",
    ]);
  });

  it("puts the recorder in front of the Client's own background, allows the Agent, marks the build and adds match patterns", async () => {
    const out = join(work(), "recorder.zip");

    const built = await buildTestRecorder({
      input: zipClient(),
      output: out,
      matches: ["http://127.0.0.1/*"],
      now: new Date("2026-11-03T00:00:00Z"),
    });

    const dir = unzip(out);
    const manifest = JSON.parse(
      readFileSync(join(dir, "manifest.json"), "utf8"),
    );
    assert.equal(manifest.name, "Apty Client (test recorder)");
    assert.equal(built.name, manifest.name);
    assert.deepEqual(manifest.externally_connectable, {
      ids: ["bpiondflhhdplemamgggcdajclmoeple"],
    });
    assert.deepEqual(manifest.content_scripts[0].matches, [
      "https://preview.crm.example.test/*",
      "http://127.0.0.1/*",
    ]);
    const background = readFileSync(join(dir, "background.js"), "utf8");
    const own = readFileSync(join(FAKE_CLIENT, "background.js"), "utf8");
    assert.ok(
      background.endsWith(own),
      "the Client's bundle is unchanged, last",
    );
    assert.ok(
      background.indexOf("__aptyRecorderFetch") < background.indexOf(own),
    );
    assert.match(background, /observedFetch/);
    assert.match(background, /recordWidgetChatTurn/);
    assert.doesNotThrow(() => new Function(background), "valid classic script");
    const note = readFileSync(join(dir, "TEST-BUILD.txt"), "utf8");
    assert.match(note, /NOT FOR CUSTOMERS/);
    assert.match(note, /apty-super-hero at [0-9a-f]{40}|unknown/);
    assert.match(note, /2026-11-03T00:00:00\.000Z/);
  });

  it("refuses a build that is not a 5.x WXT Client", async () => {
    const noConfig = zipClient((dir) =>
      unlinkSync(join(dir, "player-config.json")),
    );
    const noWindowScript = zipClient((dir) => {
      const path = join(dir, "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.web_accessible_resources = [
        { matches: ["<all_urls>"], resources: ["config.json"] },
      ];
      writeFileSync(path, JSON.stringify(manifest));
    });

    await assert.rejects(
      buildTestRecorder({ input: noConfig, output: join(work(), "a.zip") }),
      /no player-config\.json/,
    );
    await assert.rejects(
      buildTestRecorder({
        input: noWindowScript,
        output: join(work(), "b.zip"),
      }),
      /window-script\.js is not a web-accessible resource/,
    );
    assert.equal(notA5xClient(FAKE_CLIENT), undefined);
  });
});
