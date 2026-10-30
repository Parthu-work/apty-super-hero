import { afterEach, describe, expect, it, vi } from "vitest";
import { testStoredElement } from "../stored-element-test";

const css = (selector: string, shadowRoots: string[] = []) => ({
  language: "css" as const,
  selector,
  shadowRoots,
});

function rectOf(el: Element, rect: Partial<DOMRect>) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect);
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("testStoredElement", () => {
  it("takes the first rendered match, as the player does, and counts the others", () => {
    document.body.innerHTML = `
      <button class="save" style="display:none">Save</button>
      <button class="save" id="visible">Save</button>
      <button class="save">Save</button>`;
    rectOf(document.getElementById("visible")!, {
      top: 10,
      left: 10,
      bottom: 30,
      right: 60,
      width: 50,
      height: 20,
    });

    const test = testStoredElement(document, css("button.save"));

    expect(test).toEqual({
      invalid: false,
      matchCount: 3,
      renderedCount: 2,
      brokenHostIndex: null,
      shadowMatches: 0,
      chosen: { rendered: true, inViewport: true },
    });
  });

  it("falls back to the first match when none is rendered, and says it is hidden", () => {
    document.body.innerHTML = `<div style="display:none"><input name="q"></div>`;

    const test = testStoredElement(document, css('input[name="q"]'));

    expect(test.matchCount).toBe(1);
    expect(test.renderedCount).toBe(0);
    expect(test.chosen).toEqual({ rendered: false, inViewport: false });
  });

  it("names a selector that does not parse instead of reporting no match", () => {
    expect(testStoredElement(document, css("button[")).invalid).toBe(true);
    expect(
      testStoredElement(document, {
        language: "xpath",
        selector: "//button[",
        shadowRoots: [],
      }).invalid,
    ).toBe(true);
  });

  it("counts matches the document lookup cannot reach inside open shadow roots", () => {
    document.body.innerHTML = `<x-card></x-card>`;
    const host = document.querySelector("x-card")!;
    host.attachShadow({
      mode: "open",
    }).innerHTML = `<button name="go">Go</button>`;

    const fromDocument = testStoredElement(document, css('button[name="go"]'));
    const throughHost = testStoredElement(
      document,
      css('button[name="go"]', ["x-card"]),
    );

    expect(fromDocument).toMatchObject({ matchCount: 0, shadowMatches: 1 });
    expect(throughHost).toMatchObject({ matchCount: 1, shadowMatches: 0 });
  });

  it("names the shadow host selector that finds no open root", () => {
    document.body.innerHTML = `<x-card></x-card>`;

    const test = testStoredElement(document, css("button", ["x-other"]));

    expect(test.brokenHostIndex).toBe(0);
  });

  it("evaluates an XPath against the document and keeps elements only", () => {
    document.body.innerHTML = `<form><label>Name</label><input id="n"></form>`;

    const test = testStoredElement(document, {
      language: "xpath",
      selector: "//form/*",
      shadowRoots: [],
    });

    expect(test).toMatchObject({
      invalid: false,
      matchCount: 2,
      renderedCount: 2,
      chosen: { rendered: true, inViewport: false },
    });
  });

  it("reports an element below the screen as outside the viewport", () => {
    document.body.innerHTML = `<button id="far">Far</button>`;
    rectOf(document.getElementById("far")!, {
      top: 5000,
      bottom: 5020,
      left: 0,
      right: 50,
      width: 50,
      height: 20,
    });

    expect(testStoredElement(document, css("#far")).chosen).toEqual({
      rendered: true,
      inViewport: false,
    });
  });

  it("tells whether the frame it runs in is the one the stored frame path leads to (N3)", () => {
    document.body.innerHTML = `<iframe id="a"></iframe><iframe id="b"></iframe>`;
    const [a, b] = [...document.querySelectorAll("iframe")].map(
      (frame) => frame.contentDocument as Document,
    );
    const target = { ...css("button"), framePath: ["#b"] };

    expect(testStoredElement(b as Document, target).onFramePath).toBe(true);
    expect(testStoredElement(a as Document, target).onFramePath).toBe(false);
    expect(
      testStoredElement(b as Document, { ...target, framePath: [] })
        .onFramePath,
    ).toBe(false);
    expect(testStoredElement(document, css("button")).onFramePath).toBe(
      undefined,
    );
  });
});
