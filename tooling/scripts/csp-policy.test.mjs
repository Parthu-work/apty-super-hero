import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { extensionPageCspErrors } from "./csp-policy.mjs";

describe("extensionPageCspErrors", () => {
  it("accepts the shipped manifest's policy", () => {
    const manifest = JSON.parse(
      readFileSync(
        new URL("../../apps/browser-extension/manifest.json", import.meta.url),
        "utf8",
      ),
    );
    assert.deepEqual(
      extensionPageCspErrors(manifest.content_security_policy?.extension_pages),
      [],
    );
  });

  it("rejects a policy with no img-src", () => {
    const errors = extensionPageCspErrors(
      "script-src 'self'; object-src 'self'; media-src 'self'; frame-src 'none'",
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /no img-src/);
  });

  it("rejects remote origins and wildcards", () => {
    const errors = extensionPageCspErrors(
      "img-src 'self' https:; media-src *; frame-src https://a.test",
    );
    assert.deepEqual(
      errors.map((e) => e.split(" ")[2]),
      ["img-src", "media-src", "frame-src"],
    );
  });

  it("lets default-src cover a missing directive", () => {
    assert.deepEqual(
      extensionPageCspErrors("default-src 'self' data: blob:"),
      [],
    );
  });

  it("rejects a missing policy", () => {
    assert.equal(extensionPageCspErrors(undefined).length, 1);
  });
});
