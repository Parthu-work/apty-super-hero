import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hitTestElement } from "../health-hit-testing";

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

  it("classifies an element inside a hidden container as hidden, not zero-size", () => {
    setHtml(
      `<div style="display: none;"><button id="btn">Close all</button></div>`,
    );
    const el = document.getElementById("btn")!;
    mockRect(el, { width: 0, height: 0 });
    // jsdom has no checkVisibility; Chrome's answers false for a hidden ancestor.
    Object.defineProperty(el, "checkVisibility", {
      configurable: true,
      value: () => false,
    });

    expect(hitTestElement(el)).toEqual({
      pointsPassed: 0,
      classification: "hidden",
    });
  });

  it("still classifies a rendered element with no width or height as zero-size", () => {
    setHtml(`<button id="btn"></button>`);
    const el = document.getElementById("btn")!;
    mockRect(el, { width: 0, height: 0 });
    Object.defineProperty(el, "checkVisibility", {
      configurable: true,
      value: () => true,
    });

    expect(hitTestElement(el)?.classification).toBe("zero-size");
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
    setHtml(`<div><button id="btn">Go</button></div><div id="overlay"></div>`);
    const el = document.getElementById("btn")!;
    const overlay = document.getElementById("overlay")!;
    mockRect(el, { width: 100, height: 40, left: 10, top: 10 });
    vi.spyOn(document, "elementFromPoint").mockReturnValue(overlay);

    const result = hitTestElement(el);

    expect(result?.classification).toBe("fully-occluded");
    expect(result?.pointsPassed).toBe(0);
  });

  it("classifies partially-targetable at Apty's 6 of 9 points", () => {
    setHtml(`<div><button id="btn">Go</button></div><div id="overlay"></div>`);
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

  it("reads 5 of 9 points as mostly occluded, below Apty's threshold", () => {
    setHtml(`<div><button id="btn">Go</button></div><div id="overlay"></div>`);
    const el = document.getElementById("btn")!;
    const overlay = document.getElementById("overlay")!;
    mockRect(el, { width: 100, height: 40, left: 10, top: 10 });
    let call = 0;
    vi.spyOn(document, "elementFromPoint").mockImplementation(() => {
      call++;
      return call <= 5 ? el : overlay;
    });

    expect(hitTestElement(el)?.classification).toBe("mostly-occluded");
  });

  it("counts a sibling inside the element's own parent as the element, as Apty does for a field's trigger icon", () => {
    setHtml(
      `<div class="lookup"><input id="field"><span id="icon"></span></div>`,
    );
    const el = document.getElementById("field")!;
    const icon = document.getElementById("icon")!;
    mockRect(el, { width: 100, height: 40, left: 10, top: 10 });
    vi.spyOn(document, "elementFromPoint").mockReturnValue(icon);

    expect(hitTestElement(el)?.classification).toBe("fully-targetable");
  });

  it("samples the centres of a 3x3 grid", () => {
    setHtml(`<button id="btn">Go</button>`);
    const el = document.getElementById("btn")!;
    mockRect(el, { width: 90, height: 30, left: 0, top: 0 });
    const points: Array<[number, number]> = [];
    vi.spyOn(document, "elementFromPoint").mockImplementation((x, y) => {
      points.push([x, y]);
      return el;
    });

    hitTestElement(el);

    expect(points.map(([x]) => x).slice(0, 3)).toEqual([15, 45, 75]);
    expect([...new Set(points.map(([, y]) => y))]).toEqual([5, 15, 25]);
  });

  it("looks through Apty's own layers to the element below", () => {
    setHtml(
      `<div><button id="btn">Go</button></div><apty-widget id="w"></apty-widget>`,
    );
    const el = document.getElementById("btn")!;
    const widget = document.getElementById("w")!;
    mockRect(el, { width: 100, height: 40, left: 10, top: 10 });
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [widget, el],
    });
    try {
      expect(hitTestElement(el)?.classification).toBe("fully-targetable");
    } finally {
      delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
    }
  });

  it("passes a point where nothing is hit, as Apty does", () => {
    setHtml(`<div><button id="btn">Go</button></div>`);
    const el = document.getElementById("btn")!;
    mockRect(el, { width: 100, height: 40, left: 10, top: 10 });
    vi.spyOn(document, "elementFromPoint").mockReturnValue(null);

    expect(hitTestElement(el)?.pointsPassed).toBe(9);
  });

  it("treats a transparent element as hidden", () => {
    setHtml(`<button id="btn" style="opacity: 0">Go</button>`);
    const el = document.getElementById("btn")!;
    mockRect(el, { width: 100, height: 40, left: 10, top: 10 });

    expect(hitTestElement(el)?.classification).toBe("hidden");
  });
});
