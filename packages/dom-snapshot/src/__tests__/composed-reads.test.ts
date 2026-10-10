import { afterEach, describe, expect, it, vi } from "vitest";
import { querySelectorDeep } from "../composed-tree";
import { hitTestElement } from "../health-hit-test";
import { hasAccessibleName } from "../health-selector-engine";
import { computeFrameStateSignature } from "../health-state-signature";
import { loadErpFixture } from "./fixtures/erp/load-fixture";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("accessible names in the composed tree", () => {
  it("takes an IDS menu item's name from the label slotted into its shadow root", () => {
    loadErpFixture("infor-ids-shadow");
    const item = querySelectorDeep(document, 'a[role="menuitemradio"]')!;

    expect(item.textContent?.trim()).toBe("");
    expect(hasAccessibleName(item)).toBe(true);
  });

  it("takes an IDS button's name from its slotted light-DOM label when it has no aria-label", () => {
    loadErpFixture("infor-ids-shadow", {
      transform: (html) =>
        html.replace(
          'tooltip="GenAI Assistant" aria-label="GenAI Assistant"',
          'tooltip="GenAI Assistant"',
        ),
    });
    const button = querySelectorDeep(
      document,
      '#infor-genai-chat-panel button, button[tooltip="GenAI Assistant"]',
    )!;

    expect(button.hasAttribute("aria-label")).toBe(false);
    expect(hasAccessibleName(button)).toBe(true);
  });

  it("resolves aria-labelledby inside the control's own shadow root, and only to text that exists", () => {
    loadErpFixture("athena-forge-panel");
    const firstName = querySelectorDeep(document, "#firstName")!;

    expect(hasAccessibleName(firstName)).toBe(true);
    firstName.setAttribute("aria-labelledby", "no-such-label");
    firstName.removeAttribute("id");
    expect(hasAccessibleName(firstName)).toBe(false);
  });

  it("reports no name for a shadow button whose slot is empty", () => {
    document.body.innerHTML = "<x-icon-button></x-icon-button>";
    const host = document.querySelector("x-icon-button")!;
    host.attachShadow({ mode: "open" }).innerHTML =
      "<button><slot></slot></button>";

    expect(hasAccessibleName(host.shadowRoot!.querySelector("button")!)).toBe(
      false,
    );
  });
});

describe("hit testing through shadow roots", () => {
  function shadowButton() {
    document.body.innerHTML = "<x-host></x-host>";
    const host = document.querySelector("x-host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = "<button>Inside</button><div>Cover</div>";
    const button = shadow.querySelector("button")!;
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 10,
      right: 110,
      bottom: 40,
      width: 100,
      height: 30,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    } as DOMRect);
    if (!("elementFromPoint" in document)) {
      (document as { elementFromPoint?: unknown }).elementFromPoint = () =>
        null;
    }
    vi.spyOn(document, "elementFromPoint").mockReturnValue(host);
    return { host, shadow, button };
  }

  it("follows the document's hit on the host down to the element inside the shadow root", () => {
    const { shadow, button } = shadowButton();
    (shadow as { elementFromPoint?: unknown }).elementFromPoint = () => button;

    expect(hitTestElement(button)).toEqual({
      pointsPassed: 9,
      classification: "fully-targetable",
    });
  });

  it("reports an element covered by a sibling inside the same shadow root as occluded", () => {
    const { shadow, button } = shadowButton();
    const cover = shadow.querySelector("div")!;
    (shadow as { elementFromPoint?: unknown }).elementFromPoint = () => cover;

    expect(hitTestElement(button)?.classification).toBe("fully-occluded");
  });
});

describe("state signature in the composed tree", () => {
  it("finds a heading that exists only inside a shadow root (athenaOne micro-frontend)", () => {
    loadErpFixture("athena-forge-panel");

    expect(document.querySelector("h1, h2, h3")).toBeNull();
    expect(computeFrameStateSignature(document).primaryHeading).toBe(
      "Contact Details",
    );
  });

  it("finds an active navigation item that exists only inside shadow roots, and only while it is rendered", () => {
    loadErpFixture("infor-ids-shadow");
    expect(computeFrameStateSignature(document).navTrail).toEqual([]);

    loadErpFixture("infor-ids-shadow", {
      transform: (html) =>
        html.replace(
          'trigger-type="click" align="bottom, right" hidden=""',
          'trigger-type="click" align="bottom, right"',
        ),
    });
    expect(computeFrameStateSignature(document).navTrail).toEqual(["Light"]);
  });

  it("reads LN's active tab label through its slot", () => {
    loadErpFixture("infor-portal-workspace");

    expect(computeFrameStateSignature(document).navTrail).toEqual(["LN"]);
  });

  it("sees the structure inside shadow roots", () => {
    document.body.innerHTML = "<main><x-panel></x-panel></main>";
    const shadow = document
      .querySelector("x-panel")!
      .attachShadow({ mode: "open" });
    shadow.innerHTML = "<table><tr><td>1</td></tr></table>";
    const table = computeFrameStateSignature(document).structureHash;

    shadow.innerHTML = "<form><input></form>";

    expect(computeFrameStateSignature(document).structureHash).not.toBe(table);
  });

  it("reads slotted content into the structure as rendered", () => {
    document.body.innerHTML =
      '<main><x-card><form slot="body"></form></x-card></main>';
    const shadow = document
      .querySelector("x-card")!
      .attachShadow({ mode: "open" });
    shadow.innerHTML = '<section><slot name="body"></slot></section>';
    const slotted = computeFrameStateSignature(document).structureHash;

    document
      .querySelector("x-card form")!
      .replaceWith(document.createElement("table"));
    document.querySelector("x-card table")!.setAttribute("slot", "body");

    expect(computeFrameStateSignature(document).structureHash).not.toBe(
      slotted,
    );
  });

  it("does not change when a clock inside a shadow root ticks", () => {
    document.body.innerHTML = "<x-app></x-app>";
    const shadow = document
      .querySelector("x-app")!
      .attachShadow({ mode: "open" });
    shadow.innerHTML =
      '<h1>Orders</h1><nav><a aria-current="page">Orders</a></nav><span id="clock">10:00:01</span>';
    const before = computeFrameStateSignature(document);

    shadow.getElementById("clock")!.textContent = "10:00:02";

    expect(computeFrameStateSignature(document)).toEqual(before);
  });
});
