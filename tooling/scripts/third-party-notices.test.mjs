import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  packagesFromPnpm,
  readLicenceText,
  renderNotices,
} from "./third-party-notices.mjs";

const report = {
  MIT: [
    {
      name: "zeta",
      versions: ["1.0.0", "2.0.0"],
      paths: ["/x/zeta@1", "/x/zeta@2"],
      license: "MIT",
      homepage: "https://zeta.example",
    },
  ],
  "Apache-2.0": [
    {
      name: "alpha",
      versions: ["3.1.0"],
      paths: ["/x/alpha"],
      license: "Apache-2.0",
    },
  ],
};

describe("third-party notices", () => {
  it("lists one entry per name and version, sorted, with its own path", () => {
    assert.deepEqual(
      packagesFromPnpm(report).map((e) => `${e.name}@${e.version} ${e.dir}`),
      ["alpha@3.1.0 /x/alpha", "zeta@1.0.0 /x/zeta@1", "zeta@2.0.0 /x/zeta@2"],
    );
  });

  it("includes each package's licence text, and says so when there is none", () => {
    const text = renderNotices(packagesFromPnpm(report), (dir) =>
      dir === "/x/alpha" ? "Apache licence text" : null,
    );

    assert.match(text, /alpha@3\.1\.0 \(Apache-2\.0\)\n\nApache licence text/);
    assert.match(
      text,
      /zeta@1\.0\.0 \(MIT\)\n\nThe package ships no licence file\. Licence: MIT; see https:\/\/zeta\.example\./,
    );
    assert.match(text, /^3 packages\.$/m);
    assert.doesNotMatch(text, /\/x\//);
  });

  it("reads LICENSE, LICENCE.md or COPYING, whichever the package has", () => {
    const dir = mkdtempSync(join(tmpdir(), "notices-"));
    try {
      assert.equal(readLicenceText(dir), null);
      writeFileSync(join(dir, "LICENCE.md"), "Licence\r\ntext\n");
      assert.equal(readLicenceText(dir), "Licence\ntext");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
