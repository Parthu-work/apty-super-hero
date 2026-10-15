/** R6: the icon rasteriser renders every size from one artwork, in Chromium. */
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { ICON_OUTPUTS, rasterizeIcons } from "../scripts/rasterize-icons.mjs";
import { tempDir } from "./harness.mjs";

const out = tempDir("apty-icons-");
after(() => rmSync(out, { recursive: true, force: true }));

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path) {
  const png = readFileSync(path);
  assert.equal(png.toString("ascii", 1, 4), "PNG", path);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe("rasterize-icons", () => {
  it("writes every icon and store image at its exact size", async () => {
    const artwork = join(out, "art.svg");
    writeFileSync(
      artwork,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle cx="256" cy="256" r="240" fill="#2563eb"/></svg>',
    );

    const written = await rasterizeIcons(artwork, { outRoot: out });

    assert.equal(written.length, ICON_OUTPUTS.length);
    for (const output of ICON_OUTPUTS) {
      assert.deepEqual(pngSize(join(out, output.file)), {
        width: output.width,
        height: output.height,
      });
    }
  });

  it("refuses artwork that is neither SVG nor PNG", async () => {
    const artwork = join(out, "art.gif");
    writeFileSync(artwork, "GIF89a");

    await assert.rejects(
      rasterizeIcons(artwork, { outRoot: out }),
      /\.svg or a \.png/,
    );
  });
});
