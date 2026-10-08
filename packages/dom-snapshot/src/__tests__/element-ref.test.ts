import { afterEach, describe, expect, it } from "vitest";
import { querySelectorDeep } from "../composed-tree";
import { buildElementPath } from "../des-engine";
import {
  buildElementRef,
  describeElementRef,
  ELEMENT_REF_VERSION,
  resolveElementRef,
  shadowHostChain,
  toElementRef,
} from "../element-ref";
import { AUDIT_DES_CONFIG } from "../health-audit-profile";
import {
  computeComposedFingerprint,
  replayElementRefs,
} from "../health-selector-engine";
import { loadErpFixture } from "./fixtures/erp/load-fixture";

const THEME_BUTTON = 'button[aria-label="Theme Switcher"]';

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
});

function themeButton(): Element {
  return querySelectorDeep(document, THEME_BUTTON)!;
}

describe("ElementRef", () => {
  it("records both shadow hosts above an IDS control two roots deep", () => {
    loadErpFixture("infor-ids-shadow");
    const button = themeButton();

    const ref = buildElementRef(button, { frameKey: "LN" });

    expect(shadowHostChain(button).map((h) => h.tagName.toLowerCase())).toEqual(
      ["ids-theme-switcher", "ids-menu-button"],
    );
    expect(ref.version).toBe(ELEMENT_REF_VERSION);
    expect(ref.hostChain).toHaveLength(2);
    expect(ref.frameKey).toBe("LN");
    expect(describeElementRef(ref).split(" >>> ")).toHaveLength(3);
    expect(resolveElementRef(ref, document).element).toBe(button);
  });

  it("re-resolves the control after the page is rendered again, where a document-rooted replay cannot", () => {
    loadErpFixture("infor-ids-shadow");
    const sample = {
      fingerprint: computeComposedFingerprint(themeButton()),
      ref: buildElementRef(themeButton()),
    };

    loadErpFixture("infor-ids-shadow");
    const [replayed] = replayElementRefs(document, [sample]);
    const [documentRooted] = replayElementRefs(document, [
      { fingerprint: sample.fingerprint, path: sample.ref.path },
    ]);

    expect(replayed).toEqual({
      fingerprint: sample.fingerprint,
      verdict: "DIRECT_STABLE",
    });
    expect(documentRooted?.legacy).toBe(true);
    expect(["NOT_RESOLVED", "WRONG_TARGET"]).toContain(documentRooted?.verdict);
  });

  it("reports a host that lost its shadow root at that hop, with the host's selector", () => {
    loadErpFixture("infor-ids-shadow");
    const sample = {
      fingerprint: computeComposedFingerprint(themeButton()),
      ref: buildElementRef(themeButton()),
    };

    loadErpFixture("infor-ids-shadow", {
      transform: (html) =>
        html.replace(
          /(<ids-menu-button id="ids-theme-switcher"[^>]*>)<template shadowrootmode="open">[\s\S]*?<\/template>/,
          "$1",
        ),
    });
    const [result] = replayElementRefs(document, [sample]);

    expect(result).toMatchObject({
      verdict: "HOST_NOT_RESOLVED",
      brokenAtHop: 1,
    });
    expect(result?.hostSelector).toContain("ids-menu-button");
  });

  it("reports a host that no longer exists at the hop where the chain broke", () => {
    loadErpFixture("infor-ids-shadow");
    const ref = buildElementRef(themeButton());

    loadErpFixture("infor-ids-shadow", {
      transform: (html) =>
        html.replace(/<ids-theme-switcher[\s\S]*<\/ids-theme-switcher>/, ""),
    });
    const resolution = resolveElementRef(ref, document);

    expect(resolution.element).toBeNull();
    expect(resolution.brokenAtHop).toBe(0);
    expect(resolution.hops).toEqual([
      expect.objectContaining({
        hop: 0,
        kind: "host",
        outcome: "not-resolved",
        selector: expect.stringContaining("ids-theme-switcher"),
      }),
    ]);
  });

  it("enters closed shadow roots through chrome.dom.openOrClosedShadowRoot", () => {
    const closed = (html: string) =>
      html.replaceAll('shadowrootmode="open"', 'shadowrootmode="closed"');
    const { closedRoots } = loadErpFixture("infor-ids-shadow", {
      transform: closed,
    });
    (globalThis as { chrome?: unknown }).chrome = {
      dom: {
        openOrClosedShadowRoot: (el: Element) => closedRoots.get(el) ?? null,
      },
    };
    const button = querySelectorDeep(document, THEME_BUTTON)!;
    expect(document.querySelector("ids-theme-switcher")!.shadowRoot).toBeNull();

    const ref = buildElementRef(button);

    expect(ref.hostChain).toHaveLength(2);
    expect(resolveElementRef(ref, document).element).toBe(button);
  });

  it("migrates a pre-ElementRef sample to a document-rooted ref and rejects an unknown version", () => {
    document.body.innerHTML = "<button>Save</button>";
    const path = buildElementPath(
      document.querySelector("button")!,
      AUDIT_DES_CONFIG,
    );

    expect(toElementRef({ path })).toEqual({
      ref: { version: ELEMENT_REF_VERSION, hostChain: [], path, frameKey: "" },
      legacy: true,
    });
    expect(
      toElementRef({ ref: { version: 99, hostChain: [], path } }),
    ).toBeNull();
    expect(toElementRef({})).toBeNull();
  });
});
