import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  expectedFrom,
  harProblems,
  writeFixture,
} from "./dapty-bundle-to-fixture.mjs";

const bundle = {
  bundleVersion: "apty-dapty-evidence/1",
  generatedAt: "2026-11-03T00:00:00.000Z",
  versions: { agent: "0.1.0", commit: "abc1234", chrome: "130.0.0.0" },
  result: {
    packId: "dapty-conversation",
    gates: [
      {
        id: "chat-suggestions",
        status: "fail",
        reason: "suggestionsMissing",
        detail: "1 of 2 suggestion(s) are not published in this environment.",
      },
    ],
    verdict: {
      status: "cause_found",
      causes: [{ ruleId: "DAP-06", summary: "…" }],
    },
    dapty: {
      suggestions: [
        { name: "Export a report", type: "workflow", status: "launches" },
        { name: "Retired flow", status: "missing" },
      ],
    },
  },
  evidence: { answeredBy: "cdn", totalMs: 900 },
};

const har = {
  log: {
    entries: [
      {
        request: { url: "https://cdn.example.test/x", headers: [] },
        response: { status: 200, headers: [] },
      },
    ],
  },
};

const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A private temporary folder, removed after the tests. */
function work() {
  const dir = mkdtempSync(join(tmpdir(), "dapty-fixture-"));
  dirs.push(dir);
  return dir;
}

describe("dapty-bundle-to-fixture", () => {
  it("keeps the rule ids, gate statuses and suggestion rows the card showed", () => {
    assert.deepEqual(expectedFrom(bundle), {
      verdict: "cause_found",
      ruleIds: ["DAP-06"],
      gates: [
        {
          id: "chat-suggestions",
          status: "fail",
          reason: "suggestionsMissing",
        },
      ],
      suggestions: [
        { name: "Export a report", type: "workflow", status: "launches" },
        { name: "Retired flow", status: "missing" },
      ],
    });
  });

  it("writes expected.json, evidence.json and the HAR under the fixture's name", () => {
    const out = work();

    const dir = writeFixture({
      bundle,
      name: "cdn-retired-flow",
      har,
      outDir: out,
    });

    const read = (file) => JSON.parse(readFileSync(join(dir, file), "utf8"));
    assert.equal(read("expected.json").ruleIds[0], "DAP-06");
    assert.equal(read("evidence.json").evidence.answeredBy, "cdn");
    assert.deepEqual(read("capture.har.json"), har);
    assert.throws(
      () => writeFixture({ bundle, name: "cdn-retired-flow", outDir: out }),
      /already exists/,
    );
  });

  it("refuses a HAR that still holds an email, a cookie or an authorization header, and a bundle of another kind", () => {
    const leaky = structuredClone(har);
    leaky.log.entries[0].request.headers.push({ name: "Cookie", value: "s=1" });
    leaky.log.entries[0].response.content = { text: "jane.doe@example.com" };

    assert.deepEqual(harProblems(leaky), [
      "entry 0: request header Cookie",
      "an email address",
    ]);
    assert.throws(
      () =>
        writeFixture({
          bundle,
          name: "leaky",
          har: leaky,
          outDir: work(),
        }),
      /not redacted/,
    );
    assert.throws(
      () => expectedFrom({ bundleVersion: "apty-dom-health-validation/1" }),
      /Not an Ask Dapty evidence bundle/,
    );
  });
});
