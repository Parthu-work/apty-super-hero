import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("./check-dist-licences.mjs", import.meta.url),
);
const run = (dir) =>
  spawnSync(process.execPath, [script, dir], { encoding: "utf8" });

function distWith(files) {
  const dir = mkdtempSync(join(tmpdir(), "dist-licences-"));
  mkdirSync(join(dir, "assets"), { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const complete = {
  LICENSE: "MIT License\n\nCopyright (c) 2024 AIPex",
  "THIRD_PARTY_NOTICES.txt": "THIRD-PARTY SOFTWARE NOTICES\n\n1 packages.",
  "assets/Inter-OFL.txt": "SIL OPEN FONT LICENSE Version 1.1",
};

describe("check-dist-licences", () => {
  it("passes when the build ships the licence, the notices and the Inter OFL", () => {
    const dir = distWith(complete);
    try {
      const result = run(dir);
      assert.equal(result.status, 0, result.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const missing of Object.keys(complete)) {
    it(`fails and names ${missing} when it is missing`, () => {
      const files = { ...complete };
      delete files[missing];
      const dir = distWith(files);
      try {
        const result = run(dir);
        assert.equal(result.status, 1);
        assert.match(result.stderr, new RegExp(missing.replace(".", "\\.")));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it("fails when a file is there but empty", () => {
    const dir = distWith({ ...complete, LICENSE: "" });
    try {
      assert.equal(run(dir).status, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
