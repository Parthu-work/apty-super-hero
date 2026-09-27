/**
 * Tests for the real-Apty-faithful DES engine (`des-engine.ts`). These
 * replace a prior test suite written against an earlier, invented engine
 * (Jaccard similarity, 5 named strategies, a 70/±5 threshold) built before
 * any real Apty source was available. That engine's behavior is gone, not
 * merely refactored — these tests assert the REAL algorithm's actual,
 * reverse-engineered behavior (see `des-engine.ts`'s module doc comment
 * and `docs/development/des-engine.md` for what was recovered and how).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildElementPath,
  buildElementPattern,
  checkContainersScore,
  diffScore,
  elementMatches,
  findElement,
  generateMinimalSelector,
  getContainerSelectors,
  pathToSelector,
  patternDiffScore,
  patternToSelector,
} from "../des-engine";
import {
  DEFAULT_DES_CONFIG,
  DEFAULT_IGNORE,
  DEFAULT_PRIORITY,
  type DesConfig,
  isValueDynamic,
  resolveAttributeOrder,
} from "../health-attribute-classification";

function setHtml(html: string) {
  document.body.innerHTML = html;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// Real default ignore/priority (health-attribute-classification.ts) —
// reconstructed from workflowPreview.js module 92317's `defaultIgnore`/
// `initOptions`, not the previous session's invented `looksDynamic`-style
// classifier.
// ---------------------------------------------------------------------------

describe("DEFAULT_IGNORE — the real Apty default (module 92317), not a general 'looks dynamic' classifier", () => {
  it("ignores id/for only when the value contains 2+ consecutive digits", () => {
    expect(DEFAULT_IGNORE.attribute("id", "field-1")).toBe(false);
    expect(DEFAULT_IGNORE.attribute("id", "widget-58")).toBe(true);
    expect(DEFAULT_IGNORE.attribute("for", "input-12")).toBe(true);
  });

  it("does NOT ignore an arbitrary data-* attribute merely for containing digits", () => {
    // The real default has no general dynamic-value heuristic for
    // non-id/for attributes at all — only the runtime recovery heuristic
    // (`isValueDynamic`, tested below) treats this as "looks generated",
    // and only when the literal captured selector has already failed.
    expect(DEFAULT_IGNORE.attribute("data-row-id", "582917")).toBe(false);
  });

  it("blocklists a small set of framework/internal attribute names regardless of value", () => {
    expect(DEFAULT_IGNORE.attribute("style", "color: red")).toBe(true);
    expect(DEFAULT_IGNORE.attribute("tabindex", "0")).toBe(true);
    expect(DEFAULT_IGNORE.attribute("data-reactid", "abc")).toBe(true);
  });

  it("blocklists attribute names containing 'lnid' or 'apty', or prefixed 'xmlns:'", () => {
    expect(DEFAULT_IGNORE.attribute("data-lnid", "x")).toBe(true);
    expect(DEFAULT_IGNORE.attribute("apty-widget-id", "x")).toBe(true);
    expect(DEFAULT_IGNORE.attribute("xmlns:foo", "x")).toBe(true);
  });

  it("ignores classes only when literally prefixed 'tether', never for merely looking generated", () => {
    expect(DEFAULT_IGNORE.class("tether-element")).toBe(true);
    expect(DEFAULT_IGNORE.class("sc-bdVaJa")).toBe(false);
  });
});

describe("DEFAULT_PRIORITY / resolveAttributeOrder — the real default is [id, class, href, src], no data-testid preference", () => {
  it("matches the real default order exactly", () => {
    expect(DEFAULT_PRIORITY).toEqual(["id", "class", "href", "src"]);
  });

  it("orders present attributes by priority, non-priority attributes after in original order", () => {
    const order = resolveAttributeOrder(
      ["data-testid", "class", "id", "role"],
      DEFAULT_DES_CONFIG,
    );
    expect(order).toEqual(["id", "class", "data-testid", "role"]);
  });

  it("puts partialSelectorAttributes ahead of everything else, including id", () => {
    const config: DesConfig = {
      ...DEFAULT_DES_CONFIG,
      partialSelectorAttributes: ["data-testid"],
    };
    const order = resolveAttributeOrder(["id", "data-testid", "class"], config);
    expect(order[0]).toBe("data-testid");
  });
});

describe("isValueDynamic — the real RUNTIME recovery heuristic (module 81948), distinct from DEFAULT_IGNORE", () => {
  it("treats a bare all-digit value as dynamic", () => {
    expect(isValueDynamic("582917")).toBe(true);
  });
  it("treats any 3+ consecutive digit run as dynamic", () => {
    expect(isValueDynamic("row-582-approve")).toBe(true);
  });
  it("treats a value with more than half digit characters as dynamic", () => {
    // 3 of 5 characters are digits (60%), with no run of 3+ consecutive
    // digits — isolates the digit-density rule from the digit-run rule.
    expect(isValueDynamic("a12b3")).toBe(true);
  });
  it("treats an ordinary short value as stable", () => {
    expect(isValueDynamic("approve-action")).toBe(false);
    expect(isValueDynamic("field-1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Partial Selector precedes Ignore Selector for the same attribute (real
// `addAttribute`, module 65913).
// ---------------------------------------------------------------------------

describe("addAttribute precedence — Partial Selector checked before Ignore Selector for the same attribute", () => {
  it("uses the configured Partial function's substring even when an Ignore rule also targets that attribute", () => {
    setHtml(`<div data-row-id="row-582917">A</div>`);
    const config: DesConfig = {
      ...DEFAULT_DES_CONFIG,
      partialSelectors: {
        "data-row-id": (_name, value) =>
          value.startsWith("row-") ? "row-" : undefined,
      },
      ignore: { "data-row-id": () => true },
    };
    const pattern = buildElementPattern(document.querySelector("div")!, config);
    const attr = pattern.attributes.find((a) => a.name === "data-row-id");
    expect(attr).toBeDefined();
    expect(attr!.selectionType).toBe("prefix");
    expect(attr!.value).toBe("row-");
  });

  it("falls through to Ignore Selector when the Partial function returns nothing", () => {
    setHtml(`<div data-row-id="stable-token">A</div>`);
    const config: DesConfig = {
      ...DEFAULT_DES_CONFIG,
      partialSelectors: { "data-row-id": () => undefined },
      ignore: { "data-row-id": () => true },
    };
    const pattern = buildElementPattern(document.querySelector("div")!, config);
    expect(
      pattern.attributes.find((a) => a.name === "data-row-id"),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Selector generation (module 5757's patternToSelector/pathToSelector).
// ---------------------------------------------------------------------------

describe("patternToSelector / pathToSelector", () => {
  it("renders exact, prefix, suffix, and partial attribute predicates", () => {
    const selector = patternToSelector({
      tag: "input",
      attributes: [
        { name: "name", value: "vendor", selectionType: "exact" },
        { name: "id", value: "fld-", selectionType: "prefix" },
        { name: "data-x", value: "-suffix", selectionType: "suffix" },
        { name: "data-y", value: "mid", selectionType: "partial" },
      ],
      classes: [],
      pseudo: [],
    });
    expect(selector).toBe(
      'input[name="vendor"][id^="fld-"][data-x$="-suffix"][data-y*="mid"]',
    );
  });

  it("renders a valid-identifier class as .class and an invalid one as [class~=]", () => {
    const selector = patternToSelector({
      tag: "div",
      attributes: [],
      classes: [
        { class: "btn-primary", selectionType: "exact", length: 11 },
        { class: "1invalid", selectionType: "exact", length: 8 },
      ],
      pseudo: [],
    });
    expect(selector).toBe('div.btn-primary[class~="1invalid"]');
  });

  it("renders nth-child and contains pseudo entries", () => {
    const selector = patternToSelector({
      tag: "li",
      attributes: [],
      classes: [],
      pseudo: [
        { name: "nth-child", value: "3" },
        { name: "contains", value: "Approve" },
      ],
    });
    expect(selector).toBe('li:nth-child(3):contains("Approve")');
  });

  it("joins a path root-to-leaf with a direct-child combinator per level", () => {
    const selector = pathToSelector([
      { tag: "section", attributes: [], classes: [], pseudo: [] },
      {
        relates: "child",
        tag: "button",
        attributes: [{ name: "id", value: "save", selectionType: "exact" }],
        classes: [],
        pseudo: [],
      },
    ]);
    expect(selector).toBe('section > button[id="save"]');
  });
});

// ---------------------------------------------------------------------------
// elementMatches (module 99823) — non-strict mode accepts a rendered-unique
// winner among several raw matches.
// ---------------------------------------------------------------------------

describe("elementMatches", () => {
  it("accepts a single match trivially", () => {
    setHtml(`<button id="a">A</button>`);
    const el = document.querySelector("button")!;
    expect(elementMatches(el, [el], false)).toBe(true);
  });

  it("non-strict: accepts the target when it is the only rendered element among several raw matches", () => {
    setHtml(`
      <button class="dup" style="display:none">Hidden</button>
      <button class="dup">Visible</button>
    `);
    const [hidden, visible] = Array.from(document.querySelectorAll("button"));
    expect(elementMatches(visible!, [hidden!, visible!], false)).toBe(true);
    expect(elementMatches(hidden!, [hidden!, visible!], false)).toBe(false);
  });

  it("strict mode never accepts more than one raw match", () => {
    setHtml(
      `<button class="dup">A</button><button class="dup" style="display:none">B</button>`,
    );
    const [a, b] = Array.from(document.querySelectorAll("button"));
    expect(elementMatches(a!, [a!, b!], true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scoring (module 17851) — Dice-coefficient diff ratio, never Jaccard.
// ---------------------------------------------------------------------------

describe("patternDiffScore / diffScore", () => {
  it("scores an identical pattern as 1", () => {
    const pattern = {
      tag: "button",
      attributes: [{ name: "id", value: "save" }],
      classes: [],
      pseudo: [],
    };
    expect(patternDiffScore(pattern, pattern).total).toBe(1);
  });

  it("forces the tag contribution to 0 on a tag mismatch, but other axes still contribute", () => {
    const a = {
      tag: "button",
      attributes: [{ name: "id", value: "save" }],
      classes: [],
      pseudo: [],
    };
    const b = {
      tag: "a",
      attributes: [{ name: "id", value: "save" }],
      classes: [],
      pseudo: [],
    };
    const result = patternDiffScore(a, b);
    expect(result.tagMatches).toBe(false);
    expect(result.attributeScore).toBe(1);
    // (0*7 + 1*1 + 1*1 + 1*1) / 10 -- classes/pseudo both empty-vs-empty score 1
    expect(result.total).toBeCloseTo(0.3, 5);
  });

  it("weights the leaf 3x an ancestor chain that never simply pairs index-for-index", () => {
    const leaf = {
      relates: "child" as const,
      tag: "button",
      attributes: [{ name: "id", value: "save" }],
      classes: [],
      pseudo: [],
    };
    const ancestorA = {
      tag: "section",
      attributes: [{ name: "id", value: "form" }],
      classes: [],
      pseudo: [],
    };
    const pathA = [ancestorA, leaf];
    // An extra wrapper div inserted between section and button: ancestor
    // chain grows, but the leaf itself is untouched, so the score should
    // stay high (leaf dominates at 3x weight) rather than collapsing.
    const wrapper = {
      relates: "child" as const,
      tag: "div",
      attributes: [],
      classes: [],
      pseudo: [],
    };
    const pathB = [ancestorA, wrapper, { ...leaf }];
    expect(diffScore(pathA, pathB).total).toBeGreaterThan(0.85);
  });
});

// ---------------------------------------------------------------------------
// findElement (module 15906's `find()`) — the real recovery pipeline.
// ---------------------------------------------------------------------------

describe("findElement — real recovery pipeline", () => {
  it("accepts a single unique rendered match on the literal captured path immediately (checkInitialPath)", () => {
    setHtml(`<button id="save-button">Save</button>`);
    const el = document.querySelector("button")!;
    const path = buildElementPath(el, DEFAULT_DES_CONFIG);
    const result = findElement(path, document, DEFAULT_DES_CONFIG);
    expect(result.element).toBe(el);
    expect(result.strategy).toBe("checkInitialPath");
    expect(result.score).toBe(1);
  });

  it("recovers via dropDynamicValues when a non-ignored attribute's value regenerates on re-render", () => {
    setHtml(
      `<section id="grid"><button data-row-id="58291" class="approve-btn">Approve</button></section>`,
    );
    const el = document.querySelector("button")!;
    const path = buildElementPath(el, DEFAULT_DES_CONFIG);

    // Re-render: the row's data-row-id regenerates (a realistic enterprise
    // grid pattern), the stable class/tag/ancestor context does not.
    setHtml(
      `<section id="grid"><button data-row-id="99123" class="approve-btn">Approve</button></section>`,
    );
    const recovered = document.querySelector("button")!;

    const result = findElement(path, document, DEFAULT_DES_CONFIG);
    expect(result.element).toBe(recovered);
    expect(result.strategy).toBe("dropDynamicValues");
  });

  it("recovers via dropOneAncestor when a wrapper container is inserted between the target and a stable ancestor", () => {
    setHtml(
      `<form id="purchase-order"><section><input id="fld-vendor" name="vendor" /></section></form>`,
    );
    const el = document.querySelector("input")!;
    const path = buildElementPath(el, DEFAULT_DES_CONFIG);

    setHtml(
      `<form id="purchase-order"><div class="layout-wrapper-v2"><section><input id="fld-vendor" name="vendor" /></section></div></form>`,
    );
    const recovered = document.querySelector("input")!;

    const result = findElement(path, document, DEFAULT_DES_CONFIG);
    expect(result.element).toBe(recovered);
  });

  it("returns null (NOT_RESOLVED) when nothing in the document shares the target's tag at all", () => {
    setHtml(`<button id="save">Save</button>`);
    const el = document.querySelector("button")!;
    const path = buildElementPath(el, DEFAULT_DES_CONFIG);
    setHtml(`<div>Completely different page</div>`);

    const result = findElement(path, document, DEFAULT_DES_CONFIG);
    expect(result.element).toBeNull();
    expect(result.score).toBeNull();
  });

  it("invariant: a hidden true target can lose to a visible, structurally-identical twin — the real algorithm prefers rendered candidates over raw target identity", () => {
    setHtml(`
      <ul>
        <li><button class="row-action">Go</button></li>
        <li><button class="row-action">Go</button></li>
      </ul>
    `);
    const [first, second] = Array.from(document.querySelectorAll("button"));
    const path = buildElementPath(first!, DEFAULT_DES_CONFIG);
    (first as HTMLElement).style.display = "none";

    const result = findElement(path, document, DEFAULT_DES_CONFIG);
    // This is a genuine, faithfully-reproduced real-algorithm property,
    // not a bug in this port: `find()` explicitly prefers a rendered
    // candidate. Verifying THIS specific finding (silently landing on a
    // sibling instead of the intended hidden control) is exactly the kind
    // of evidence this audit exists to surface.
    expect(result.element).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// checkContainersScore (module 74456).
// ---------------------------------------------------------------------------

describe("checkContainersScore", () => {
  it("passes trivially with no containers to check", () => {
    expect(checkContainersScore([], document, 0.5)).toBe(true);
  });

  it("passes once enough of the originally-captured ancestor selectors still resolve", () => {
    setHtml(`<div id="a"></div><div id="b"></div>`);
    // 2 of 3 configured container selectors still resolve -> ceil(3*0.5)=2 -> pass
    expect(
      checkContainersScore(["#a", "#b", "#nonexistent"], document, 0.5),
    ).toBe(true);
  });

  it("fails when too few originally-captured container selectors still resolve", () => {
    setHtml(`<div id="a"></div>`);
    expect(
      checkContainersScore(["#a", "#missing-1", "#missing-2"], document, 0.9),
    ).toBe(false);
  });

  it("getContainerSelectors returns one selector per rendered ancestor up to the scope root", () => {
    setHtml(
      `<section id="outer"><div id="inner"><button id="save">Save</button></div></section>`,
    );
    const selectors = getContainerSelectors(
      document.querySelector("button")!,
      DEFAULT_DES_CONFIG,
    );
    expect(selectors.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Frame isolation — natural DOM scoping (root.querySelectorAll never
// crosses into a different Document).
// ---------------------------------------------------------------------------

describe("frame isolation", () => {
  it("never matches a candidate in a different document/frame, even with identical structure", () => {
    setHtml(`<iframe id="frame"></iframe><button id="only-here">Go</button>`);
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    iframe.contentDocument!.body.innerHTML = `<button id="only-here">Go</button>`;
    const topButton = document.getElementById("only-here")!;

    const path = buildElementPath(topButton, DEFAULT_DES_CONFIG);
    const result = findElement(path, document, DEFAULT_DES_CONFIG);
    expect(result.element).toBe(topButton);

    const crossFrameMatches = iframe.contentDocument!.querySelectorAll(
      pathToSelector(path),
    );
    expect(Array.from(crossFrameMatches)).not.toContain(topButton);
  });
});

// ---------------------------------------------------------------------------
// Shadow DOM — open roots are ordinary ParentNodes; closed roots are the
// caller's responsibility (see health-selector-engine.ts's
// `inaccessibleReason` option).
// ---------------------------------------------------------------------------

describe("shadow DOM", () => {
  it("resolves inside an open shadow root when scoped to it", () => {
    setHtml(`<div id="host"></div>`);
    const host = document.querySelector("#host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<button id="inner-btn">Go</button>`;
    const el = shadow.querySelector("button")!;

    const path = buildElementPath(el, DEFAULT_DES_CONFIG);
    const result = findElement(path, shadow, DEFAULT_DES_CONFIG);
    expect(result.element).toBe(el);
  });
});

// ---------------------------------------------------------------------------
// generateMinimalSelector — faithful-intent reconstruction of real
// match()/optimize() (see des-engine.ts's doc comment on exactly what
// could not be recovered byte-for-byte).
// ---------------------------------------------------------------------------

describe("generateMinimalSelector", () => {
  it("prefers a single stable id over combining multiple attributes", () => {
    setHtml(`<button id="save-button" class="btn btn-primary">Save</button>`);
    const el = document.querySelector("button")!;
    const result = generateMinimalSelector(el, document, DEFAULT_DES_CONFIG);
    expect(result?.selector).toBe('button[id="save-button"]');
    expect(result?.usesPositionalSelector).toBe(false);
  });

  it("falls back to nth-child when nothing on the element alone is unique", () => {
    setHtml(
      `<ul><li class="row">A</li><li class="row">B</li><li class="row">C</li></ul>`,
    );
    const second = document.querySelectorAll("li")[1]!;
    const result = generateMinimalSelector(
      second,
      document,
      DEFAULT_DES_CONFIG,
    );
    expect(result?.usesPositionalSelector).toBe(true);
    expect(document.querySelectorAll(result!.selector)).toHaveLength(1);
    expect(document.querySelector(result!.selector)).toBe(second);
  });
});
