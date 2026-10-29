import { beforeEach, describe, expect, it } from "vitest";
import {
  captureSelection,
  captureSelector,
  closedShadowHost,
  playSelection,
} from "../apty-selector";
import { resetDesPerformanceCaches } from "../des-engine";
import {
  DEFAULT_DES_CONFIG,
  type DesConfig,
} from "../health-attribute-classification";

function setHtml(html: string) {
  document.body.innerHTML = html;
  resetDesPerformanceCaches();
}

function config(overrides: Partial<DesConfig> = {}): DesConfig {
  return { ...DEFAULT_DES_CONFIG, ...overrides };
}

function selectorFor(el: Element, overrides: Partial<DesConfig> = {}) {
  return captureSelector(el, config(overrides)).selector;
}

beforeEach(() => {
  setHtml("");
});

describe("captureSelector — match and optimize as Apty's library does", () => {
  it("stops at the first attribute in priority order that is unique, then drops what the optimizer can", () => {
    setHtml(
      `<a id="home" href="/home">Home</a><a id="help" href="/help">Help</a>`,
    );
    const el = document.querySelector("#home")!;

    expect(selectorFor(el)).toBe('a[id="home"]');
  });

  it("keeps the value of an attribute the application declared as identity", () => {
    setHtml(
      `<div data-comp="FormTab_1"></div><div data-comp="FormTab_2"></div><span data-comp="x"></span>`,
    );
    const el = document.querySelector('[data-comp="FormTab_1"]')!;

    expect(selectorFor(el, { priority: ["data-comp"] })).toBe(
      'div[data-comp="FormTab_1"]',
    );
    // Not declared: the same first pass, but nothing stops it reducing.
    expect(
      selectorFor(el, {
        priority: ["data-comp"],
        identityAttributes: ["data-comp"],
      }),
    ).toBe('div[data-comp="FormTab_1"]');
  });

  it("reduces an attribute to presence when presence alone is unique, unless it carries identity", () => {
    setHtml(`<input name="q" data-x="1"><input>`);
    const el = document.querySelector("input[name]")!;

    expect(selectorFor(el, { priority: ["name"] })).toBe("input[name]");
    expect(
      selectorFor(el, { priority: ["name"], identityAttributes: ["name"] }),
    ).toBe('input[name="q"]');
  });

  it("tells repeated rows apart by position as nth-of-type", () => {
    setHtml(`<ul><li>A</li><li>B</li><li>C</li></ul>`);
    const second = document.querySelectorAll("li")[1]!;

    const captured = captureSelector(second, config());

    expect(captured.facts.positional).toBe(true);
    expect(document.querySelectorAll(captured.selector)).toHaveLength(1);
    expect(document.querySelector(captured.selector)).toBe(second);
    expect(captured.selector).toContain("nth-of-type(2)");
  });

  it("tells an element apart by a descendant that carries a priority attribute", () => {
    setHtml(`
      <div class="card"><a data-uid="a1">Open</a></div>
      <div class="card"><a data-uid="b2">Open</a></div>
    `);
    const card = document.querySelectorAll(".card")[1]!;

    const captured = captureSelector(card, config({ priority: ["data-uid"] }));

    expect(captured.facts.descendant).toBe(true);
    expect(captured.selector).toContain(':has(> a[data-uid="b2"])');
    expect(document.querySelectorAll(captured.selector)).toHaveLength(1);
  });

  it("anchors on a partial selector part, which bypasses the default digit ignore", () => {
    setHtml(
      `<button id="win12-save-button">Save</button><button id="win12-cancel-button">Cancel</button>`,
    );
    const el = document.querySelector("button")!;
    const partial = {
      partialSelectors: {
        id: (_name: string, value: string) => value.match(/^win\d+(-.*)$/)?.[1],
      },
      partialSelectorAttributes: ["id"],
    };

    const captured = captureSelector(el, config(partial));

    expect(captured.selector).toBe('button[id$="-save-button"]');
    expect(captured.facts.partial).toBe(true);
  });

  it("never uses an attribute name a CSS selector cannot hold", () => {
    setHtml(
      `<iframe #frameview="a" name="portal"></iframe><iframe name="other"></iframe>`,
    );
    const frame = document.querySelector("iframe")!;

    const selector = selectorFor(frame);

    expect(selector).not.toContain("#frameview");
    expect(document.querySelector(selector)).toBe(frame);
  });

  it("generates within the nearest scope root and stays ambiguous across copies of it", () => {
    setHtml(`
      <section class="tab"><button name="save">Save</button></section>
      <section class="tab"><button name="save">Save</button></section>
    `);
    const second = document.querySelectorAll("button")[1]!;

    const scoped = selectorFor(second, { scopeRootSelectors: [".tab"] });

    expect(scoped).toBe("button");
    expect(selectorFor(second)).not.toBe("button");
  });

  it("requires a genuinely unique match when strict, as frame selectors do", () => {
    setHtml(
      `<iframe name="a"></iframe><iframe name="a" style="display:none"></iframe>`,
    );
    const visible = document.querySelector("iframe")!;

    expect(captureSelector(visible, config()).selector).toBe("iframe");
    expect(
      captureSelector(visible, config(), { strict: true }).facts.positional,
    ).toBe(true);
  });
});

describe("captureSelection — shadow roots", () => {
  function nestedShadow(): Element {
    document.body.innerHTML = `<x-shell></x-shell><x-shell></x-shell>`;
    const [first, second] = Array.from(document.querySelectorAll("x-shell"));
    first!.attachShadow({ mode: "open" }).innerHTML = "<span>other</span>";
    const shadow = second!.attachShadow({ mode: "open" });
    shadow.innerHTML = `<div><button name="go">Go</button><button name="stop">Stop</button></div>`;
    resetDesPerformanceCaches();
    return shadow.querySelector('button[name="go"]')!;
  }

  it("stores one selector per host and a selector valid inside the innermost root", () => {
    const el = nestedShadow();

    const selection = captureSelection(el, config());

    expect(selection.shadowRoots).toHaveLength(1);
    expect(playSelection(selection, document).element).toBe(el);
  });

  it("keeps the full chain of levels inside a shadow root, since capture queries the document", () => {
    const el = nestedShadow();

    const selection = captureSelection(el, config());

    expect(selection.selector).toBe('div button[name="go"]');
  });

  it("finds nothing behind a closed root, where the lookup falls back to the document", () => {
    document.body.innerHTML = `<x-closed></x-closed>`;
    const host = document.querySelector("x-closed")!;
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<button name="go">Go</button><button>Other</button>`;
    const el = shadow.querySelector("button")!;

    expect(closedShadowHost(el)).toBe(host);
    const played = playSelection(
      { selector: 'button[name="go"]', shadowRoots: ["x-closed"] },
      document,
    );
    expect(played.element).toBeNull();
    expect(played.brokenHostIndex).toBe(0);
  });
});

describe("playSelection — the player's lookup", () => {
  it("prefers the rendered match among several", () => {
    setHtml(`
      <div style="display:none"><button class="save">Save</button></div>
      <div><button class="save">Save</button></div>
    `);
    const rendered = document.querySelectorAll("button")[1]!;

    const played = playSelection(
      { selector: "button.save", shadowRoots: [] },
      document,
    );

    expect(played.element).toBe(rendered);
    expect(played.matchCount).toBe(2);
    expect(played.renderedCount).toBe(1);
  });

  it("falls back to the first match when none is rendered", () => {
    setHtml(
      `<button class="x" style="display:none">A</button><button class="x" style="display:none">B</button>`,
    );

    const played = playSelection(
      { selector: "button.x", shadowRoots: [] },
      document,
    );

    expect(played.element).toBe(document.querySelector("button"));
  });

  it("returns nothing for a selector the engine rejects", () => {
    expect(
      playSelection({ selector: "button[", shadowRoots: [] }, document).element,
    ).toBeNull();
  });
});
