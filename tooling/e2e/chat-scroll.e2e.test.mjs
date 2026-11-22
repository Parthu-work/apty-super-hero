/**
 * KB-RAG K27, U1: a long chat scrolls the same way as a short one. A stored
 * 300-turn chat (KB cards, tool calls, a 40,000-character response, "Why
 * this answer", "Show thinking details") is opened in the side panel at
 * 320, 400 and 480 px, light and dark; after the last input the scroll
 * position holds still for 5 seconds, no ResizeObserver loop error is
 * logged, the message list stays under 15,000 DOM nodes, the p95 time of a
 * scroll or wheel handler is under 8 ms, and Scroll to bottom and Show
 * earlier messages keep the reader's place. No model call.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { longChat } from "./fixtures/long-chat.mjs";
import {
  describeViolations,
  launchBrowser,
  openSidePanel,
  openStoredConversation,
  runAxe,
  startMockModel,
  startPageServer,
} from "./harness.mjs";

let browser;
let model;
let site;

before(async () => {
  model = await startMockModel();
  model.script(() => ({ text: "MODEL WAS CALLED" }));
  site = await startPageServer({
    "/app.html": "<!doctype html><title>App</title><main>FIXTURE app</main>",
  });
  browser = await launchBrowser();
  await browser.context.addInitScript(timeScrollHandlers);
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

/**
 * Runs in every page before its scripts: each `scroll` and `wheel` listener,
 * React's root listeners included, records how long it ran.
 */
function timeScrollHandlers() {
  const TIMED = new Set(["scroll", "wheel"]);
  const wrapped = new WeakMap();
  const times = [];
  globalThis.__aptyScrollHandlerTimes = times;
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (!TIMED.has(type) || typeof listener !== "function") {
      return add.call(this, type, listener, options);
    }
    let timed = wrapped.get(listener);
    if (!timed) {
      timed = function (event) {
        const start = performance.now();
        try {
          return listener.call(this, event);
        } finally {
          times.push(performance.now() - start);
        }
      };
      wrapped.set(listener, timed);
    }
    return add.call(this, type, timed, options);
  };
  EventTarget.prototype.removeEventListener = function (
    type,
    listener,
    options,
  ) {
    return remove.call(this, type, wrapped.get(listener) ?? listener, options);
  };
}

function p95(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
  ];
}

/** scrollTop of the chat's scroller every 100 ms for `ms`. */
async function samples(panel, ms) {
  return panel.evaluate(async (ms) => {
    // The element that scrolls: the conversation's scroller.
    const log = [...document.querySelectorAll('[role="log"] *')].find((el) =>
      ["auto", "scroll"].includes(getComputedStyle(el).overflowY),
    );
    const out = [];
    const end = performance.now() + ms;
    while (performance.now() < end) {
      out.push(log.scrollTop);
      await new Promise((r) => setTimeout(r, 100));
    }
    return out;
  }, ms);
}

describe("a long chat scrolls steadily (KB-RAG K27, U1)", () => {
  for (const width of [320, 400, 480]) {
    for (const theme of ["light", "dark"]) {
      it(`300 turns at ${width} px, ${theme}`, async () => {
        const app = await browser.context.newPage();
        await app.goto(`${site.origin}/app.html`);
        const panel = await openSidePanel(browser, model, app);
        const errors = [];
        panel.on("console", (m) => {
          if (/ResizeObserver loop/.test(m.text())) errors.push(m.text());
        });
        panel.on("pageerror", (e) => {
          if (/ResizeObserver loop/.test(String(e))) errors.push(String(e));
        });
        await panel.setViewportSize({ width, height: 700 });
        await panel.evaluate(
          (t) => chrome.storage.local.set({ apty_theme: t }),
          theme,
        );
        await openStoredConversation(panel, longChat(300));
        await panel.getByText("RESULT 299:").waitFor({ timeout: 60_000 });
        const log = panel.locator('[role="log"]');

        await log.hover();
        await panel.evaluate(() => {
          globalThis.__aptyScrollHandlerTimes.length = 0;
        });
        for (let i = 0; i < 15; i++) await panel.mouse.wheel(0, -600);
        await panel.keyboard.press("PageUp");
        // Playwright returns before Chrome applies a wheel scroll: let the
        // input land, then the page must hold still.
        await panel.waitForTimeout(2000);
        const held = await samples(panel, 5000);
        assert.ok(
          Math.max(...held) - Math.min(...held) <= 1,
          `scrollTop moved after the last input: ${Math.min(...held)} to ${Math.max(...held)}`,
        );
        assert.ok(held[0] > 0, "the reader scrolled up");
        const handlerTimes = await panel.evaluate(() => [
          ...globalThis.__aptyScrollHandlerTimes,
        ]);
        assert.ok(handlerTimes.length > 0, "the scroll handlers ran");
        assert.ok(
          p95(handlerTimes) < 8,
          `p95 scroll handler time ${p95(handlerTimes).toFixed(2)} ms over ${handlerTimes.length} calls`,
        );
        console.log(
          `scroll handlers at ${width} px, ${theme}: p95 ${p95(handlerTimes).toFixed(2)} ms over ${handlerTimes.length} calls`,
        );

        const nodes = await log.evaluate(
          (el) => el.querySelectorAll("*").length,
        );
        assert.ok(nodes < 15_000, `${nodes} DOM nodes under the message list`);

        const earlier = panel.getByRole("button", {
          name: "Show earlier messages",
        });
        await earlier.waitFor();
        await panel.evaluate(() => {
          const el = [...document.querySelectorAll('[role="log"] *')].find(
            (el) => ["auto", "scroll"].includes(getComputedStyle(el).overflowY),
          );
          el.scrollTop = 0;
        });
        const anchor = await panel
          .getByText("RESULT 240:", { exact: false })
          .boundingBox();
        await earlier.click();
        await panel.getByText("RESULT 200:").waitFor({ state: "attached" });
        const after = await panel
          .getByText("RESULT 240:", { exact: false })
          .boundingBox();
        assert.ok(
          Math.abs((after?.y ?? 0) - (anchor?.y ?? 0)) <= 2,
          `Show earlier messages moved the reader: ${anchor?.y} to ${after?.y}`,
        );

        await panel
          .getByRole("button", { name: "Scroll to the latest message" })
          .click();
        await panel.waitForFunction(() => {
          const el = [...document.querySelectorAll('[role="log"] *')].find(
            (el) => ["auto", "scroll"].includes(getComputedStyle(el).overflowY),
          );
          return el.scrollHeight - el.scrollTop - el.clientHeight < 4;
        });
        const bottom = await samples(panel, 1500);
        assert.ok(Math.max(...bottom) - Math.min(...bottom) <= 1);

        // U2: the layer switcher, Copy beside "Why this answer" and Show
        // earlier messages are named, reachable and pass axe in this theme.
        await panel
          .getByRole("button", { name: "Copy why this answer" })
          .last()
          .focus();
        await panel
          .getByRole("group", { name: "Card layers" })
          .last()
          .waitFor();
        const violations = await runAxe(panel);
        assert.deepEqual(violations, [], describeViolations(violations));

        assert.deepEqual(errors, []);
        assert.equal(model.requests.length, 0);
        await panel.close();
        await app.close();
      });
    }
  }
});
