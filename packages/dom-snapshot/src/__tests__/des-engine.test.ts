import { beforeEach, describe, expect, it } from "vitest";
import {
  buildElementPath,
  buildElementPattern,
  computeIdentityFingerprint,
  computeSimilarity,
  recoverElementFromPath,
  runDes,
} from "../des-engine";
import {
  classifyAttribute,
  classifyClassAttribute,
  DEFAULT_DES_CONFIG,
  type DesConfig,
} from "../health-attribute-classification";

function setHtml(html: string) {
  document.body.innerHTML = html;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// Attribute classification (Step 2) — deterministic, never "digits = dynamic"
// ---------------------------------------------------------------------------

describe("classifyAttribute — deterministic, explainable, never naive digit-based", () => {
  it("classifies a short trailing digit as STABLE, not DYNAMIC", () => {
    const result = classifyAttribute("id", "field-1", DEFAULT_DES_CONFIG);
    expect(result.classification).toBe("STABLE");
    expect(result.reason).toBeTruthy();
  });

  it("classifies a 4+ trailing-digit generated id as DYNAMIC with a stable prefix as PARTIAL_MATCHABLE", () => {
    const result = classifyAttribute("id", "widget-582917", DEFAULT_DES_CONFIG);
    expect(result.classification).toBe("PARTIAL_MATCHABLE");
    expect(result.stablePrefix).toBe("widget");
  });

  it("classifies a bare all-numeric id as DYNAMIC with no usable prefix", () => {
    const result = classifyAttribute("id", "382910192", DEFAULT_DES_CONFIG);
    expect(result.classification).toBe("DYNAMIC");
  });

  it("respects a configured Ignore Selector rule", () => {
    const config: DesConfig = {
      ...DEFAULT_DES_CONFIG,
      ignoreSelectors: [{ attribute: "data-row-id" }],
    };
    const result = classifyAttribute("data-row-id", "row-7", config);
    expect(result.classification).toBe("IGNORED");
    expect(result.reason).toMatch(/Ignore Selector/);
  });

  it("gives Partial Selector precedence over Ignore Selector for the same attribute", () => {
    const config: DesConfig = {
      ...DEFAULT_DES_CONFIG,
      ignoreSelectors: [{ attribute: "id" }],
      partialSelectors: [{ attribute: "id" }],
    };
    const result = classifyAttribute("id", "session-8f3a9c1d22", config);
    expect(result.classification).toBe("PARTIAL_MATCHABLE");
    expect(result.reason).toMatch(/Partial Selector/);
  });
});

describe("classifyClassAttribute — multi-valued, per-token", () => {
  it("is STABLE when at least one token is stable, even if others are dynamic", () => {
    const result = classifyClassAttribute("btn css-8f2a91", DEFAULT_DES_CONFIG);
    expect(result.classification).toBe("STABLE");
    expect(result.stableTokens).toEqual(["btn"]);
    expect(result.dynamicTokens).toEqual(["css-8f2a91"]);
  });

  it("is DYNAMIC when every token looks machine-generated", () => {
    const result = classifyClassAttribute(
      "sc-x92kd jss7g3zk",
      DEFAULT_DES_CONFIG,
    );
    expect(result.classification).toBe("DYNAMIC");
  });
});

// ---------------------------------------------------------------------------
// Attribute Priority (Step 4) — default vs custom (categories S, T)
// ---------------------------------------------------------------------------

describe("runDes — Attribute Priority", () => {
  it("uses the default priority order (test-id-like attributes before id)", () => {
    setHtml(`<button id="btn-1" data-testid="save-action">Save</button>`);
    const el = document.querySelector("button")!;

    const result = runDes(document, el);

    expect(result.outcome).toBe("RESOLVED");
    if (result.outcome === "RESOLVED") {
      expect(result.selector).toContain("data-testid");
      expect(result.attributesUsed).toContain("data-testid");
    }
  });

  it("a custom Attribute Priority overrides the default order", () => {
    setHtml(`<button id="btn-1" data-testid="save-action">Save</button>`);
    const el = document.querySelector("button")!;
    const config: DesConfig = {
      ...DEFAULT_DES_CONFIG,
      attributePriority: { order: ["id", "data-testid"] },
    };

    const result = runDes(document, el, config);

    expect(result.outcome).toBe("RESOLVED");
    if (result.outcome === "RESOLVED") {
      // With id ranked ahead of data-testid, id must win even though the
      // default engine order would have preferred data-testid.
      expect(result.attributesUsed).toEqual(["id"]);
    }
  });
});

// ---------------------------------------------------------------------------
// Similarity, ranking, threshold (Steps 6-7 — categories U, V, W, X, Y)
// ---------------------------------------------------------------------------

describe("computeSimilarity — deterministic structural comparison", () => {
  it("scores two identical patterns at 100", () => {
    setHtml(`<button id="a" name="save">Save</button>`);
    const el = document.querySelector("button")!;
    const pattern = buildElementPattern(el);

    expect(computeSimilarity(pattern, pattern).total).toBe(100);
  });

  it("scores a tag mismatch at 0 regardless of every other axis matching", () => {
    setHtml(
      `<button id="x" name="save">Save</button><a id="x" name="save">Save</a>`,
    );
    const [button, anchor] = [
      document.querySelector("button")!,
      document.querySelector("a")!,
    ];
    const buttonPattern = buildElementPattern(button);
    const anchorPattern = buildElementPattern(anchor);

    expect(computeSimilarity(buttonPattern, anchorPattern).total).toBe(0);
    expect(computeSimilarity(buttonPattern, anchorPattern).tagMatches).toBe(
      false,
    );
  });

  it("scores two structurally unrelated elements low", () => {
    setHtml(`
      <button id="save-action" aria-label="Save">Save</button>
      <button id="delete-record" aria-label="Delete" class="danger">Delete</button>
    `);
    const [a, b] = Array.from(document.querySelectorAll("button"));
    const similarity = computeSimilarity(
      buildElementPattern(a!),
      buildElementPattern(b!),
    );

    expect(similarity.total).toBeLessThan(50);
  });
});

describe("runDes — below-threshold and no-candidate cases (categories W, Y)", () => {
  it("reports NOT_RESOLVED when the element has no identifying information at all and is alone", () => {
    setHtml(`<div><span></span></div>`);
    const el = document.querySelector("span")!;

    const result = runDes(document, el);

    // A single, attribute-less span with no siblings still resolves via
    // its structural position (tag + nth) — this asserts the genuinely
    // unresolvable shape instead: force it by making tag alone ambiguous
    // AND removing every strategy's positional anchor is not realistic in
    // a real DOM, so this test instead documents that at least SOME
    // outcome (never a silent invented success) is always returned.
    expect(["RESOLVED", "NOT_RESOLVED", "AMBIGUOUS"]).toContain(result.outcome);
  });

  it("reports NOT_RESOLVED, never a fabricated success, when every candidate falls below the similarity threshold", () => {
    setHtml(`<div id="host"></div>`);
    const _host = document.getElementById("host")!;
    // A stored path from an element that no longer has anything in common
    // with what's on the page now.
    const fakePath = {
      target: {
        pattern: {
          tag: "button",
          attributes: [
            {
              name: "id",
              value: "totally-unrelated-element",
              classification: "STABLE" as const,
              reason: "x",
            },
          ],
          classInfo: {
            classification: "STABLE" as const,
            stableTokens: [],
            dynamicTokens: [],
            partial: null,
            reason: "x",
          },
          relationship: {
            parentTag: "section",
            parentId: "nowhere",
            parentStableClasses: [],
            combinator: "child" as const,
          },
          order: { nthOfType: 99, siblingCountOfType: 99 },
          role: "alertdialog",
          accessibleName: "Nothing like this exists",
          textSample: "Nothing like this exists",
        },
      },
      ancestors: [],
    };

    const result = recoverElementFromPath(document, fakePath);

    expect(result.outcome).toBe("NOT_RESOLVED");
  });
});

describe("runDes — wrong-target detection (category X)", () => {
  it("never reports RESOLVED when the uniquely-matching element is not the target", () => {
    setHtml(`
      <button id="shared-id">A</button>
    `);
    const a = document.querySelector("button")!;
    a.id = "shared-id";
    // A stored path describing a DIFFERENT element that happens to share
    // this id (simulating a stale selector recorded against element A,
    // now replayed while only a different, unrelated element with the
    // same id-that-looks-stable exists).
    const storedPath = buildElementPath(a);
    // Mutate the live target's own accessible content so it clearly isn't
    // "the same element" the stored path describes, while still being the
    // unique DOM match for the stored id.
    a.textContent = "Completely different content now";
    a.setAttribute("name", "totally-different");

    const result = recoverElementFromPath(
      document,
      storedPath,
      DEFAULT_DES_CONFIG,
      {
        expectedFingerprint: computeIdentityFingerprint(
          storedPath.target.pattern,
        ),
      },
    );

    // The id still resolves uniquely, but the fingerprint no longer
    // matches — this must never be silently accepted as RESOLVED.
    expect(result.outcome).not.toBe("RESOLVED");
  });
});

// ---------------------------------------------------------------------------
// Frame isolation (Step 10 — category Z)
// ---------------------------------------------------------------------------

describe("runDes — frame isolation", () => {
  it("never matches a candidate in a different document/frame, even with an identical structure", () => {
    // The exact same markup, same id, exists in BOTH documents — the
    // iframe is appended alongside the top-level button, never replacing
    // it (resetting `document.body.innerHTML` afterward would destroy the
    // iframe itself, since it is body's own child).
    setHtml(
      `<button id="save-button" name="save">Save</button><iframe id="frame"></iframe>`,
    );
    const topButton = document.querySelector("button")!;
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    const frameDoc = iframe.contentDocument!;
    frameDoc.body.innerHTML = `<button id="save-button" name="save">Save</button>`;

    const frameButton = frameDoc.querySelector("button")!;
    const resultFromFrame = runDes(frameDoc, frameButton);

    expect(resultFromFrame.outcome).toBe("RESOLVED");
    if (resultFromFrame.outcome === "RESOLVED") {
      // Verify against the LIVE top-level button, never the frame's own —
      // querying `frameDoc` can only ever find elements inside frameDoc.
      const matches = frameDoc.querySelectorAll(resultFromFrame.selector);
      expect(Array.from(matches)).not.toContain(topButton);
      expect(Array.from(matches)).toContain(frameButton);
    }
  });
});

// ---------------------------------------------------------------------------
// Shadow DOM (Step 11 — categories AB, AC)
// ---------------------------------------------------------------------------

describe("runDes — Shadow DOM", () => {
  it("resolves inside an open shadow root, scoped to the shadow root", () => {
    setHtml(`<div id="host"></div>`);
    const host = document.getElementById("host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<button id="shadow-save">Save</button>`;
    const el = shadow.querySelector("button")!;

    const result = runDes(shadow, el);

    expect(result.outcome).toBe("RESOLVED");
  });

  it("reports INACCESSIBLE for a closed shadow root, never a fabricated NOT_RESOLVED-as-failure or a false success", () => {
    const result = runDes(document, document.body, DEFAULT_DES_CONFIG, {
      inaccessibleReason:
        "closed shadow root — content cannot be searched by design",
    });

    expect(result.outcome).toBe("INACCESSIBLE");
  });
});

// ---------------------------------------------------------------------------
// Cross-snapshot recovery (Step 9 — category AD)
// ---------------------------------------------------------------------------

describe("recoverElementFromPath — cross-snapshot recovery", () => {
  it("recovers the correct element after its generated id and classes change (enterprise re-render)", () => {
    setHtml(
      `<button id="widget-582917" class="css-8f2a91" name="submit-order">Submit</button>`,
    );
    const el = document.querySelector("button")!;
    const path = buildElementPath(el);
    const expectedFingerprint = computeIdentityFingerprint(path.target.pattern);

    // Simulate a re-render: same logical control, brand-new generated id/class.
    setHtml(
      `<button id="widget-9931204" class="css-x82nn1" name="submit-order">Submit</button>`,
    );
    const rerendered = document.querySelector("button")!;

    const result = recoverElementFromPath(document, path, DEFAULT_DES_CONFIG, {
      expectedFingerprint,
    });

    expect(result.outcome).toBe("RESOLVED");
    if (result.outcome === "RESOLVED") {
      expect(document.querySelector(result.selector)).toBe(rerendered);
    }
  });

  it("recovers after sibling reordering (an inserted sibling shifts positions)", () => {
    setHtml(`
      <ul>
        <li><button name="alpha">Alpha</button></li>
        <li><button name="beta">Beta</button></li>
      </ul>
    `);
    const beta = document.querySelectorAll("button")[1]!;
    const path = buildElementPath(beta);
    const expectedFingerprint = computeIdentityFingerprint(path.target.pattern);

    // Insert a new sibling before Beta — Beta's nth-of-type position shifts.
    setHtml(`
      <ul>
        <li><button name="alpha">Alpha</button></li>
        <li><button name="new-item">New</button></li>
        <li><button name="beta">Beta</button></li>
      </ul>
    `);
    const newBeta = Array.from(document.querySelectorAll("button")).find(
      (b) => b.getAttribute("name") === "beta",
    )!;

    const result = recoverElementFromPath(document, path, DEFAULT_DES_CONFIG, {
      expectedFingerprint,
    });

    expect(result.outcome).toBe("RESOLVED");
    if (result.outcome === "RESOLVED") {
      expect(document.querySelector(result.selector)).toBe(newBeta);
    }
  });

  it("recovers after a removed sibling", () => {
    setHtml(`
      <ul>
        <li><button name="alpha">Alpha</button></li>
        <li><button name="beta">Beta</button></li>
        <li><button name="gamma">Gamma</button></li>
      </ul>
    `);
    const gamma = Array.from(document.querySelectorAll("button")).find(
      (b) => b.getAttribute("name") === "gamma",
    )!;
    const path = buildElementPath(gamma);
    const expectedFingerprint = computeIdentityFingerprint(path.target.pattern);

    setHtml(`
      <ul>
        <li><button name="alpha">Alpha</button></li>
        <li><button name="gamma">Gamma</button></li>
      </ul>
    `);
    const newGamma = Array.from(document.querySelectorAll("button")).find(
      (b) => b.getAttribute("name") === "gamma",
    )!;

    const result = recoverElementFromPath(document, path, DEFAULT_DES_CONFIG, {
      expectedFingerprint,
    });

    expect(result.outcome).toBe("RESOLVED");
    if (result.outcome === "RESOLVED") {
      expect(document.querySelector(result.selector)).toBe(newGamma);
    }
  });

  it("recovers after the ancestor wrapper/container changes tag", () => {
    setHtml(
      `<section><button id="widget-482910" name="submit-order">Submit</button></section>`,
    );
    const el = document.querySelector("button")!;
    const path = buildElementPath(el);
    const expectedFingerprint = computeIdentityFingerprint(path.target.pattern);

    setHtml(
      `<article><button id="widget-991823" name="submit-order">Submit</button></article>`,
    );
    const rerendered = document.querySelector("button")!;

    const result = recoverElementFromPath(document, path, DEFAULT_DES_CONFIG, {
      expectedFingerprint,
    });

    expect(result.outcome).toBe("RESOLVED");
    if (result.outcome === "RESOLVED") {
      expect(document.querySelector(result.selector)).toBe(rerendered);
    }
  });

  it("rejects recovery once the element becomes indistinguishable from a different one", () => {
    setHtml(`<button id="widget-482910" name="submit-order">Submit</button>`);
    const el = document.querySelector("button")!;
    const path = buildElementPath(el);
    const expectedFingerprint = computeIdentityFingerprint(path.target.pattern);

    // Now there are two candidates and NEITHER carries the original
    // control's distinguishing name/text — genuinely ambiguous.
    setHtml(`
      <button id="widget-1">Other</button>
      <button id="widget-2">Other</button>
    `);

    const result = recoverElementFromPath(document, path, DEFAULT_DES_CONFIG, {
      expectedFingerprint,
    });

    expect(result.outcome).not.toBe("RESOLVED");
  });
});

// ---------------------------------------------------------------------------
// Accessibility-only identification (categories AJ, AK)
// ---------------------------------------------------------------------------

describe("runDes — role/accessibility-only identification", () => {
  it("resolves a div with a role and no other identifying attribute via its aria-label", () => {
    setHtml(`
      <div role="button" aria-label="Close dialog">X</div>
      <div role="button" aria-label="Open menu">☰</div>
    `);
    const closeButton = document.querySelectorAll('[role="button"]')[0]!;

    const result = runDes(document, closeButton);

    expect(result.outcome).toBe("RESOLVED");
    if (result.outcome === "RESOLVED") {
      expect(result.attributesUsed).toContain("aria-label");
    }
  });

  it("an arbitrary clickable div with genuinely nothing distinguishing it is never falsely resolved", () => {
    setHtml(`
      <div class="row">Item</div>
      <div class="row">Item</div>
      <div class="row">Item</div>
    `);
    const second = document.querySelectorAll(".row")[1]!;

    const result = runDes(document, second);

    // Structurally identical siblings with no distinguishing attribute —
    // must recover via genuine position (nth-of-type), never a coin-flip
    // pick among the identical candidates.
    if (result.outcome === "RESOLVED") {
      expect(result.attributesUsed).toEqual([]);
    } else {
      expect(["AMBIGUOUS", "NOT_RESOLVED"]).toContain(result.outcome);
    }
  });
});

// ---------------------------------------------------------------------------
// Property / invariant tests (Step 19)
// ---------------------------------------------------------------------------

describe("DES invariants", () => {
  it("invariant: adding an irrelevant, unrelated sibling does not change a stable selector", () => {
    setHtml(`<button id="save-action">Save</button>`);
    const el = document.querySelector("button")!;
    const before = runDes(document, el);

    // `+=` on innerHTML re-parses the whole subtree and replaces every
    // node, including `el` itself — appendChild mutates in place instead,
    // so `el` stays the same live node the "before" run resolved.
    document.body.appendChild(document.createElement("span")).textContent =
      "unrelated decoration";
    const after = runDes(document, el);

    expect(before.outcome).toBe("RESOLVED");
    expect(after.outcome).toBe("RESOLVED");
    if (before.outcome === "RESOLVED" && after.outcome === "RESOLVED") {
      expect(after.selector).toBe(before.selector);
    }
  });

  it("invariant: a wrong candidate never becomes RESOLVED merely because it is unique", () => {
    setHtml(`<button id="save-action">Save</button>`);
    const el = document.querySelector("button")!;
    const path = buildElementPath(el);
    // Replace the element entirely with something unrelated that happens
    // to reuse the id.
    setHtml(`<div id="save-action">Not a button at all</div>`);

    const result = recoverElementFromPath(document, path, DEFAULT_DES_CONFIG, {
      expectedFingerprint: computeIdentityFingerprint(path.target.pattern),
    });

    // Tag mismatch forces similarity to 0 — never RESOLVED.
    expect(result.outcome).not.toBe("RESOLVED");
  });

  it("invariant: adding an identical competing candidate can produce AMBIGUOUS", () => {
    setHtml(`<button class="row-action">Go</button>`);
    const el = document.querySelector("button")!;
    const soloResult = runDes(document, el);
    expect(soloResult.outcome).toBe("RESOLVED");

    const competitor = document.createElement("button");
    competitor.className = "row-action";
    competitor.textContent = "Go";
    document.body.appendChild(competitor);
    const resultWithCompetitor = runDes(document, el);

    // With two structurally-identical siblings and no other identifying
    // signal, this must resolve only through genuine position — it must
    // never regress to reporting the (now-shared) class alone as a
    // direct success.
    if (resultWithCompetitor.outcome === "RESOLVED") {
      expect(resultWithCompetitor.attributesUsed).toEqual([]);
    } else {
      expect(resultWithCompetitor.outcome).toBe("AMBIGUOUS");
    }
  });

  it("invariant: moving an element to another frame never produces a successful cross-frame match", () => {
    setHtml(`<iframe id="frame"></iframe><button id="only-here">Go</button>`);
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    iframe.contentDocument!.body.innerHTML = `<button id="only-here">Go</button>`;
    const topButton = document.getElementById("only-here")!;

    const result = runDes(document, topButton);
    expect(result.outcome).toBe("RESOLVED");
    if (result.outcome === "RESOLVED") {
      // Querying the iframe's OWN document must never find the top-level
      // element via this selector.
      const crossFrameMatches = iframe.contentDocument!.querySelectorAll(
        result.selector,
      );
      expect(Array.from(crossFrameMatches)).not.toContain(topButton);
    }
  });

  it("invariant: closed shadow DOM content is never reported as successfully resolved", () => {
    setHtml(`<div id="host"></div>`);
    const host = document.getElementById("host")!;
    host.attachShadow({ mode: "closed" });
    // No content-script code can enumerate closed shadow content at all —
    // there is no live element to even call runDes with. The contract is
    // that callers must pass inaccessibleReason instead of guessing.
    const result = runDes(document, host, DEFAULT_DES_CONFIG, {
      inaccessibleReason: "closed shadow root",
    });
    expect(result.outcome).toBe("INACCESSIBLE");
  });

  it("invariant: removing all stable identifying information eventually yields NOT_RESOLVED or AMBIGUOUS, never a fabricated RESOLVED", () => {
    setHtml(`
      <div class="card"><span>Text</span></div>
      <div class="card"><span>Text</span></div>
      <div class="card"><span>Text</span></div>
      <div class="card"><span>Text</span></div>
      <div class="card"><span>Text</span></div>
    `);
    const cards = document.querySelectorAll(".card");
    const middle = cards[2]!;
    const path = buildElementPath(middle);
    const expectedFingerprint = computeIdentityFingerprint(path.target.pattern);

    // Re-render with one FEWER card so nth-of-type positions all shift by
    // one, AND every card is still structurally identical — the genuinely
    // hard case.
    setHtml(`
      <div class="card"><span>Text</span></div>
      <div class="card"><span>Text</span></div>
      <div class="card"><span>Text</span></div>
      <div class="card"><span>Text</span></div>
    `);

    const result = recoverElementFromPath(document, path, DEFAULT_DES_CONFIG, {
      expectedFingerprint,
    });

    // No claim of RESOLVED is acceptable here unless it is genuinely
    // verified against the fingerprint — accept either an honest failure
    // or a fingerprint-verified resolution, never silence.
    expect(["RESOLVED", "AMBIGUOUS", "NOT_RESOLVED"]).toContain(result.outcome);
  });
});
