import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { bundleToFixture, overlayPlaceholder } from "./bundle-to-fixture.mjs";

const SCRIPT = fileURLToPath(
  new URL("./bundle-to-fixture.mjs", import.meta.url),
);

const BUNDLE = {
  schema: "apty-dom-health-validation/1",
  generatedAt: "2026-01-02T03:04:05.000Z",
  versions: { extension: "0.1.0", chrome: "130.0.0.0" },
  hosts: ["athena.tenant-a.com", "cdn.tenant-a.com"],
  thresholds: [],
  thresholdOverrides: { active: [], rejected: [] },
  page: {
    frames: [
      {
        frameId: 0,
        parentFrameId: -1,
        key: "top",
        keySource: "top",
        keyStable: true,
        role: "chrome",
        roleReason: "Navigation or status frame (top).",
        urlTemplate: "https://athena.tenant-a.com/globalframeset.esp",
        status: "captured",
      },
      {
        frameId: 3,
        parentFrameId: 0,
        key: "GlobalNav",
        keySource: "id",
        keyStable: true,
        role: "chrome",
        roleReason: "Navigation or status frame (GlobalNav).",
        urlTemplate: "https://athena.tenant-a.com/nav",
        status: "captured",
      },
      {
        frameId: 4,
        parentFrameId: 0,
        key: "GlobalWrapper",
        keySource: "id",
        keyStable: true,
        role: "application",
        roleReason: "Holds application content.",
        urlTemplate: "https://athena.tenant-a.com/chart/:id",
        status: "failed",
        error: "No answer",
      },
      {
        frameId: 5,
        parentFrameId: 4,
        key: null,
        keyHash: "abc",
        keySource: "title",
        keyStable: false,
        role: "shim",
        roleReason: "A javascript: stub document.",
        urlTemplate: "about:blank",
        status: "captured",
      },
    ],
    overlays: [
      {
        matcher: "id:_pendo-",
        owner: "Pendo",
        evidence: "measured",
        roots: 1,
        elementCount: 4,
      },
    ],
    coverage: { elementsAnalyzed: 2 },
    virtualized: {
      containers: 1,
      observedItems: 15,
      declaredTotal: 1000,
      signals: [],
    },
  },
  application: {
    coverage: {},
    states: null,
    traversal: { mode: "click-first" },
  },
  routeProbe: null,
};

const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("bundleToFixture", () => {
  const files = bundleToFixture(BUNDLE, "athena-tenant-a");
  const html = files["athena-tenant-a.html"];

  it("writes the frame tree keyed as the audit keyed it, with customer hosts replaced", () => {
    assert.match(
      html,
      /<iframe id="GlobalNav" src="https:\/\/host-1\.example\.test\/nav"><\/iframe>/,
    );
    assert.match(
      html,
      /<iframe id="GlobalWrapper" src="https:\/\/host-1\.example\.test\/chart\/:id"><\/iframe>/,
    );
    assert.match(html, /role application .*status failed: No answer/);
    assert.match(html, /holds 1 frame\(s\) of its own: title:abc \(shim\)/);
    assert.match(html, /<div id="_pendo-placeholder"><\/div>/);
    for (const content of Object.values(files)) {
      assert.doesNotMatch(content, /tenant-a\.com/);
    }
  });

  it("keeps the measured values and writes a todo for each check", () => {
    const values = JSON.parse(files["athena-tenant-a.values.json"]);
    assert.equal(values.frames.length, 4);
    assert.equal(
      values.frames[2].urlTemplate,
      "https://host-1.example.test/chart/:id",
    );
    assert.deepEqual(values.overlays, [
      { matcher: "id:_pendo-", evidence: "measured", elementCount: 4 },
    ]);

    const stub = files["../../athena-tenant-a.fixture.test.ts"];
    for (const todo of [
      "classifies GlobalWrapper as application",
      "reports why GlobalWrapper could not be read",
      "leaves out id:_pendo- as an overlay",
      "detects 1 virtualized list(s) (15 of 1000 rows rendered)",
      "chooses click-first traversal",
    ]) {
      assert.ok(stub.includes(`it.todo(${JSON.stringify(todo)})`), todo);
    }
  });

  it("refuses another schema and a name that is not kebab-case", () => {
    assert.throws(
      () => bundleToFixture({ schema: "x" }, "a"),
      /Expected a apty-dom-health-validation\/1 bundle/,
    );
    assert.throws(() => bundleToFixture(BUNDLE, "../evil"), /kebab-case/);
  });
});

describe("overlayPlaceholder", () => {
  it("makes an element each matcher kind would catch", () => {
    assert.equal(
      overlayPlaceholder("class:helpdesk-"),
      '<div class="helpdesk-placeholder"></div>',
    );
    assert.equal(
      overlayPlaceholder("tag:support-widget"),
      "<support-widget></support-widget>",
    );
    assert.match(overlayPlaceholder('tag:"><script>'), /^<!-- overlay/);
  });
});

describe("CLI", () => {
  it("writes the three files and refuses to overwrite them", () => {
    const dir = mkdtempSync(join(tmpdir(), "bundle-to-fixture-"));
    dirs.push(dir);
    const bundlePath = join(dir, "bundle.json");
    writeFileSync(bundlePath, JSON.stringify(BUNDLE));
    const out = join(dir, "fixtures", "erp");

    execFileSync("node", [SCRIPT, bundlePath, "athena-tenant-a", "--out", out]);
    assert.match(
      readFileSync(join(out, "athena-tenant-a.html"), "utf8"),
      /GlobalWrapper/,
    );
    assert.match(
      readFileSync(join(dir, "athena-tenant-a.fixture.test.ts"), "utf8"),
      /it\.todo/,
    );

    assert.throws(
      () =>
        execFileSync(
          "node",
          [SCRIPT, bundlePath, "athena-tenant-a", "--out", out],
          { stdio: "pipe" },
        ),
      /Refusing to overwrite/,
    );
  });
});
