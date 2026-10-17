#!/usr/bin/env node
/**
 * Renders the owner's icon artwork (an SVG, or a PNG of at least 512×512)
 * into every size the extension and the Chrome Web Store need, with the
 * Chromium the e2e tests already use (R6; no new dependency):
 *
 *   apps/browser-extension/assets/icon16.png, icon48.png, icon128.png
 *   docs/store/assets/store-icon-128.png   (96×96 artwork, 16 px clear margin, as the store asks)
 *   docs/store/assets/promo-440x280.png    (artwork centred on --background)
 *
 * Usage: node tooling/scripts/rasterize-icons.mjs <artwork.svg|png> [--background "#ffffff"] [--out <root>]
 */
import { mkdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { chromiumPath } from "../e2e/harness.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Each output: file, canvas size, artwork size, and whether it has a background. */
export const ICON_OUTPUTS = [
  {
    file: "apps/browser-extension/assets/icon16.png",
    width: 16,
    height: 16,
    art: 16,
  },
  {
    file: "apps/browser-extension/assets/icon48.png",
    width: 48,
    height: 48,
    art: 48,
  },
  {
    file: "apps/browser-extension/assets/icon128.png",
    width: 128,
    height: 128,
    art: 128,
  },
  {
    file: "docs/store/assets/store-icon-128.png",
    width: 128,
    height: 128,
    art: 96,
  },
  {
    file: "docs/store/assets/promo-440x280.png",
    width: 440,
    height: 280,
    art: 160,
    filled: true,
  },
];

const MIME = { ".svg": "image/svg+xml", ".png": "image/png" };

export async function rasterizeIcons(
  artworkPath,
  { background = "#ffffff", outRoot = ROOT } = {},
) {
  const mime = MIME[extname(artworkPath).toLowerCase()];
  if (!mime) throw new Error("The artwork must be an .svg or a .png");
  const dataUrl = `data:${mime};base64,${readFileSync(artworkPath).toString("base64")}`;
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  const written = [];
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const output of ICON_OUTPUTS) {
      await page.setViewportSize({
        width: output.width,
        height: output.height,
      });
      await page.setContent(
        `<!doctype html><html><body style="margin:0;width:${output.width}px;height:${output.height}px;display:flex;align-items:center;justify-content:center;background:${output.filled ? background : "transparent"}"><img src="${dataUrl}" style="width:${output.art}px;height:${output.art}px;object-fit:contain"></body></html>`,
      );
      await page.locator("img").evaluate((img) => img.decode());
      const target = resolve(outRoot, output.file);
      mkdirSync(join(target, ".."), { recursive: true });
      await page.screenshot({ path: target, omitBackground: !output.filled });
      written.push(target);
    }
  } finally {
    await browser.close();
  }
  return written;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const artwork = args.find(
    (arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--"),
  );
  if (!artwork) {
    console.error(
      "Usage: node tooling/scripts/rasterize-icons.mjs <artwork.svg|png> [--background #ffffff] [--out <root>]",
    );
    process.exit(1);
  }
  const written = await rasterizeIcons(resolve(artwork), {
    background: option("--background"),
    outRoot: option("--out") ? resolve(option("--out")) : ROOT,
  });
  for (const file of written) console.log(`✓ ${file}`);
}
