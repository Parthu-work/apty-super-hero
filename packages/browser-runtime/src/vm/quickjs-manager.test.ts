import { describe, expect, it } from "vitest";
import { assertSupportedImports } from "./quickjs-manager";

describe("assertSupportedImports", () => {
  it("allows code with no imports, or only built-in ones", () => {
    expect(() => assertSupportedImports("const x = 1;")).not.toThrow();
    expect(() =>
      assertSupportedImports('import fs from "fs";\nfs.readFileSync("a");'),
    ).not.toThrow();
  });

  it("refuses packages a skill would have to fetch from the network", () => {
    expect(() =>
      assertSupportedImports('import _ from "lodash@4.17.21";'),
    ).toThrow(/Bundle these into the script instead: lodash@4\.17\.21/);
    expect(() =>
      assertSupportedImports('const m = await import("https://esm.sh/x");'),
    ).toThrow(/https:\/\/esm\.sh\/x/);
  });

  it("allows the third-party modules that ship bundled with the extension", () => {
    expect(() =>
      assertSupportedImports('import { zipSync } from "fflate";'),
    ).not.toThrow();
  });

  it("lists every unsupported import at once", () => {
    expect(() =>
      assertSupportedImports(
        'import a from "a@1.0.0";\nimport { b } from "./b.js";\nimport fs from "fs";',
      ),
    ).toThrow(/a@1\.0\.0, \.\/b\.js$/);
  });
});
