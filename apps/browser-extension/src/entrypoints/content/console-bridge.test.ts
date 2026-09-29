import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The bridge installs itself once per frame and exposes only a
 * non-configurable read function (see console-bridge.ts) — there is no
 * supported way to reset/reinstall it once loaded. All tests therefore
 * share one installed instance (`beforeAll`, not `beforeEach`) and use a
 * unique marker string per test to find their own entries rather than
 * asserting on the whole buffer, since entries accumulate across tests.
 */

function readBuffer(): any[] {
  const read = (window as any).__aptyReadConsoleBuffer;
  return typeof read === "function" ? read() : [];
}

function entriesFor(marker: string): any[] {
  return readBuffer().filter((e) => e.message.includes(marker));
}

describe("Apty console bridge (MAIN world)", () => {
  let originalConsole: Partial<Console>;

  beforeAll(async () => {
    originalConsole = { ...console };
    await import("./console-bridge");
  });

  afterAll(() => {
    Object.assign(console, originalConsole);
  });

  it("exposes a non-enumerable, non-writable, non-configurable read function instead of a forgeable buffer property", () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      window,
      "__aptyReadConsoleBuffer",
    );
    expect(descriptor?.writable).toBe(false);
    expect(descriptor?.enumerable).toBe(false);
    expect(descriptor?.configurable).toBe(false);
    expect(typeof descriptor?.value).toBe("function");

    expect(() => {
      (window as any).__aptyReadConsoleBuffer = () => [
        {
          level: "error",
          message: "FORGED",
          timestamp: 0,
          source: "console",
        },
      ];
    }).toThrow();
  });

  it("captures an Error's message and stack via console.error, not '{}'", () => {
    console.error(new Error("boom-marker"));
    const [entry] = entriesFor("boom-marker");
    expect(entry).toBeDefined();
    expect(entry.message).not.toBe("{}");
    expect(entry.message).toContain("boom-marker");
  });

  it("never produces an empty string for an undefined argument", () => {
    console.log("undef-marker", undefined);
    const [entry] = entriesFor("undef-marker");
    expect(entry.message).toContain("undefined");
  });

  it("serializes a Map's real entries instead of '{}'", () => {
    console.log("map-marker", new Map([["a", 1]]));
    const [entry] = entriesFor("map-marker");
    expect(entry.message).not.toContain("{}");
    expect(entry.message).toContain("a");
    expect(entry.message).toContain("1");
  });

  it("formats a circular object as [Circular], not '[object Object]', and never throws", () => {
    const circular: any = { marker: "circular-marker" };
    circular.self = circular;
    expect(() => console.log(circular)).not.toThrow();
    const [entry] = entriesFor("circular-marker");
    expect(entry.message).toContain("[Circular]");
    expect(entry.message).not.toBe("[object Object]");
  });

  it("never throws on a null-prototype circular object", () => {
    const nullProtoCircular: any = Object.create(null);
    nullProtoCircular.marker = "null-proto-marker";
    nullProtoCircular.self = nullProtoCircular;
    expect(() => console.log(nullProtoCircular)).not.toThrow();
    expect(entriesFor("null-proto-marker").length).toBeGreaterThan(0);
  });

  it("truncates a very large string instead of storing it whole", () => {
    const huge = "z".repeat(20_000);
    console.log("huge-marker", huge);
    const [entry] = entriesFor("huge-marker");
    expect(entry.message.length).toBeLessThan(huge.length);
  });

  it("captures a failing console.assert but not a passing one", () => {
    console.assert(false, "assert-fail-marker");
    console.assert(true, "assert-pass-marker");
    expect(entriesFor("assert-fail-marker")).toHaveLength(1);
    expect(entriesFor("assert-fail-marker")[0].level).toBe("assert");
    expect(entriesFor("assert-pass-marker")).toHaveLength(0);
  });

  it("captures console.table and console.dir via safe serialization", () => {
    console.table({ dirTableMarker: 1 });
    console.dir({ dirTableMarker: 2 });
    expect(entriesFor("dirTableMarker").length).toBeGreaterThanOrEqual(2);
  });

  it("captures a resource load failure (e.g. an <img> 404) via the capturing error listener", () => {
    const img = document.createElement("img");
    img.src = "https://example.com/resource-marker.png";
    document.body.appendChild(img);
    img.dispatchEvent(new Event("error"));

    const [entry] = entriesFor("resource-marker");
    expect(entry).toBeDefined();
    expect(entry.source).toBe("resource-error");
  });

  it("captures an unhandled promise rejection with proper Error serialization", () => {
    const event = new Event("unhandledrejection") as unknown as {
      reason: unknown;
    };
    (event as any).reason = new Error("unhandled-rejection-marker");
    window.dispatchEvent(event as unknown as Event);

    const [entry] = entriesFor("unhandled-rejection-marker");
    expect(entry).toBeDefined();
    expect(entry.source).toBe("unhandled-rejection");
    expect(entry.message).not.toBe("{}");
  });

  it("captures a CSP violation via the securitypolicyviolation listener", () => {
    const event = new Event("securitypolicyviolation") as any;
    event.violatedDirective = "script-src";
    event.blockedURI = "https://csp-marker.example.com/evil.js";
    event.effectiveDirective = "script-src";
    window.dispatchEvent(event);

    const [entry] = entriesFor("csp-marker");
    expect(entry).toBeDefined();
    expect(entry.source).toBe("csp-violation");
  });

  it("coalesces consecutive duplicate log lines with a repeat count instead of storing each one", () => {
    for (let i = 0; i < 5; i++) console.log("dup-marker");
    const matches = entriesFor("dup-marker");
    expect(matches).toHaveLength(1);
    expect(matches[0].repeat).toBe(5);
  });

  it("does not double-wrap console methods if the script is injected twice in one frame", async () => {
    vi.resetModules();
    await import("./console-bridge");
    console.log("no-double-wrap-marker");
    expect(entriesFor("no-double-wrap-marker")).toHaveLength(1);
  });

  it("assigns a strictly increasing seq to each new entry", () => {
    console.log("seq-marker-a");
    console.log("seq-marker-b");
    const a = entriesFor("seq-marker-a")[0];
    const b = entriesFor("seq-marker-b")[0];
    expect(b.seq).toBeGreaterThan(a.seq);
  });
});
