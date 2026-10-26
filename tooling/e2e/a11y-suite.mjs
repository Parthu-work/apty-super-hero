/**
 * Accessibility (C3): axe-core on the real side panel and Options page, in
 * light and dark themes. Fails on any `serious` or `critical` violation; no
 * axe rule is disabled. The tests are grouped by surface, and each
 * `a11y-<surface>-<theme>.e2e.test.mjs` file runs one group in one theme
 * in its own browser, so no file comes near the 180 s limit:
 *
 * - `panel-home`: the side panel empty and while its settings load, Home
 *   with every suggestion and the "/" list, the menu with its recent chats
 *   loading, loaded (with a chat's site, and its delete confirmation:
 *   Cancel keeps the chat, Delete removes it) and failing to load, Home with
 *   no AI provider and the Connections page with an ID error, and a page the
 *   extension can't inspect (the bar, DOM health and DOM config say why and
 *   their start buttons point at the notice).
 * - `panel-chat`: an approval prompt, an intervention card before and after
 *   an option is chosen, the send button idle, sending, streaming and after
 *   an error, a long chat scrolled up with its scroll-to-bottom button, a
 *   stored chat in every conversation state (Markdown with a table and
 *   code, tool cards pending, failed and completed and then opened, a
 *   refused turn with its details open) under the redaction-off banner, and
 *   a chat with a tool result and the evidence viewers (the investigation
 *   summary and the full response viewer, opened again from a second
 *   inspection that returns the stored evidence).
 * - `investigation`: an investigation made by the real tools in the summary
 *   bar, collapsed and expanded (plan, components, timeline with a likely
 *   related incident, diagnosis), its evidence and probes open, the
 *   composer still in view at 400x500, 400x640 and 400x800, Esc back to
 *   the toggle, and the diagnosis at every confidence.
 * - `dom-config-run`: the DOM Config page idle, running (held on a page
 *   request), with its results and on a page it cannot analyze.
 * - `dom-config-views`: a manual capture with a duplicate warning, an
 *   import error, page detail and the Iframes, Coverage and Warnings views.
 * - `dom-health`: a DOM Health result, its breakdown and settings, and its
 *   export dialog at side-panel size.
 * - `options`: every Options tab at 1280 px, every tab again at 375 px (no
 *   sideways scroll, the tabs stay at the top while the page scrolls, arrow
 *   keys and End move between them), and the widget network calls with a
 *   body open.
 *
 * This module is not a test file itself (its name does not end in
 * `.e2e.test.mjs`).
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { CONVERSATION_STATES } from "./fixtures/conversation-states.mjs";
import { startDomConfigApp } from "./fixtures/dom-config-app.mjs";
import {
  confidenceSteps,
  INVESTIGATION_PAGE,
  INVESTIGATION_PROMPT,
  INVESTIGATION_STEPS,
} from "./fixtures/investigation.mjs";
import {
  AGENT_EXTENSION_ID,
  callToolThenReport,
  chatAndWait,
  describeViolations,
  extensionPage,
  launchBrowser,
  openSidePanel,
  openStoredConversation,
  openToolPage,
  runAxe,
  sendChat,
  startMockModel,
  startPageServer,
  tempDir,
  toolResults,
  unpackedExtensionId,
  writeFakeClient,
} from "./harness.mjs";

const clientDir = writeFakeClient(
  join(tempDir("apty-e2e-a11y-"), "working"),
  "working",
  AGENT_EXTENSION_ID,
);
const CLIENT_ID = unpackedExtensionId(clientDir);

let browser;
let model;
let site;
let domConfigApp;

async function setUp({ connectClient }) {
  model = await startMockModel();
  domConfigApp = await startDomConfigApp();
  site = await startPageServer({
    "/app.html": "<title>App</title><main><h1>App</h1></main>",
    "/form.html":
      '<title>Form</title><main><h1>Orders</h1><form><input name="order" aria-label="Order"><button type="button">Find</button></form></main>',
    "/investigation.html": INVESTIGATION_PAGE,
  });
  browser = await launchBrowser({ extraExtensions: [clientDir] });
  if (!connectClient) return;
  const options = await extensionPage(browser);
  await options.getByRole("tab", { name: "Connection" }).click();
  await options.getByLabel("Extension ID").fill(CLIENT_ID);
  await options
    .getByLabel("Extension ID")
    .locator("..")
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await options.getByText("Answering").waitFor({ timeout: 30_000 });
  await options.close();
}

async function tearDown() {
  await browser?.close();
  model?.close();
  site?.close();
  domConfigApp?.close();
}

async function setTheme(theme) {
  const page = await extensionPage(browser);
  await page.evaluate(
    (t) => chrome.storage.local.set({ apty_theme: t }),
    theme,
  );
  await page.close();
}

async function assertThemeApplied(page, theme) {
  await page.waitForFunction(
    (dark) => document.documentElement.classList.contains("dark") === dark,
    theme === "dark",
  );
}

/** Chrome's side panel at its default width, on a short laptop screen. */
const SIDE_PANEL = { width: 400, height: 600 };

async function assertInViewport(locator) {
  const box = await locator.boundingBox();
  const { height, width } = SIDE_PANEL;
  assert.ok(
    box &&
      box.y >= 0 &&
      box.y + box.height <= height &&
      box.x + box.width <= width,
    `${await locator.innerText()} is outside the panel: ${JSON.stringify(box)}`,
  );
}

async function assertNoSeriousViolations(page, where) {
  const violations = await runAxe(page);
  assert.deepEqual(
    violations.map((v) => v.id),
    [],
    `${where}:\n${describeViolations(violations)}`,
  );
}

/** Runs in the panel before its own scripts: the conversations database never opens, so the menu's recent chats stay loading. */
function holdConversationHistory() {
  const open = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (name, ...rest) {
    if (name !== "apty-conversations-db") return open.call(this, name, ...rest);
    globalThis.__conversationHistoryHeld = true;
    return new EventTarget();
  };
}

/** Runs in the panel before its own scripts: the conversations database can't be opened, so the menu can't load its recent chats. */
function failConversationHistory() {
  const open = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (name, ...rest) {
    if (name !== "apty-conversations-db") return open.call(this, name, ...rest);
    throw new DOMException("Blocked by the test", "UnknownError");
  };
}

/** Runs in the panel before its own scripts: its settings never load, so it stays on its boot skeleton. */
function holdSettings() {
  const get = chrome.storage.local.get.bind(chrome.storage.local);
  chrome.storage.local.get = (keys, ...rest) => {
    const wanted =
      typeof keys === "string"
        ? [keys]
        : Array.isArray(keys)
          ? keys
          : Object.keys(keys ?? {});
    return wanted.includes("apty_settings")
      ? new Promise(() => {})
      : get(keys, ...rest);
  };
}

const MENU = { name: "Menu", exact: true };

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The side panel on Home, in `theme`. */
async function openPanel(theme) {
  const app = await browser.context.newPage();
  await app.goto(`${site.origin}/app.html`);
  const panel = await openSidePanel(browser, model, app);
  await panel.getByRole("button", MENU).waitFor();
  await assertThemeApplied(panel, theme);
  return { app, panel };
}

// Inspected twice: the second inspection returns the evidence stored by
// the first, and the viewer must still open it.
const VIEWED = { query: "segments.json", shown: "Array(206)" };

/** Sends `prompt` and answers with `steps`' tool calls in order, then "RESULT: done". */
async function scriptedTurn(panel, prompt, steps) {
  model.script(async (request) => {
    const results = toolResults(request);
    const step = await steps[results.length]?.(results);
    if (!step) return { text: "RESULT: done" };
    const offered = (request.tools ?? []).map((t) => t.function.name);
    if (!offered.includes(step.tool)) {
      return { text: `RESULT: ${step.tool} was not offered` };
    }
    return step;
  });
  const reply = await chatAndWait(panel, prompt, { timeout: 120_000 });
  assert.equal(reply, "RESULT: done");
}

/** With the summary expanded, the Send button and 96 px of the chat still fit, once the layout has settled. */
async function assertComposerFits(panel, height) {
  await panel.setViewportSize({ width: 400, height });
  const send = panel.getByRole("button", { name: "Send", exact: true });
  const log = panel.getByRole("log");
  const measure = async () => {
    const button = await send.boundingBox();
    const chat = await log.boundingBox();
    return {
      ok: Boolean(
        button &&
          chat &&
          button.y >= 0 &&
          button.y + button.height <= height &&
          chat.height >= 96,
      ),
      button,
      chat,
    };
  };
  const deadline = Date.now() + 5_000;
  let last = await measure();
  while (!last.ok && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    last = await measure();
  }
  assert.ok(last.ok, `at 400x${height}: ${JSON.stringify(last)}`);
}

/** Each surface's tests, by name; every test takes the theme it runs in. */
const SURFACES = {
  "panel-home": {
    "side panel, empty": async (theme) => {
      const { app, panel } = await openPanel(theme);
      await assertNoSeriousViolations(panel, `${theme} side panel, empty`);
      await panel.close();
      await app.close();
    },
    "side panel, Home with every suggestion and the / list": async (theme) => {
      const { app, panel } = await openPanel(theme);
      await panel.getByRole("button", { name: "See all" }).click();
      await panel
        .getByRole("button", { name: /Generate DOM config: capture/ })
        .waitFor();
      await assertNoSeriousViolations(panel, `${theme} Home, every suggestion`);

      await panel.locator("textarea").first().fill("/");
      await panel
        .getByRole("listbox", { name: "Tools, investigations and skills" })
        .waitFor();
      await assertNoSeriousViolations(panel, `${theme} the / list`);
      await panel.close();
      await app.close();
    },
    "side panel, the menu while its recent chats are still loading": async (
      theme,
    ) => {
      const { app, panel } = await openPanel(theme);
      await panel.addInitScript(holdConversationHistory);
      await panel.reload();
      await panel.getByRole("button", MENU).click();
      const menu = panel.getByRole("dialog", { name: "Menu" });
      await menu.getByRole("button", { name: "New chat" }).waitFor();
      await panel.waitForFunction(() => globalThis.__conversationHistoryHeld);
      await menu.getByText("Recent chats").waitFor();
      assert.equal(
        await menu
          .getByRole("status")
          .filter({ hasText: "Loading..." })
          .count(),
        1,
      );
      await assertNoSeriousViolations(
        panel,
        `${theme} menu, recent chats still loading`,
      );
      await panel.close();
      await app.close();
    },
    "side panel, the menu with a recent chat": async (theme) => {
      const { app, panel } = await openPanel(theme);
      model.script(() => ({ text: "RESULT: the widget is loaded" }));
      await chatAndWait(panel, "is the widget loaded?");
      // New chat saves the conversation before it clears the panel.
      await panel.getByRole("button", { name: "New chat" }).click();
      await panel
        .getByRole("heading", { name: "What are we debugging?" })
        .waitFor();
      await panel.getByRole("button", MENU).click();
      await panel
        .getByRole("dialog", { name: "Menu" })
        .getByRole("button", { name: /^is the widget loaded\?/ })
        .first()
        .waitFor();
      await assertNoSeriousViolations(panel, `${theme} menu, a recent chat`);

      const menu = panel.getByRole("dialog", { name: "Menu" });
      const row = menu
        .getByRole("button", { name: /^is the widget loaded\?/ })
        .first();
      assert.match(await row.innerText(), /127\.0\.0\.1 · Just now/);
      const remove = menu
        .getByRole("button", {
          name: "Delete conversation: is the widget loaded?",
        })
        .first();
      await remove.focus();
      await remove.press("Enter");
      const confirm = panel.getByRole("alertdialog", {
        name: "Delete this chat?",
      });
      await confirm.waitFor();
      assert.equal(
        await confirm
          .getByRole("button", { name: "Cancel" })
          .evaluate((el) => el === document.activeElement),
        true,
      );
      await assertNoSeriousViolations(
        panel,
        `${theme} menu, the delete confirmation`,
      );
      await panel.keyboard.press("Escape");
      await confirm.waitFor({ state: "detached" });
      await row.waitFor();
      await remove.focus();
      await remove.press("Enter");
      await confirm.getByRole("button", { name: "Delete" }).click();
      await confirm.waitFor({ state: "detached" });
      await row.waitFor({ state: "detached" });
      await panel.close();
      await app.close();
    },
    "side panel, the menu when its recent chats can't be loaded": async (
      theme,
    ) => {
      const { app, panel } = await openPanel(theme);
      await panel.addInitScript(failConversationHistory);
      await panel.reload();
      await panel.getByRole("button", MENU).click();
      const menu = panel.getByRole("dialog", { name: "Menu" });
      const failure = menu
        .getByRole("alert")
        .filter({ hasText: "Couldn't load recent chats." });
      await failure.waitFor();
      await failure.getByRole("button", { name: "Retry" }).waitFor();
      await assertNoSeriousViolations(
        panel,
        `${theme} menu, recent chats failed to load`,
      );
      await panel.close();
      await app.close();
    },
    "side panel on a page it can't inspect: the bar, DOM health and DOM config say why":
      async (theme) => {
        const blank = await browser.context.newPage();
        await blank.goto("about:blank");
        const panel = await openSidePanel(browser, model, blank);
        await assertThemeApplied(panel, theme);
        await panel.getByText("This page", { exact: true }).first().waitFor();
        await assertNoSeriousViolations(panel, `${theme} Home, a blank page`);
        for (const tool of ["DOM health", "DOM config"]) {
          await openToolPage(panel, tool);
          const page = panel.getByRole("region", { name: tool, exact: true });
          const notice = page
            .locator('[data-slot="notice"][data-tone="warning"]')
            .first();
          await notice.waitFor();
          const start = page.getByRole("button", {
            name: tool === "DOM health" ? "Check this page" : /^Start capture/,
          });
          assert.equal(await start.isDisabled(), true, `${tool} can start`);
          assert.equal(
            await start.getAttribute("aria-describedby"),
            await notice.getAttribute("id"),
          );
          await assertNoSeriousViolations(
            panel,
            `${theme} ${tool}, a page it can't inspect`,
          );
          // Opened from the menu, so Back returns there first.
          await panel.getByRole("button", { name: "Back" }).click();
          await panel.getByRole("dialog", { name: "Menu" }).waitFor();
          await panel.keyboard.press("Escape");
        }
        await panel.close();
        await blank.close();
      },
    "side panel while its settings load": async (theme) => {
      const { app, panel } = await openPanel(theme);
      await panel.addInitScript(holdSettings);
      await panel.reload();
      await panel
        .getByRole("status")
        .filter({ hasText: "Loading..." })
        .waitFor();
      assert.equal(await panel.locator("textarea").count(), 0);
      await assertNoSeriousViolations(panel, `${theme} side panel, booting`);
      await panel.close();
      await app.close();
    },
    "side panel, Home with no AI provider and the Connections page with an ID error":
      async (theme) => {
        const app = await browser.context.newPage();
        await app.goto(`${site.origin}/app.html`);
        const panel = await openSidePanel(browser, model, app, { aiToken: "" });
        await assertThemeApplied(panel, theme);
        await panel
          .getByRole("button", { name: "Set up AI provider" })
          .waitFor();
        await assertNoSeriousViolations(panel, `${theme} Home, no AI provider`);

        await panel.getByRole("button", { name: "1 to set up" }).click();
        const page = panel.getByRole("region", { name: "Connections" });
        const studio = page.getByRole("region", { name: "Apty Studio" });
        await studio.getByLabel("Extension ID").fill("not-an-id");
        await studio
          .getByRole("button", { name: "Connect Apty Studio" })
          .click();
        await studio.getByText("Enter the full ID.").waitFor();
        await page
          .getByRole("region", { name: "Apty Client" })
          .getByText("Connected", { exact: true })
          .waitFor();
        await assertNoSeriousViolations(
          panel,
          `${theme} Connections, an ID error`,
        );
        await panel.close();
        await app.close();
      },
  },
  "panel-chat": {
    "side panel, an approval prompt": async (theme) => {
      const { app, panel } = await openPanel(theme);
      model.script(
        callToolThenReport("create_new_tab", {
          url: "http://127.0.0.1:9/elsewhere",
        }),
      );
      let checked = false;
      await chatAndWait(panel, "open a new tab at the other site", {
        whileWaiting: async () => {
          await panel
            .getByRole("button", { name: "Deny" })
            .waitFor({ timeout: 30_000 });
          await assertNoSeriousViolations(
            panel,
            `${theme} side panel, approval prompt`,
          );
          checked = true;
          await panel.getByRole("button", { name: "Deny" }).click();
        },
      });
      assert.ok(checked);
      await panel.close();
      await app.close();
    },
    "side panel, an intervention card and its cancel button": async (theme) => {
      const { app, panel } = await openPanel(theme);
      model.script(
        callToolThenReport("request_intervention", {
          type: "user-selection",
          params: {
            reason: null,
            highlightColor: null,
            question: "Which order should I open?",
            options: [
              { id: "a", label: "Order 1001", description: null },
              { id: "b", label: "Order 1002", description: null },
            ],
            mode: "single",
            allowOther: false,
          },
          timeout: 300,
          reason: "Two orders match",
        }),
      );
      let checked = false;
      await chatAndWait(panel, "ask me which order to open", {
        whileWaiting: async () => {
          await panel
            .getByRole("radio", { name: /Order 1001/ })
            .waitFor({ timeout: 30_000 });
          await assertNoSeriousViolations(
            panel,
            `${theme} side panel, intervention card`,
          );
          await panel.getByRole("radio", { name: /Order 1001/ }).check();
          const confirm = panel.getByRole("button", {
            name: "Confirm selection",
          });
          assert.equal(await confirm.isEnabled(), true);
          await assertNoSeriousViolations(
            panel,
            `${theme} side panel, intervention card with an option chosen`,
          );
          checked = true;
          await panel
            .getByRole("button", { name: "Cancel", exact: true })
            .click();
        },
      });
      assert.ok(checked);
      await panel.close();
      await app.close();
    },
    "side panel, the send button idle, sending, streaming and after an error":
      async (theme) => {
        const { app, panel } = await openPanel(theme);
        const named = (name) =>
          panel.getByRole("button", { name, exact: true });
        await named("Send").waitFor();
        await assertNoSeriousViolations(panel, `${theme} send button, idle`);

        const arrived = deferred();
        const answer = deferred();
        const finish = deferred();
        model.script(async () => {
          arrived.resolve();
          await answer.promise;
          return { text: "A reply still streaming", hold: finish.promise };
        });
        await sendChat(panel, "answer slowly");
        await arrived.promise;
        await named("Stop").waitFor();
        await assertNoSeriousViolations(panel, `${theme} send button, sending`);

        answer.resolve();
        await panel.getByText("A reply still streaming").waitFor();
        await named("Stop").waitFor();
        await assertNoSeriousViolations(
          panel,
          `${theme} send button, streaming`,
        );

        finish.resolve();
        await named("Send").waitFor();

        model.script(() => ({
          error: { status: 400, message: "The mock model refused" },
        }));
        await sendChat(panel, "this one fails");
        const failure = panel.getByRole("alert").filter({
          hasText: "Couldn't get an answer",
        });
        await failure.waitFor();
        await failure.getByText("Details").click();
        await failure.getByText(/The mock model refused/).waitFor();
        await failure.getByRole("button", { name: "Retry" }).waitFor();
        assert.equal(
          await named("Send").count(),
          1,
          "after an error the button still sends, so it is named Send",
        );
        await assertNoSeriousViolations(
          panel,
          `${theme} send button, after an error`,
        );
        await panel.close();
        await app.close();
      },
    "side panel, a long chat scrolled up, with its scroll-to-bottom button":
      async (theme) => {
        const { app, panel } = await openPanel(theme);
        const lines = Array.from(
          { length: 60 },
          (_, i) => `Line ${i + 1} of a long answer.`,
        );
        model.script(() => ({ text: lines.join("\n\n") }));
        await sendChat(panel, "give me a long answer");
        await panel.getByText(lines.at(-1)).waitFor();
        await panel
          .getByRole("button", { name: "Send", exact: true })
          .waitFor();

        await panel.getByRole("log").hover();
        await panel.mouse.wheel(0, -5000);
        const scrollDown = panel.getByRole("button", {
          name: "Scroll to the latest message",
        });
        await scrollDown.waitFor();
        await assertNoSeriousViolations(
          panel,
          `${theme} side panel, long chat scrolled up`,
        );
        await scrollDown.click();
        await scrollDown.waitFor({ state: "detached" });
        await panel.close();
        await app.close();
      },
    "side panel, a stored chat in every conversation state, with redaction off":
      async (theme) => {
        const app = await browser.context.newPage();
        await app.goto(`${site.origin}/app.html`);
        const panel = await openSidePanel(browser, model, app, {
          redactionMode: "off",
        });
        await assertThemeApplied(panel, theme);
        await openStoredConversation(panel, CONVERSATION_STATES);
        const failure = panel
          .getByRole("alert")
          .filter({ hasText: "Couldn't get an answer" });
        await failure.waitFor();
        await panel.getByText("Redaction is OFF").waitFor();
        await assertNoSeriousViolations(
          panel,
          `${theme} stored chat, every state`,
        );

        const closed = panel.locator(
          '[role="log"] [data-slot="collapsible-trigger"][aria-expanded="false"]',
        );
        while (await closed.count()) await closed.first().click();
        await panel
          .getByText("Tab 7 was closed before the analysis finished.")
          .waitFor();
        await failure.getByText("Details").click();
        await failure.getByText(/Incorrect API key/).waitFor();
        await assertNoSeriousViolations(
          panel,
          `${theme} stored chat, tool cards and the error's details open`,
        );
        assert.deepEqual(await failure.getByRole("button").allTextContents(), [
          "Retry",
          "Open AI provider settings",
        ]);
        await panel.close();
        await app.close();
      },
    "side panel, a chat with a tool result and the evidence viewers": async (
      theme,
    ) => {
      const { app, panel } = await openPanel(theme);
      model.script(
        callToolThenReport("inspect_extension_network", {
          resourceQuery: VIEWED.query,
        }),
      );
      await chatAndWait(
        panel,
        `get the data from ${VIEWED.query} in the apty client`,
      );

      await panel.getByText("Show thinking details").last().click();
      await assertNoSeriousViolations(
        panel,
        `${theme} side panel, chat with a tool result`,
      );

      const summary = panel
        .getByRole("region", { name: "Investigation", exact: true })
        .getByRole("button", { name: "Expand" });
      if (await summary.count()) {
        await summary.first().click();
        await assertNoSeriousViolations(
          panel,
          `${theme} side panel, investigation summary`,
        );
      }

      await panel
        .getByRole("button", { name: "View full response" })
        .last()
        .click();
      await panel.getByText(VIEWED.shown).first().waitFor();
      await assertNoSeriousViolations(
        panel,
        `${theme} side panel, full response viewer`,
      );

      await chatAndWait(panel, `get the data from ${VIEWED.query} again`);
      await panel.getByText("Show thinking details").last().click();
      await panel
        .getByRole("button", { name: "View full response" })
        .last()
        .click();
      await panel.getByText(VIEWED.shown).nth(1).waitFor();
      await panel.close();
      await app.close();
    },
  },
  "dom-config-run": {
    "side panel, the DOM Config page idle, running, with its results and on a page it cannot analyze":
      async (theme) => {
        const target = await browser.context.newPage();
        await target.goto(`${domConfigApp.origin}/home`);
        const panel = await openSidePanel(browser, model, target);
        await panel.setViewportSize(SIDE_PANEL);
        await panel.getByRole("button", MENU).waitFor();
        await assertThemeApplied(panel, theme);

        await openToolPage(panel, "DOM config");
        const start = panel.getByRole("button", { name: "Start capture" });
        await start.waitFor();
        await panel.getByRole("button", { name: /^Advanced options/ }).click();
        await panel.getByLabel("Runs per page").waitFor();
        await assertNoSeriousViolations(panel, `${theme} DOM Config setup`);

        const held = domConfigApp.hold("/list");
        await start.click();
        await held.requested;
        const navigating = panel.getByText(
          "This tab is navigating through your application.",
        );
        await navigating.waitFor();
        await assertNoSeriousViolations(panel, `${theme} DOM Config running`);
        // The page was opened from the menu, so Back returns there first.
        await panel.getByRole("button", { name: "Back" }).click();
        await panel.getByRole("dialog", { name: "Menu" }).waitFor();
        await panel.keyboard.press("Escape");
        const jobs = panel.getByRole("region", { name: "Running jobs" });
        await jobs.waitFor();
        await assertNoSeriousViolations(panel, `${theme} Home, a running job`);
        await jobs.getByRole("button", { name: "View: DOM config" }).click();
        await navigating.waitFor();
        held.release();

        await panel
          .getByText("Capture complete", { exact: true })
          .waitFor({ timeout: 170_000 });
        await assertNoSeriousViolations(panel, `${theme} DOM Config results`);
        await panel.getByRole("button", { name: "Export results" }).click();
        await panel.getByRole("menuitem", { name: "Markdown" }).waitFor();
        await assertNoSeriousViolations(
          panel,
          `${theme} DOM Config export menu`,
        );
        await panel.keyboard.press("Escape");
        for (const [row, view] of [
          [/^Ignore conditions/, "ignore conditions"],
          [/^DOM change debounce/, "proposed settings"],
        ]) {
          await panel.getByRole("button", { name: row }).click();
          await assertNoSeriousViolations(panel, `${theme} DOM Config ${view}`);
          await panel
            .getByRole("button", { name: "Back", exact: true })
            .click();
        }

        await panel.getByRole("button", { name: /^Clear results/ }).click();
        const options = await extensionPage(browser);
        await options.bringToFront();
        await panel
          .getByText(
            "This page cannot be analyzed: browser and extension pages do not allow content scripts.",
          )
          .waitFor();
        await assertNoSeriousViolations(
          panel,
          `${theme} DOM Config on a page it cannot analyze`,
        );
        await options.close();
        await panel.close();
        await target.close();
      },
  },
  "dom-config-views": {
    "side panel, DOM Config manual capture, import, page detail and the Iframes, Coverage and Warnings details":
      async (theme) => {
        const target = await browser.context.newPage();
        await target.goto(`${domConfigApp.origin}/home`);
        const panel = await openSidePanel(browser, model, target);
        await panel.setViewportSize(SIDE_PANEL);
        await panel.getByRole("button", MENU).waitFor();
        await assertThemeApplied(panel, theme);
        await panel.getByRole("button", { name: "See all" }).click();
        await panel
          .getByRole("button", { name: /Generate DOM config: capture/ })
          .click();

        const back = () =>
          panel.getByRole("button", { name: "Back", exact: true }).click();
        await panel
          .getByRole("button", { name: /^Capture current state/ })
          .click();
        const name = panel.getByLabel("Page name");
        const capture = panel.getByRole("button", {
          name: "Capture now: add a run of the current tab as it is",
        });
        await name.fill("Home by hand");
        await capture.click();
        await panel.getByText("Captured run 1 of Home by hand.").waitFor();
        await name.fill("Home again");
        await capture.click();
        await panel
          .getByText(
            "This looks like the same state as a run already held on Home by hand. Check that you opened the state you meant to capture.",
          )
          .waitFor();
        await assertNoSeriousViolations(
          panel,
          `${theme} DOM Config manual capture with a result and a duplicate warning`,
        );

        await back();
        await panel.getByRole("button", { name: /^Import runs/ }).click();
        await panel.getByLabel("Page name").fill("Pasted page");
        await panel
          .getByLabel("Paste the script's result")
          .fill('{"tags":{"div":1}}');
        await panel.getByRole("button", { name: "Import page" }).click();
        await panel.getByText("Missing: attributes").waitFor();
        await assertNoSeriousViolations(
          panel,
          `${theme} DOM Config import with an error`,
        );

        await back();
        await panel.getByRole("button", { name: /^Pages/ }).click();
        await panel
          .getByRole("region", { name: "Pages" })
          .getByRole("button", { name: /^Home by hand/ })
          .click();
        await panel
          .getByRole("region", { name: "Details of Home by hand" })
          .waitFor();
        await assertNoSeriousViolations(
          panel,
          `${theme} DOM Config page detail`,
        );

        await back();
        for (const detail of ["Iframes", "Coverage", "Warnings"]) {
          await panel
            .getByRole("button", { name: new RegExp(`^${detail}`) })
            .click();
          await panel
            .getByRole("heading", { name: detail, exact: true })
            .first()
            .waitFor();
          await assertNoSeriousViolations(
            panel,
            `${theme} DOM Config ${detail}`,
          );
          await back();
        }
        await panel.getByRole("button", { name: /^Clear results/ }).click();
        await panel.close();
        await target.close();
      },
  },
  "dom-health": {
    "side panel, a DOM Health result and its export dialog at side-panel size":
      async (theme) => {
        const app = await browser.context.newPage();
        await app.goto(`${site.origin}/form.html`);
        const panel = await openSidePanel(browser, model, app, {
          developerTools: true,
        });
        await assertThemeApplied(panel, theme);
        await panel.setViewportSize(SIDE_PANEL);
        await openToolPage(panel, "DOM health");
        await assertNoSeriousViolations(
          panel,
          `${theme} DOM health, not checked`,
        );
        await panel.getByRole("button", { name: "Check this page" }).click();
        const breakdown = panel.getByRole("button", { name: "Full breakdown" });
        await breakdown.waitFor({ timeout: 150_000 });
        await assertNoSeriousViolations(panel, `${theme} DOM Health result`);

        await breakdown.click();
        await panel.locator("text=/Last checked/").first().waitFor();
        await panel
          .getByRole("region", {
            name: "How Apty's DES would find these elements",
          })
          .getByText("checkInitialPath")
          .waitFor();
        await assertNoSeriousViolations(panel, `${theme} DOM health breakdown`);
        await panel.getByRole("button", { name: "Back" }).click();
        await panel.getByRole("button", { name: /^Settings/ }).click();
        await panel.getByText("Threshold overrides").waitFor();
        await assertNoSeriousViolations(panel, `${theme} DOM health settings`);
        await panel.getByRole("button", { name: "Back" }).click();

        await panel
          .getByRole("button", { name: "Export validation bundle" })
          .click();
        const dialog = panel.getByRole("dialog", {
          name: "Review before sharing",
        });
        await dialog.waitFor();
        await assertNoSeriousViolations(panel, `${theme} export dialog`);
        const layout = await dialog.evaluate((el) => {
          const box = el.getBoundingClientRect();
          const pre = el.querySelector("pre");
          return {
            top: box.top,
            bottom: box.bottom,
            height: window.innerHeight,
            scrollable: pre.scrollHeight > pre.clientHeight,
            preStyle: getComputedStyle(pre).overflowY,
          };
        });
        assert.ok(
          layout.top >= 0 && layout.bottom <= layout.height,
          JSON.stringify(layout),
        );
        assert.equal(layout.scrollable, true, JSON.stringify(layout));
        assert.equal(layout.preStyle, "auto");
        for (const name of ["Cancel", "Copy", "Download"]) {
          await assertInViewport(dialog.getByRole("button", { name }));
        }
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await panel.close();
        await app.close();
      },
  },
  investigation: {
    "side panel, an investigation in the summary bar, collapsed and expanded, at every confidence":
      async (theme) => {
        const app = await browser.context.newPage();
        await app.goto(`${site.origin}/investigation.html`);
        const panel = await openSidePanel(browser, model, app);
        await assertThemeApplied(panel, theme);
        await scriptedTurn(panel, "hello", []);
        await scriptedTurn(panel, INVESTIGATION_PROMPT, INVESTIGATION_STEPS);

        const bar = panel.getByRole("region", {
          name: "Investigation",
          exact: true,
        });
        await bar.getByText("Likely", { exact: true }).waitFor();
        assert.match(await bar.innerText(), /Analyzing · 1 of \d+ steps/);
        await assertNoSeriousViolations(
          panel,
          `${theme} investigation, collapsed`,
        );

        const expand = bar.getByRole("button", { name: "Expand" });
        await expand.click();
        const details = bar.getByRole("region", {
          name: "Investigation details",
        });
        assert.deepEqual(
          await details.getByRole("heading", { level: 3 }).allInnerTexts(),
          ["Plan", "Components", "Timeline", "Diagnosis"],
        );
        assert.ok(
          (await details.getByText("Likely related incident").count()) >= 1,
          await details.innerText(),
        );
        await assertNoSeriousViolations(
          panel,
          `${theme} investigation, expanded`,
        );
        for (const height of [500, 640, 800]) {
          await assertComposerFits(panel, height);
        }

        const views = details.getByRole("button", { name: /^View details/ });
        while (await views.count()) await views.first().click();
        await details
          .getByRole("button", { name: /^Apty Client \/ Widget \/ Player/ })
          .click();
        await assertNoSeriousViolations(
          panel,
          `${theme} investigation, evidence and probes open`,
        );

        await details.getByRole("button", { name: "Verify diagnosis" }).focus();
        await panel.keyboard.press("Escape");
        await details.waitFor({ state: "detached" });
        assert.equal(
          await expand.evaluate((el) => el === document.activeElement),
          true,
        );

        for (const [confidence, word] of [
          ["possible", "Possible"],
          ["unknown", "Unknown"],
          ["confirmed", "Confirmed"],
        ]) {
          await scriptedTurn(
            panel,
            `investigate again and set the diagnosis confidence to ${confidence}`,
            confidenceSteps(confidence),
          );
          await bar.getByText(word, { exact: true }).waitFor();
          await assertNoSeriousViolations(
            panel,
            `${theme} investigation, ${confidence}`,
          );
        }
        await panel.close();
        await app.close();
      },
  },
  options: {
    "every Options tab": async (theme) => {
      const options = await extensionPage(browser);
      await options.setViewportSize({ width: 1280, height: 800 });
      await assertThemeApplied(options, theme);
      // Options shows a spinner, not its tabs, until settings have loaded.
      await options.getByRole("tab").nth(2).waitFor();
      const tabs = await options.getByRole("tab").allInnerTexts();
      assert.deepEqual(tabs, ["General", "AI", "Skills", "Connection"]);
      for (const name of tabs) {
        await options.getByRole("tab", { name, exact: true }).click();
        await options.waitForLoadState("networkidle");
        await assertNoSeriousViolations(options, `${theme} Options, ${name}`);
      }
      await options.close();
    },
    "every Options tab at 375 px: nothing scrolls sideways, the tabs stay in view and take the arrow keys":
      async (theme) => {
        const options = await extensionPage(browser);
        await options.setViewportSize({ width: 375, height: 800 });
        await assertThemeApplied(options, theme);
        const general = options.getByRole("tab", {
          name: "General",
          exact: true,
        });
        await general.waitFor();
        for (const name of ["General", "AI", "Skills", "Connection"]) {
          const tab = options.getByRole("tab", { name, exact: true });
          await tab.click();
          await options.waitForLoadState("networkidle");
          const overflow = await options.evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            client: document.documentElement.clientWidth,
          }));
          assert.ok(
            overflow.scroll <= overflow.client,
            `${name} scrolls sideways at 375 px: ${JSON.stringify(overflow)}`,
          );
          await assertNoSeriousViolations(
            options,
            `${theme} Options, ${name}, 375 px`,
          );
          const sticky = await options.evaluate(() => {
            window.scrollTo(0, document.documentElement.scrollHeight);
            const header = document.querySelector("header")?.offsetHeight ?? 0;
            const top = document
              .querySelector('[role="tablist"]')
              ?.getBoundingClientRect().top;
            const scrolled = window.scrollY;
            window.scrollTo(0, 0);
            return { header, top, scrolled };
          });
          assert.ok(
            sticky.top !== undefined &&
              Math.abs(
                sticky.top - Math.max(0, sticky.header - sticky.scrolled),
              ) <= 1,
            `${name}: the tabs scrolled away: ${JSON.stringify(sticky)}`,
          );
        }

        await general.click();
        await general.focus();
        await options.keyboard.press("ArrowRight");
        await options
          .getByRole("tab", { name: "AI", exact: true, selected: true })
          .waitFor();
        await options.keyboard.press("End");
        await options
          .getByRole("tab", { name: "Connection", exact: true, selected: true })
          .waitFor();
        await options.keyboard.press("ArrowRight");
        await options
          .getByRole("tab", { name: "General", exact: true, selected: true })
          .waitFor();
        await options.close();
      },
    "Options, widget network calls with a body open": async (theme) => {
      const options = await extensionPage(browser);
      await assertThemeApplied(options, theme);
      await options.getByRole("tab", { name: "Connection" }).click();
      const section = options.getByRole("region", {
        name: "Widget network calls",
      });
      await section.getByRole("button", { name: "Load network calls" }).click();
      await section.getByRole("table").waitFor({ timeout: 30_000 });
      await section
        .getByRole("button", { name: "View the body of segment.json" })
        .click();
      await section.getByText("Array(206)").waitFor({ timeout: 30_000 });
      await assertNoSeriousViolations(
        options,
        `${theme} Options, widget network calls`,
      );
      await options.close();
    },
  },
};

/** The Apty Client is connected first for the surfaces that show or read it. */
const CONNECTS_CLIENT = new Set([
  "panel-home",
  "panel-chat",
  "investigation",
  "options",
]);

/** Runs one surface's tests in one theme, in a browser of their own. */
export function a11ySuite(surface, theme) {
  const tests = SURFACES[surface];
  assert.ok(tests, `no accessibility surface ${surface}`);
  before(async () => {
    await setUp({ connectClient: CONNECTS_CLIENT.has(surface) });
    await setTheme(theme);
  });
  after(tearDown);
  describe(`accessibility, ${surface}, ${theme} theme`, () => {
    for (const [name, test] of Object.entries(tests)) {
      it(name, () => test(theme));
    }
  });
}
