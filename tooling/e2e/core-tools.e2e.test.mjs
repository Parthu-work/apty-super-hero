/**
 * Everyday agent tools, end to end in a real browser, to show they behave
 * the same as before: find and click an element, read page metadata,
 * scroll and highlight, take a screenshot, and read the page's console and
 * network activity. Runs against any build (E2E_EXTENSION_DIR), so the
 * same checks can be compared with main.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  chatAndWait,
  launchBrowser,
  openSidePanel,
  startMockModel,
  startPageServer,
  toolResults,
} from "./harness.mjs";

const APP = `<!doctype html><title>Orders</title>
<h1>Orders</h1>
<button id="save" onclick="document.title = 'SAVED'">Save order</button>
<div style="height: 3000px"></div>
<p id="footer">Footer</p>
<script>
  // After load: output written while the page is still loading is not
  // captured yet (the console bridge loads asynchronously, on main too).
  setTimeout(() => console.log("core-log-marker"), 300);
  setInterval(() => fetch("/api/orders.json").catch(() => {}), 200);
</script>`;

let browser;
let model;
let site;

before(async () => {
  model = await startMockModel();
  site = await startPageServer({
    "/orders.html": APP,
    "/api/orders.json": JSON.stringify({ orders: [] }),
  });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

/**
 * Run `steps` as consecutive tool calls in one chat turn. Each step is
 * `(previousResults) => ({ tool, args })`. Resolves with every tool result.
 */
async function runSteps(prompt, steps) {
  const app = await browser.context.newPage();
  await app.goto(`${site.origin}/orders.html`);
  const panel = await openSidePanel(browser, model, app);
  model.script((request) => {
    const results = toolResults(request);
    const step = steps[results.length]?.(results);
    if (!step) return { text: "RESULT: done" };
    const offered = (request.tools ?? []).map((t) => t.function.name);
    if (!offered.includes(step.tool)) {
      return { text: `RESULT: ${step.tool} was not offered for this request` };
    }
    return step;
  });
  await chatAndWait(panel, prompt, { timeout: 120_000 });
  const results = toolResults(model.requests.at(-1));
  assert.equal(
    results.length,
    steps.length,
    await panel.locator("body").innerText(),
  );
  const errors = panel.consoleErrors;
  await panel.close();
  return { app, results, errors };
}

function findUid(searchResult, label) {
  const text =
    typeof searchResult === "string"
      ? searchResult
      : JSON.stringify(searchResult);
  const line = text.split(/\\n|\n/).find((l) => l.includes(label));
  return line?.match(/uid=([\w-]+)/)?.[1] ?? line?.match(/\[([\w-]+)\]/)?.[1];
}

describe("everyday tools in a real browser", () => {
  it("finds and clicks an element, then reads the page", async () => {
    const { app, results, errors } = await runSteps(
      "on the current tab, click the Save order button, then show the page metadata",
      [
        () => ({ tool: "get_current_tab", args: {} }),
        ([tab]) => ({
          tool: "search_elements",
          args: {
            tabId: tab.tab?.id ?? tab.id,
            query: "Save order",
            contextLevels: 0,
          },
        }),
        ([tab, search]) => ({
          tool: "click",
          args: {
            tabId: tab.tab?.id ?? tab.id,
            uid: findUid(search, "Save order"),
            dblClick: false,
          },
        }),
        () => ({ tool: "get_page_metadata", args: {} }),
      ],
    );

    const [tab, search, click, metadata] = results;
    assert.ok(tab.tab?.id ?? tab.id, JSON.stringify(tab).slice(0, 300));
    assert.ok(
      findUid(search, "Save order"),
      JSON.stringify(search).slice(0, 500),
    );
    assert.notEqual(click.success, false, JSON.stringify(click).slice(0, 300));
    assert.equal(await app.title(), "SAVED");
    assert.match(JSON.stringify(metadata), /SAVED|Orders/);
    assert.deepEqual(errors, []);
    await app.close();
  });

  it("scrolls to and highlights an element, and takes a screenshot", async () => {
    const { app, results } = await runSteps(
      "scroll to the footer, highlight it and screenshot",
      [
        () => ({ tool: "scroll_to_element", args: { selector: "#footer" } }),
        () => ({
          tool: "highlight_element",
          args: {
            selector: "#footer",
            color: "#ff0000",
            duration: 500,
            intensity: "normal",
            persist: false,
          },
        }),
        () => ({ tool: "capture_screenshot", args: { sendToLLM: false } }),
      ],
    );

    const [scrolled, highlighted, screenshot] = results;
    assert.notEqual(
      scrolled.success,
      false,
      JSON.stringify(scrolled).slice(0, 300),
    );
    assert.notEqual(
      highlighted.success,
      false,
      JSON.stringify(highlighted).slice(0, 300),
    );
    assert.ok(
      await app.evaluate(() => window.scrollY > 1000),
      "page did not scroll",
    );
    assert.notEqual(
      screenshot.success,
      false,
      JSON.stringify(screenshot).slice(0, 300),
    );
    await app.close();
  });

  it("reads the page's console output and network activity", async () => {
    const { app, results } = await runSteps(
      "check the apty page logs, the console log and the network request activity",
      [
        () => ({
          tool: "get_apty_page_logs",
          args: { limit: 50, minLevel: "log", frames: "all" },
        }),
        () => ({
          tool: "get_network_diagnostics",
          args: { windowMs: 1500, onlyErrors: false },
        }),
        () => ({ tool: "get_runtime_diagnostics", args: { windowMs: 1000 } }),
      ],
    );

    const [logs, network, runtime] = results;
    assert.match(
      JSON.stringify(logs),
      /core-log-marker/,
      JSON.stringify(logs).slice(0, 400),
    );
    assert.match(
      JSON.stringify(network),
      /orders\.json/,
      JSON.stringify(network).slice(0, 400),
    );
    assert.notEqual(
      runtime.available,
      false,
      JSON.stringify(runtime).slice(0, 300),
    );
    await app.close();
  });
});
