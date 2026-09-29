import { describe, expect, it } from "vitest";
import { capEntryLength, formatConsoleArgs, safeSerialize } from "./serialize";

describe("safeSerialize — WP5 regression table (each row was broken/dangerous before this rewrite)", () => {
  it("serializes an Error with its message and stack, never '{}'", () => {
    const err = new Error("boom");
    const output = safeSerialize(err);
    expect(output).toContain("boom");
    expect(output).not.toBe("{}");
  });

  it("serializes an Error's cause chain, bounded", () => {
    const root = new Error("root cause");
    const wrapped = new Error("outer", { cause: root });
    const output = safeSerialize(wrapped);
    expect(output).toContain("outer");
    expect(output).toContain("root cause");
  });

  it("never produces an empty string for undefined/function/symbol", () => {
    expect(safeSerialize(undefined)).toBe("undefined");
    expect(safeSerialize(null)).toBe("null");
    expect(safeSerialize(() => {})).toContain("[Function");
    expect(safeSerialize(Symbol("x"))).toContain("Symbol");
  });

  it("serializes a Map with real entries, never '{}'", () => {
    const m = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    const output = safeSerialize(m);
    expect(output).toContain("a => 1");
    expect(output).toContain("b => 2");
    expect(output).not.toBe("{}");
  });

  it("serializes a Set with real entries", () => {
    const output = safeSerialize(new Set([1, 2, 3]));
    expect(output).toContain("1");
    expect(output).toContain("2");
    expect(output).toContain("3");
  });

  it("serializes a circular object with a marker, never '[object Object]'", () => {
    const circular: Record<string, unknown> = { name: "a" };
    circular.self = circular;
    const output = safeSerialize(circular);
    expect(output).toContain("[Circular]");
    expect(output).not.toBe("[object Object]");
  });

  it("never throws on a null-prototype circular object", () => {
    const nullProtoCircular: Record<string, unknown> = Object.create(null);
    nullProtoCircular.name = "b";
    nullProtoCircular.self = nullProtoCircular;
    expect(() => safeSerialize(nullProtoCircular)).not.toThrow();
    const output = safeSerialize(nullProtoCircular);
    expect(output).toContain("[Circular]");
  });

  it("truncates a very large string rather than storing it whole", () => {
    const huge = "x".repeat(5_000_000);
    const output = safeSerialize(huge);
    expect(output.length).toBeLessThan(5_000_000);
    expect(output).toContain("chars");
  });

  it("never invokes a getter (which may throw or have side effects)", () => {
    let getterCalled = false;
    const obj = {
      safe: "value",
      get dangerous() {
        getterCalled = true;
        throw new Error("should never be called");
      },
    };
    const output = safeSerialize(obj);
    expect(getterCalled).toBe(false);
    expect(output).toContain("safe: value");
    expect(output).toContain("dangerous: [Getter]");
  });

  it("is Proxy-safe — a Proxy that throws on every trap degrades to a placeholder, never throws", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("trap");
        },
        ownKeys() {
          throw new Error("trap");
        },
        getOwnPropertyDescriptor() {
          throw new Error("trap");
        },
      },
    );
    expect(() => safeSerialize(hostile)).not.toThrow();
  });

  it("formats a DOM-node-shaped object as <tag#id.class>", () => {
    const fakeNode = {
      nodeType: 1,
      nodeName: "DIV",
      tagName: "DIV",
      id: "main",
      className: "foo bar",
    };
    expect(safeSerialize(fakeNode)).toBe("<div#main.foo.bar>");
  });

  it("bounds depth, key count, and array length", () => {
    const deep = { a: { b: { c: { d: { e: "too deep" } } } } };
    expect(safeSerialize(deep)).not.toContain("too deep");

    const manyKeys: Record<string, number> = {};
    for (let i = 0; i < 50; i++) manyKeys[`k${i}`] = i;
    expect(safeSerialize(manyKeys)).toContain("more keys");

    const bigArray = Array.from({ length: 50 }, (_, i) => i);
    expect(safeSerialize(bigArray)).toContain("more");
  });
});

describe("formatConsoleArgs — printf-style specifiers", () => {
  it("substitutes %s %d %i %f %o %O %j", () => {
    expect(formatConsoleArgs(["%s is %d years old", "Al", 30])).toBe(
      "Al is 30 years old",
    );
    expect(formatConsoleArgs(["%f", 3.14])).toBe("3.14");
    expect(formatConsoleArgs(["%o", { a: 1 }])).toBe("{a: 1}");
    expect(formatConsoleArgs(["%j", { a: 1 }])).toBe('{"a":1}');
  });

  it("consumes %c and renders no visible text for it", () => {
    expect(formatConsoleArgs(["hello %cworld", "color: red"])).toBe(
      "hello world",
    );
  });

  it("falls back to space-joined serialization when there's no format string", () => {
    expect(formatConsoleArgs(["hello", "world"])).toBe("hello world");
    expect(formatConsoleArgs([{ a: 1 }, [1, 2]])).toBe("{a: 1} [1, 2]");
  });

  it("never throws on hostile arguments", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("trap");
        },
      },
    );
    expect(() => formatConsoleArgs(["%o", hostile])).not.toThrow();
  });
});

describe("capEntryLength", () => {
  it("caps an over-long message", () => {
    const output = capEntryLength("x".repeat(5000));
    expect(output.length).toBeLessThan(5000);
  });

  it("leaves a short message untouched", () => {
    expect(capEntryLength("hello")).toBe("hello");
  });
});
