/**
 * R6: five 1280×800 Chrome Web Store screenshots of the real, built
 * extension (no stubs), driven by the mock model on a synthetic demo
 * application, so no customer data can appear. Scenes with the side panel
 * put the demo page (860 px) and the panel (420 px) side by side, as Chrome
 * shows them. Run through `node tooling/e2e/screenshot-harness.mjs --store`
 * after `npm run build`; writes docs/store/screenshots/*.png.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chatAndWait,
  extensionPage,
  launchBrowser,
  openSidePanel,
  openToolPage,
  startMockModel,
  startPageServer,
  toolResults,
} from "./harness.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const STORE_SCREENSHOT_DIR = join(ROOT, "docs/store/screenshots");
const WIDTH = 1280;
const HEIGHT = 800;
const PAGE_WIDTH = 860;
const PANEL_WIDTH = WIDTH - PAGE_WIDTH;

const ORDERS = [
  ["PO-1001", "Northwind Supplies", "Received", "$1,240.00"],
  ["PO-1002", "Contoso Hardware", "Awaiting approval", "$860.50"],
  ["PO-1003", "Fabrikam Paper", "Draft", "$312.75"],
  ["PO-1004", "Litware Office", "Received", "$2,045.10"],
];

const DEMO_APP = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Acme Orders (demo)</title>
<style>
  body { margin: 0; font: 14px system-ui, sans-serif; color: #1f2937; background: #f8fafc; }
  header { background: #1e3a8a; color: #fff; padding: 14px 24px; font-weight: 600; font-size: 16px; }
  main { padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  form { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
  label { display: grid; gap: 4px; font-size: 12px; color: #4b5563; }
  input, select { font: inherit; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px; }
  button { grid-column: span 2; justify-self: start; padding: 8px 16px; border: 0; border-radius: 6px; background: #94a3b8; color: #fff; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
  th { font-size: 12px; color: #6b7280; text-transform: uppercase; }
</style></head><body>
<header>Acme Orders · demo tenant</header>
<main>
  <h1>New purchase order</h1>
  <form>
    <label>Supplier<select id="supplier"><option>Northwind Supplies</option></select></label>
    <label>Cost centre<input id="cost-centre" placeholder="Required"></label>
    <label>Amount<input id="amount" value="480.00"></label>
    <label>Needed by<input id="needed-by" value="2026-11-02"></label>
    <button type="submit" id="submit" disabled>Submit order</button>
  </form>
  <table><thead><tr><th>Order</th><th>Supplier</th><th>Status</th><th>Total</th></tr></thead><tbody>
  ${ORDERS.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}
  </tbody></table>
</main></body></html>`;

const CHAT_ANSWER = [
  "The **Submit order** button is disabled because the required **Cost centre** field is empty.",
  "",
  "- `#submit` has the `disabled` attribute and no click handler fires.",
  "- `#cost-centre` is the only empty required field in the form.",
  "",
  "Fill in a cost centre and the button becomes clickable.",
].join("\n");

async function shot(page, width) {
  await page.setViewportSize({ width, height: HEIGHT });
  // Let the page lay out at the new size before capturing it.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 300))),
  );
  return (await page.screenshot()).toString("base64");
}

/** Lay the demo page and the side panel side by side in one 1280×800 image. */
async function compose(browser, file, appPng, panelPng) {
  const canvas = await browser.context.newPage();
  // Taller than the image, clipped below: the bottom rows of a viewport the
  // exact image height sometimes repeated the top.
  await canvas.setViewportSize({ width: WIDTH, height: HEIGHT + 200 });
  await canvas.setContent(
    `<!doctype html><body style="margin:0;display:flex;width:${WIDTH}px;height:${HEIGHT}px;background:#e5e7eb">
     <img src="data:image/png;base64,${appPng}" style="width:${PAGE_WIDTH}px;height:${HEIGHT}px">
     <img src="data:image/png;base64,${panelPng}" style="width:${PANEL_WIDTH}px;height:${HEIGHT}px;border-left:1px solid #cbd5e1;box-sizing:border-box">
     </body>`,
  );
  await canvas.waitForFunction(() =>
    [...document.images].every((img) => img.complete && img.naturalWidth > 0),
  );
  await canvas.screenshot({
    path: join(STORE_SCREENSHOT_DIR, file),
    clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
  });
  await canvas.close();
}

export async function captureStoreScreenshots() {
  mkdirSync(STORE_SCREENSHOT_DIR, { recursive: true });
  const model = await startMockModel();
  const site = await startPageServer({ "/orders.html": DEMO_APP });
  // Taller than the 1280×720 default, so an 800 px viewport renders whole.
  const browser = await launchBrowser({
    extraArgs: ["--window-size=1400,1000"],
  });
  const written = [];
  try {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/orders.html`);
    const tabId = await browser.agentWorker.evaluate(
      async (url) => (await chrome.tabs.query({ url })).at(0)?.id,
      `${site.origin}/orders.html`,
    );

    // 1. A question answered from the page.
    model.script((request) =>
      toolResults(request).length === 0
        ? { tool: "search_elements", args: { tabId, query: "*Submit*" } }
        : { text: CHAT_ANSWER },
    );
    let panel = await openSidePanel(browser, model, app);
    await chatAndWait(panel, "Why can't I click Submit order on this page?", {
      pattern: /Submit order/,
    });
    await panel.waitForTimeout(500);
    await compose(
      browser,
      "01-ask-about-the-page.png",
      await shot(app, PAGE_WIDTH),
      await shot(panel, PANEL_WIDTH),
    );
    written.push("01-ask-about-the-page.png");
    await panel.close();

    // 2. An approval prompt before the agent opens a tab on another site.
    model.script((request) =>
      toolResults(request).length === 0
        ? {
            tool: "create_new_tab",
            args: { url: "https://supplier-portal.example/orders/PO-1002" },
          }
        : { text: "I didn't open the supplier portal." },
    );
    panel = await openSidePanel(browser, model, app);
    await chatAndWait(
      panel,
      "open the supplier portal for PO-1002 in a new tab",
      {
        pattern: /didn't open/,
        whileWaiting: async () => {
          const prompt = panel.getByRole("alertdialog");
          await prompt.waitFor({ timeout: 30_000 });
          await compose(
            browser,
            "02-approval-prompt.png",
            await shot(app, PAGE_WIDTH),
            await shot(panel, PANEL_WIDTH),
          );
          written.push("02-approval-prompt.png");
          await prompt.getByRole("button", { name: "Deny" }).click();
        },
      },
    );
    await panel.close();

    // 3. A DOM health check of the page.
    panel = await openSidePanel(browser, model, app);
    await openToolPage(panel, "DOM health");
    await panel.getByRole("button", { name: "Check this page" }).click();
    await panel
      .getByRole("button", { name: "Full breakdown" })
      .waitFor({ timeout: 60_000 });
    await panel.waitForTimeout(1000);
    await compose(
      browser,
      "03-dom-health.png",
      await shot(app, PAGE_WIDTH),
      await shot(panel, PANEL_WIDTH),
    );
    written.push("03-dom-health.png");
    await panel.close();

    // 4 and 5. Settings: data handling, then the AI provider, with no
    // provider configured (the mock one is a test detail).
    await browser.agentWorker.evaluate(() =>
      chrome.storage.local.remove("apty_settings"),
    );
    for (const [file, path] of [
      [
        "04-data-handling.png",
        "src/entrypoints/options/index.html?tab=general#data-handling",
      ],
      ["05-ai-provider.png", "src/entrypoints/options/index.html?tab=ai"],
    ]) {
      const options = await extensionPage(browser, path);
      await options.setViewportSize({ width: WIDTH, height: HEIGHT });
      await options.waitForLoadState("networkidle");
      await options.waitForTimeout(800);
      await options.screenshot({ path: join(STORE_SCREENSHOT_DIR, file) });
      written.push(file);
      await options.close();
    }
    await app.close();
  } finally {
    await browser.close();
    site.close();
    model.close();
  }
  return written.map((file) => join(STORE_SCREENSHOT_DIR, file));
}

/** Width and height of a PNG, from its IHDR chunk. */
export function pngSize(path) {
  const png = readFileSync(path);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
