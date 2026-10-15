/**
 * S7: a rate limit before any output is retried, and the person sees the
 * reply instead of an error.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  chatAndWait,
  launchBrowser,
  openSidePanel,
  startMockModel,
  startPageServer,
} from "./harness.mjs";

let browser;
let model;
let site;

before(async () => {
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
});

describe("LLM retry", () => {
  it("retries one 429 and shows the reply", async () => {
    model.script((_request, count) =>
      count === 1
        ? { error: { status: 429, message: "Rate limit reached" } }
        : { text: "RESULT: answered after a retry" },
    );
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);

    const reply = await chatAndWait(panel, "Say hello", { timeout: 30_000 });

    assert.match(reply, /answered after a retry/);
    assert.equal(model.requests.length, 2);
    assert.equal(await panel.getByText(/Something went wrong/).count(), 0);
    await panel.close();
    await app.close();
  });
});
