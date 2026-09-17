import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hitTestElement } from "../health-hit-test";

function setHtml(html: string) {
  document.body.innerHTML = html;
}

function mockRect(
  el: Element,
  rect: Partial<DOMRect> & { width: number; height: number },
) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    top: rect.top ?? 0,
    left: rect.left ?? 0,
    right: (rect.left ?? 0) + rect.width,
    bottom: (rect.top ?? 0) + rect.height,
    width: rect.width,
    height: rect.height,
    toJSON() {
      return {};
    },
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1024,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 768,
  });
  // jsdom does not implement elementFromPoint at all — define a stub own
  // property so `vi.spyOn` (which requires the property to already exist)
  // has something to replace.
  if (!("elementFromPoint" in document)) {
    (document as unknown as { elementFromPoint: () => null }).elementFromPoint =
      () => null;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hitTestElement", () => {
  it("classifies zero-size elements without sampling points", () => {
    setHtml(`<button id="btn">Go</button>`);
    const el = document.getElementById("btn")!;
    mockRect(el, { width: 0, height: 0 });

    const result = hitTestElement(el);

    expect(result?.classification).toBe("zero-size");
    expect(result?.pointsPassed).toBe(0);
  });

  it("classifies display:none elements as hidden without sampling points", () => {
    setHtml(`<button id="btn" style="display: none;">Go</button>`);
    const el = document.getElementById("btn")!;
    mockRect(el, { width: 100, height: 40 });

    const result = hitTestElement(el);

    expect(result?.classification).toBe("hidden");
  });

  it("classifies an element entirely off-screen as outside-viewport", () => {
    setHtml(`<button id="btn">Go</button>`);
    const el = document.getElementById("btn")!;
    mockRect(el, { width: 100, height: 40, left: 5000, top: 5000 });

    const result = hitTestElement(el);

    expect(result?.classification).toBe("outside-viewport");
  });

  it("classifies fully-targetable when every sampled point resolves to the element", () => {
    setHtml(`<button id="btn">Go</button>`);
    const el = document.getElementById("btn")!;
    mockRect(el, { width: 100, height: 40, left: 10, top: 10 });
    vi.spyOn(document, "elementFromPoint").mockReturnValue(el);

    const result = hitTestElement(el);

    expect(result?.classification).toBe("fully-targetable");
    expect(result?.pointsPassed).toBe(9);
  });

  it("classifies fully-occluded when an unrelated overlay covers every sampled point", () => {
    setHtml(`<button id="btn">Go</button><div id="overlay"></div>`);
    const el = document.getElementById("btn")!;
    const overlay = document.getElementById("overlay")!;
    mockRect(el, { width: 100, height: 40, left: 10, top: 10 });
    vi.spyOn(document, "elementFromPoint").mockReturnValue(overlay);

    const result = hitTestElement(el);

    expect(result?.classification).toBe("fully-occluded");
    expect(result?.pointsPassed).toBe(0);
  });

  it("classifies partially-targetable when a majority (>=5/9) of points pass", () => {
    setHtml(`<button id="btn">Go</button><div id="overlay"></div>`);
    const el = document.getElementById("btn")!;
    const overlay = document.getElementById("overlay")!;
    mockRect(el, { width: 100, height: 40, left: 10, top: 10 });
    let call = 0;
    vi.spyOn(document, "elementFromPoint").mockImplementation(() => {
      call++;
      return call <= 6 ? el : overlay;
    });

    const result = hitTestElement(el);

    expect(result?.classification).toBe("partially-targetable");
    expect(result?.pointsPassed).toBe(6);
  });
});
