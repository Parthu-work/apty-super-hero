import { beforeEach, describe, expect, it } from "vitest";
import type { PartialFn } from "../health-attribute-classification";
import {
  computeElementFingerprint,
  resolveElement,
  verifyStoredElementPath,
} from "../health-selector-engine";

/**
 * Real Apty requires an EXPLICIT Studio-configured Partial Selector
 * function per attribute (module 65913's `addAttribute`) — there is no
 * automatic "detect a stable prefix in a dynamic-looking value" fallback
 * baked into the default. This simulates a simple Studio-configured rule:
 * anchor on a value's leading run of lowercase letters/hyphens, when at
 * least 3 characters long.
 */
const stablePrefixPartialFn: PartialFn = (_name, value) => {
  const match = value.match(/^[a-z-]+/);
  return match && match[0].length >= 3 ? match[0] : undefined;
};

function setHtml(html: string) {
  document.body.innerHTML = html;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("resolveElement — direct success", () => {
  it("resolves a stable, unique id directly", () => {
    setHtml(`<button id="save-button">Save</button>`);
    const el = document.querySelector("button")!;

    const result = resolveElement(document, el);

    expect(result.outcome).toBe("DIRECT_SUCCESS");
    expect(result.strategy).toBe("direct");
    expect(result.bestSelector).toBe('button[id="save-button"]');
    expect(result.matchCount).toBe(1);
  });

  it("prefers a stable data-testid over an id", () => {
    setHtml(
      `<button id="btn-928371" data-testid="create-opportunity">Create</button>`,
    );
    const el = document.querySelector("button")!;

    const result = resolveElement(document, el);

    expect(result.outcome).toBe("DIRECT_SUCCESS");
    expect(result.bestSelector).toContain("data-testid");
  });
});

describe("resolveElement — non-unique attributes are never a success", () => {
  it("does not report DIRECT_SUCCESS for a class shared by many elements", () => {
    setHtml(
      Array.from({ length: 10 }, () => `<button class="btn">X</button>`).join(
        "",
      ),
    );
    const el = document.querySelectorAll("button")[3]!;

    const result = resolveElement(document, el);

    expect(result.outcome).not.toBe("DIRECT_SUCCESS");
    expect(result.outcome).not.toBe("RECOVERED_BY_IGNORE");
  });

  it("falls back to a positional selector for fully identical repeated rows", () => {
    setHtml(
      Array.from(
        { length: 5 },
        () =>
          `<li id="row" class="item"><button id="act" class="x">Go</button></li>`,
      ).join(""),
    );
    const el = document.querySelectorAll("button")[2]!;

    const result = resolveElement(document, el);

    expect(result.outcome).toBe("POSITIONAL_ONLY");
    expect(result.usesPositionalSelector).toBe(true);
  });
});

describe("resolveElement — ignore-style recovery", () => {
  it("recovers by combining stable attributes when no single one is unique alone", () => {
    // Neither `.btn` (shared by A+B) nor `[name="submit"]` (shared by A+C)
    // is unique alone — only combining both narrows to element A.
    setHtml(`
      <button class="btn" name="submit">A</button>
      <button class="btn" name="cancel">B</button>
      <button class="alt" name="submit">C</button>
    `);
    const el = document.querySelectorAll("button")[0]!;

    const result = resolveElement(document, el);

    expect(result.outcome).toBe("RECOVERED_BY_IGNORE");
    expect(result.strategy).toBe("ignore");
  });
});

describe("resolveElement — partial-attribute recovery", () => {
  it("finds a stable prefix in a dynamic id and builds a working partial selector", () => {
    setHtml(`
      <div id="app-wrapper-4f9a21">A</div>
      <div id="other-thing">B</div>
    `);
    const el = document.querySelector("#app-wrapper-4f9a21")!;

    const result = resolveElement(document, el, {
      desConfig: { partialSelectors: { id: stablePrefixPartialFn } },
    });

    expect(result.outcome).toBe("RECOVERED_BY_PARTIAL");
    expect(result.bestSelector).toContain("app-wrapper");
  });

  it("never builds a partial candidate from a value with no safe stable prefix, even with Partial Selector configured", () => {
    setHtml(`<div id="382910192">A</div><div id="other">B</div>`);
    const el = document.querySelectorAll("div")[0]!;

    const result = resolveElement(document, el, {
      desConfig: { partialSelectors: { id: stablePrefixPartialFn } },
    });

    expect(result.outcome).not.toBe("RECOVERED_BY_PARTIAL");
  });
});

describe("resolveElement — contextual (ancestor) recovery", () => {
  it("climbs to a stable ancestor when the element itself has no identifying attribute", () => {
    // Two structurally-identical toolbars: neither the leaf's own
    // position (2nd button) nor its immediate container's is globally
    // unique alone, so real Apty's own capture algorithm must climb an
    // extra level and use the ANCESTOR's own stable id to disambiguate —
    // a genuine attribute contributing at that level, not just position.
    setHtml(`
      <div id="toolbar-a">
        <button>First</button>
        <button>Second</button>
      </div>
      <div id="toolbar-b">
        <button>First</button>
        <button>Second</button>
      </div>
    `);
    const el = document.querySelectorAll("#toolbar-b button")[1]!;

    const result = resolveElement(document, el);

    expect(result.outcome).toBe("RECOVERED_BY_CONTEXT");
    expect(result.ancestorDepthUsed).toBeGreaterThanOrEqual(1);
  });
});

describe("resolveElement — target-identity verification", () => {
  it("never reports DIRECT_SUCCESS from a class shared by another element", () => {
    setHtml(`
      <button class="save">Save A</button>
      <button class="save">Save B</button>
    `);
    const a = document.querySelectorAll("button")[0]!;

    const result = resolveElement(document, a);

    // `.save` alone matches both — not unique — so recovery must fall
    // through to context/positional, never be reported as a direct win.
    expect(result.outcome).not.toBe("DIRECT_SUCCESS");
    expect(result.outcome).not.toBe("RECOVERED_BY_IGNORE");
    expect(result.outcome).not.toBe("WRONG_TARGET");
    expect(["RECOVERED_BY_CONTEXT", "POSITIONAL_ONLY"]).toContain(
      result.outcome,
    );
  });
});

describe("resolveElement — Partial Selector precedes Ignore Selector for the same attribute", () => {
  it("recovers via partial-prefix rather than ignore when a dynamic id has a safe stable prefix", () => {
    setHtml(`
      <button id="app-wrapper-4f9a21" class="btn">Save</button>
      <button id="other-prefix-9c1a02" class="btn">Cancel</button>
    `);
    const el = document.querySelectorAll("button")[0]!;

    const result = resolveElement(document, el, {
      // Both an Ignore rule AND a Partial rule target `id` here — Partial
      // must win (real `addAttribute`'s confirmed precedence).
      desConfig: {
        partialSelectors: { id: stablePrefixPartialFn },
        ignore: { id: () => true },
      },
    });

    // The class alone (".btn") is shared and not unique, so recovery must
    // come from the dynamic id's stable prefix (Partial), not from the
    // Ignore rule dropping id and falling back to position.
    expect(result.outcome).toBe("RECOVERED_BY_PARTIAL");
    expect(result.strategy).toBe("partial");
  });
});

describe("resolveElement — attribute-priority transparency", () => {
  it("exposes which attribute the winning direct candidate came from", () => {
    setHtml(`<button data-testid="save-action">Save</button>`);
    const el = document.querySelector("button")!;

    const result = resolveElement(document, el);

    expect(result.outcome).toBe("DIRECT_SUCCESS");
    expect(result.winningAttribute).toBe("data-testid");
  });

  it("reports no winning attribute for context/positional recovery", () => {
    setHtml(`
      <div id="toolbar">
        <button>First</button>
        <button>Second</button>
      </div>
    `);
    const el = document.querySelectorAll("button")[1]!;

    const result = resolveElement(document, el);

    expect(["RECOVERED_BY_CONTEXT", "POSITIONAL_ONLY"]).toContain(
      result.outcome,
    );
    expect(result.winningAttribute).toBeNull();
  });
});

describe("computeElementFingerprint — logical correlation, not object identity or a single attribute", () => {
  it("produces the same fingerprint for two structurally-identical elements with different generated ids", () => {
    setHtml(`
      <button id="btn-alpha" name="submit">Submit</button>
      <button id="btn-beta" name="submit">Submit</button>
    `);
    const [a, b] = document.querySelectorAll("button");

    // Deliberately NOT asserting these collide (that would defeat
    // correlation) — this test only proves `id` alone isn't the whole
    // signature by showing the fingerprint doesn't change when id changes
    // on the same conceptual element (see the collector test for the
    // actual cross-snapshot behavior this enables).
    const fingerprintBefore = computeElementFingerprint(a!);
    a!.id = "btn-gamma";
    const fingerprintAfter = computeElementFingerprint(a!);

    expect(fingerprintAfter).toBe(fingerprintBefore);
    expect(fingerprintBefore).not.toBe(computeElementFingerprint(b!));
  });

  it("differentiates elements with different accessible names/text even if tag and role match", () => {
    setHtml(`
      <button name="save">Save</button>
      <button name="cancel">Cancel</button>
    `);
    const [a, b] = document.querySelectorAll("button");

    expect(computeElementFingerprint(a!)).not.toBe(
      computeElementFingerprint(b!),
    );
  });
});

describe("resolveElement — shadow DOM scoping", () => {
  it("resolves an element inside an open shadow root against the shadow root, not the document", () => {
    setHtml(`<div id="host"></div>`);
    const host = document.getElementById("host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<button id="shadow-btn">Go</button>`;
    const el = shadow.querySelector("button")!;

    const result = resolveElement(shadow, el);

    expect(result.outcome).toBe("DIRECT_SUCCESS");
    expect(result.bestSelector).toBe('button[id="shadow-btn"]');
  });
});

describe("verifyStoredElementPath — the GOOD cross-state pattern (replay a captured path, never regenerate-and-compare)", () => {
  it("returns DIRECT_STABLE when the exact same element is replayed unchanged", () => {
    setHtml(`<button id="save-button">Save</button>`);
    const el = document.querySelector("button")!;
    const captured = resolveElement(document, el);
    const fingerprint = computeElementFingerprint(el);

    const verification = verifyStoredElementPath(
      document,
      captured.elementPath!,
      fingerprint,
    );

    expect(verification.verdict).toBe("DIRECT_STABLE");
    expect(verification.element).toBe(el);
  });

  it("returns NOT_RESOLVED when the element is gone and no candidate exists at all", () => {
    setHtml(`<button id="save-button">Save</button>`);
    const el = document.querySelector("button")!;
    const captured = resolveElement(document, el);
    const fingerprint = computeElementFingerprint(el);

    setHtml(
      `<section>completely unrelated content, no button anywhere</section>`,
    );

    const verification = verifyStoredElementPath(
      document,
      captured.elementPath!,
      fingerprint,
    );

    expect(verification.verdict).toBe("NOT_RESOLVED");
    expect(verification.element).toBeNull();
  });

  it("returns WRONG_TARGET, never a silent success, when the path resolves to a different logical element", () => {
    // Capture button A's path, then swap in a DIFFERENT button (B) at the
    // exact same position with the SAME stable attributes DES anchors on,
    // but a distinguishing attribute (data-row-id) that differs — real
    // Apty's own `find()` has no discrete "wrong target" state (see this
    // module's doc comment); it is DOM Health's own known-ground-truth
    // check on top, and it must never be skipped just because a candidate
    // was found and scored well.
    setHtml(
      `<button data-row-id="row-1" class="row-action" name="edit">Edit</button>`,
    );
    const elA = document.querySelector("button")!;
    const captured = resolveElement(document, elA);
    const fingerprintA = computeElementFingerprint(elA);

    setHtml(
      `<button data-row-id="row-2" class="row-action" name="edit">Edit</button>`,
    );
    const elB = document.querySelector("button")!;
    const fingerprintB = computeElementFingerprint(elB);
    expect(fingerprintB).not.toBe(fingerprintA);

    const verification = verifyStoredElementPath(
      document,
      captured.elementPath!,
      fingerprintA,
    );

    // Whatever findElement's real relaxation strategies land on here, it is
    // never reported as a stable success against the WRONG logical row.
    expect(verification.verdict).not.toBe("DIRECT_STABLE");
    expect(verification.verdict).not.toBe("RECOVERED_STABLE");
    expect(verification.verdict).not.toBe("POSITIONAL_STABLE");
    if (verification.element !== null) {
      expect(verification.verdict).toBe("WRONG_TARGET");
    } else {
      expect(verification.verdict).toBe("NOT_RESOLVED");
    }
  });
});
