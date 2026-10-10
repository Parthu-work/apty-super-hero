import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composedText,
  querySelectorAllDeep,
  querySelectorDeep,
  walkComposedTree,
} from "../composed-tree";
import { loadErpFixture } from "./fixtures/erp/load-fixture";

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
  vi.restoreAllMocks();
});

describe("querySelectorAllDeep", () => {
  it("finds the IDS control two shadow roots below the document", () => {
    loadErpFixture("infor-ids-shadow");

    const buttons = querySelectorAllDeep(document, 'button[part="button"]');

    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Theme Switcher",
      "GenAI Assistant",
    ]);
    expect(buttons[0]!.getRootNode()).not.toBe(document);
  });

  it("does not enter a host the caller excludes", () => {
    loadErpFixture("athena-forge-panel");

    const skipped = querySelectorAllDeep(document, "input", undefined, {
      skipShadowOf: (host) =>
        host.classList.contains(
          "eal_c_nimbus-app-container__nimbus-app-container",
        ),
    });

    expect(skipped).toHaveLength(0);
    expect(querySelectorAllDeep(document, "input").length).toBeGreaterThan(0);
  });

  it("enters closed roots through chrome.dom.openOrClosedShadowRoot", () => {
    document.body.innerHTML = '<x-closed id="host"></x-closed>';
    const host = document.getElementById("host")!;
    const closed = host.attachShadow({ mode: "closed" });
    closed.innerHTML = "<button>Inside</button>";
    (globalThis as { chrome?: unknown }).chrome = {
      dom: {
        openOrClosedShadowRoot: (el: Element) => (el === host ? closed : null),
      },
    };

    expect(querySelectorDeep(document, "button")?.textContent).toBe("Inside");
  });
});

describe("walkComposedTree", () => {
  it("reports truncation instead of silently stopping at the element budget", () => {
    loadErpFixture("infor-portal-workspace");

    const result = walkComposedTree(document, () => undefined, {
      maxElements: 20,
    });

    expect(result.elementsVisited).toBe(20);
    expect(result.truncated).toBe(true);
  });

  it("counts every shadow root it enters", () => {
    const { shadowRootsAttached } = loadErpFixture("infor-portal-workspace");

    expect(walkComposedTree(document, () => undefined).shadowRootsEntered).toBe(
      shadowRootsAttached,
    );
  });
});

describe("composedText", () => {
  it("reads an IDS heading whose text is slotted from the host's light DOM", () => {
    loadErpFixture("infor-ids-shadow");

    const heading = querySelectorDeep(document, "h1")!;

    expect(heading.textContent?.trim()).toBe("");
    expect(composedText(heading)).toBe("Infor OS Portal");
  });

  it("reads a menu item label through a slot inside a nested shadow root", () => {
    loadErpFixture("infor-ids-shadow");

    const item = querySelectorDeep(document, 'a[role="menuitemradio"]')!;

    expect(composedText(item)).toBe("Light");
  });

  it("never includes style or script bodies", () => {
    loadErpFixture("athena-forge-panel");

    const host = document.querySelector(
      ".eal_c_nimbus-app-container__nimbus-app-container",
    )!;
    const text = composedText(host, 2000);

    expect(text).toContain("Legal first name");
    expect(text).not.toContain("a11yText{");
    expect(text).not.toContain(":host");
  });

  it("renders a host's shadow tree in place of its unslotted light DOM", () => {
    document.body.innerHTML =
      '<x-card id="card"><span>light only</span></x-card>';
    const card = document.getElementById("card")!;
    card.attachShadow({ mode: "open" }).innerHTML = "<b>shadow</b>";

    expect(composedText(card)).toBe("shadow");
  });
});
