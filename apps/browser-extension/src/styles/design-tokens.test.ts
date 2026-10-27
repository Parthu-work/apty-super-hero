import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(__dirname, "tailwind.css"), "utf8");

const NAMES = [
  "bg",
  "surface",
  "surface2",
  "line",
  "line2",
  "ctl",
  "text",
  "text2",
  "text3",
  "accent",
  "accentbg",
  "ok",
  "okbg",
  "warn",
  "warnbg",
  "warnline",
  "bad",
  "badbg",
] as const;

type Palette = Record<(typeof NAMES)[number], string>;

function palette(selector: string): Palette {
  const start = CSS.indexOf(`${selector} {`);
  const block = CSS.slice(start, CSS.indexOf("}", start));
  const found = Object.fromEntries(
    [...block.matchAll(/--ds-([a-z0-9]+):\s*(#[0-9a-f]{6});/gi)].map(
      ([, name, hex]) => [name, hex],
    ),
  );
  return found as Palette;
}

function channel(hex: string, at: number): number {
  const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return (
    0.2126 * channel(hex, 1) +
    0.7152 * channel(hex, 3) +
    0.0722 * channel(hex, 5)
  );
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const SURFACES = ["bg", "surface", "surface2"] as const;

describe.each([
  ["light", ":root"],
  ["dark", ".dark"],
])("design tokens, %s theme", (_theme, selector) => {
  const p = palette(selector);

  it("defines every --ds-* colour as plain hex", () => {
    expect(Object.keys(p).sort()).toEqual([...NAMES].sort());
  });

  it.each([
    "text",
    "text2",
    "text3",
  ] as const)("%s reads at 4.5:1 or more on bg, surface and surface2", (text) => {
    for (const surface of SURFACES) {
      expect(contrast(p[text], p[surface])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("draws control borders (ctl) at 3:1 or more on every surface", () => {
    for (const surface of SURFACES) {
      expect(contrast(p.ctl, p[surface])).toBeGreaterThanOrEqual(3);
    }
  });

  it.each([
    ["accent", "accentbg"],
    ["ok", "okbg"],
    ["warn", "warnbg"],
    ["bad", "badbg"],
  ] as const)("%s reads at 4.5:1 or more on its tint %s", (status, tint) => {
    expect(contrast(p[status], p[tint])).toBeGreaterThanOrEqual(4.5);
  });

  it("labels the primary button (bg on text) at 4.5:1 or more", () => {
    expect(contrast(p.bg, p.text)).toBeGreaterThanOrEqual(4.5);
  });
});
