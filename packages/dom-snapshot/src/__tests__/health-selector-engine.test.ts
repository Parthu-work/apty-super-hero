import { beforeEach, describe, expect, it } from "vitest";
import { resolveElement } from "../health-selector-engine";

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
    expect(result.bestSelector).toBe("#save-button");
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

    const result = resolveElement(document, el);

    expect(result.outcome).toBe("RECOVERED_BY_PARTIAL");
    expect(result.bestSelector).toContain("app-wrapper");
  });

  it("never builds a partial candidate from a value with no safe stable prefix", () => {
    setHtml(`<div id="382910192">A</div>`);
    const el = document.querySelector("div")!;

    const result = resolveElement(document, el);

    expect(result.outcome).not.toBe("RECOVERED_BY_PARTIAL");
  });
});

describe("resolveElement — contextual (ancestor) recovery", () => {
  it("climbs to a stable ancestor when the element itself has no identifying attribute", () => {
    setHtml(`
      <div id="toolbar">
        <button>First</button>
        <button>Second</button>
      </div>
    `);
    const el = document.querySelectorAll("button")[1]!;

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

describe("resolveElement — shadow DOM scoping", () => {
  it("resolves an element inside an open shadow root against the shadow root, not the document", () => {
    setHtml(`<div id="host"></div>`);
    const host = document.getElementById("host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<button id="shadow-btn">Go</button>`;
    const el = shadow.querySelector("button")!;

    const result = resolveElement(shadow, el);

    expect(result.outcome).toBe("DIRECT_SUCCESS");
    expect(result.bestSelector).toBe("#shadow-btn");
  });
});
