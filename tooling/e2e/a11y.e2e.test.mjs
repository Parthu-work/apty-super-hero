/**
 * Accessibility (C3): axe-core on the real side panel and Options page, in
 * light and dark themes. Fails on any `serious` or `critical` violation.
 * Side panel states: empty, Home with every suggestion, the "/" list, the
 * menu with its recent chats loading and loaded, Home with a running job,
 * Home with no AI provider and the Connections page with an ID error, a
 * chat with a tool result, a long chat scrolled up with its
 * scroll-to-bottom button, an approval prompt, an intervention card before
 * and after an option is chosen, the send button idle, sending, streaming
 * and after an error, the evidence viewers (the investigation summary and
 * the full response viewer), a DOM Health result with its export dialog at
 * side-panel size, and the DOM Config page idle, running (held on a page
 * request), with its report and on a page it cannot analyze, a manual
 * capture with a duplicate warning, an import error, page detail and the
 * Iframes, Coverage and Warnings tabs. Options: every tab. No axe rule is
 * disabled.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { startDomConfigApp } from "./fixtures/dom-config-app.mjs";
import {
  AGENT_EXTENSION_ID,
  callToolThenReport,
  chatAndWait,
  describeViolations,
  extensionPage,
  launchBrowser,
  openSidePanel,
  openToolPage,
  runAxe,
  sendChat,
  startMockModel,
  startPageServer,
  tempDir,
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

before(async () => {
  model = await startMockModel();
  domConfigApp = await startDomConfigApp();
  site = await startPageServer({
    "/app.html": "<title>App</title><main><h1>App</h1></main>",
    "/form.html":
      '<title>Form</title><main><h1>Orders</h1><form><input name="order" aria-label="Order"><button type="button">Find</button></form></main>',
  });
  browser = await launchBrowser({ extraExtensions: [clientDir] });
  const options = await extensionPage(browser);
  await options.getByRole("tab", { name: "Apty Integration" }).click();
  await options.getByLabel("Extension ID").fill(CLIENT_ID);
  await options
    .getByLabel("Extension ID")
    .locator("..")
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await options.getByText("Answering").waitFor({ timeout: 30_000 });
  await options.close();
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
  domConfigApp?.close();
});

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

// The same resource in both themes: the second inspection returns the
// evidence stored by the first, and the viewer must still open it.
const VIEWED = { query: "segments.json", shown: "Array(206)" };

for (const theme of ["light", "dark"]) {
  describe(`accessibility, ${theme} theme`, () => {
    before(() => setTheme(theme));

    it("side panel, empty", async () => {
      const { app, panel } = await openPanel(theme);
      await assertNoSeriousViolations(panel, `${theme} side panel, empty`);
      await panel.close();
      await app.close();
    });

    it("side panel, Home with every suggestion and the / list", async () => {
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
    });

    it("side panel, the menu while its recent chats are still loading", async () => {
      const { app, panel } = await openPanel(theme);
      await panel.addInitScript(holdConversationHistory);
      await panel.reload();
      await panel.getByRole("button", MENU).click();
      const menu = panel.getByRole("dialog", { name: "Menu" });
      await menu.getByRole("button", { name: "New chat" }).waitFor();
      await panel.waitForFunction(() => globalThis.__conversationHistoryHeld);
      assert.equal(await menu.getByText("Recent chats").count(), 0);
      await assertNoSeriousViolations(
        panel,
        `${theme} menu, recent chats still loading`,
      );
      await panel.close();
      await app.close();
    });

    it("side panel, the menu with a recent chat", async () => {
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
      await panel.close();
      await app.close();
    });

    it("side panel, Home with no AI provider and the Connections page with an ID error", async () => {
      const app = await browser.context.newPage();
      await app.goto(`${site.origin}/app.html`);
      const panel = await openSidePanel(browser, model, app, { aiToken: "" });
      await assertThemeApplied(panel, theme);
      await panel.getByRole("button", { name: "Set up AI provider" }).waitFor();
      await assertNoSeriousViolations(panel, `${theme} Home, no AI provider`);

      await panel.getByRole("button", { name: "1 to set up" }).click();
      const page = panel.getByRole("region", { name: "Connections" });
      const studio = page.getByRole("region", { name: "Apty Studio" });
      await studio.getByLabel("Extension ID").fill("not-an-id");
      await studio.getByRole("button", { name: "Connect Apty Studio" }).click();
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
    });

    it("side panel, an approval prompt", async () => {
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
    });

    it("side panel, an intervention card and its cancel button", async () => {
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
            .getByRole("button", { name: /Order 1001/ })
            .waitFor({ timeout: 30_000 });
          await assertNoSeriousViolations(
            panel,
            `${theme} side panel, intervention card`,
          );
          await panel.getByRole("button", { name: /Order 1001/ }).click();
          const confirm = panel.getByRole("button", {
            name: "Confirm Selection",
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
    });

    it("side panel, the send button idle, sending, streaming and after an error", async () => {
      const { app, panel } = await openPanel(theme);
      const named = (name) => panel.getByRole("button", { name, exact: true });
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
      await assertNoSeriousViolations(panel, `${theme} send button, streaming`);

      finish.resolve();
      await named("Send").waitFor();

      model.script(() => ({
        error: { status: 400, message: "The mock model refused" },
      }));
      await sendChat(panel, "this one fails");
      await panel.getByText(/The mock model refused/).waitFor();
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
    });

    it("side panel, a long chat scrolled up, with its scroll-to-bottom button", async () => {
      const { app, panel } = await openPanel(theme);
      const lines = Array.from(
        { length: 60 },
        (_, i) => `Line ${i + 1} of a long answer.`,
      );
      model.script(() => ({ text: lines.join("\n\n") }));
      await sendChat(panel, "give me a long answer");
      await panel.getByText(lines.at(-1)).waitFor();
      await panel.getByRole("button", { name: "Send", exact: true }).waitFor();

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
    });

    it("side panel, a chat with a tool result and the evidence viewers", async () => {
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

      const summary = panel.getByRole("button", {
        name: /^Investigation status/,
      });
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
      await panel.close();
      await app.close();
    });

    it("side panel, the DOM Config card idle, running, with its report and on a page it cannot analyze", async () => {
      const target = await browser.context.newPage();
      await target.goto(`${domConfigApp.origin}/home`);
      const panel = await openSidePanel(browser, model, target);
      await panel.setViewportSize(SIDE_PANEL);
      await panel.getByRole("button", MENU).waitFor();
      await assertThemeApplied(panel, theme);

      await openToolPage(panel, "DOM config");
      const start = panel.getByRole("button", {
        name: "Start generating the DOM config",
      });
      await start.waitFor();
      await assertNoSeriousViolations(panel, `${theme} DOM Config idle`);

      const held = domConfigApp.hold("/list");
      await start.click();
      await held.requested;
      await panel.getByRole("list", { name: "Progress" }).waitFor();
      await assertNoSeriousViolations(panel, `${theme} DOM Config running`);
      // The page was opened from the menu, so Back returns there first.
      await panel.getByRole("button", { name: "Back" }).click();
      await panel.getByRole("dialog", { name: "Menu" }).waitFor();
      await panel.keyboard.press("Escape");
      const jobs = panel.getByRole("region", { name: "Running jobs" });
      await jobs.waitFor();
      await assertNoSeriousViolations(panel, `${theme} Home, a running job`);
      await jobs.getByRole("button", { name: "View: DOM config" }).click();
      await panel.getByRole("list", { name: "Progress" }).waitFor();
      held.release();

      await panel
        .getByRole("tablist", { name: "Report sections" })
        .waitFor({ timeout: 170_000 });
      await assertNoSeriousViolations(
        panel,
        `${theme} DOM Config report, ignore conditions`,
      );
      await panel.getByRole("tab", { name: "Settings" }).click();
      await assertNoSeriousViolations(
        panel,
        `${theme} DOM Config report, settings`,
      );

      await panel
        .getByRole("button", { name: "Clear the DOM Config results" })
        .click();
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
    });

    it("side panel, DOM Config manual capture, import, page detail and the Iframes, Coverage and Warnings tabs", async () => {
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

      await panel
        .locator("summary", { hasText: "Capture current state" })
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

      await panel
        .locator("summary", { hasText: "Import console script results" })
        .click();
      const importPanel = panel.locator("details", {
        has: panel.locator("summary", {
          hasText: "Import console script results",
        }),
      });
      await importPanel.getByLabel("Page name").fill("Pasted page");
      await importPanel
        .getByLabel("Paste the script's result")
        .fill('{"tags":{"div":1}}');
      await importPanel.getByRole("button", { name: "Import page" }).click();
      await importPanel.getByText("Missing: attributes").waitFor();
      await assertNoSeriousViolations(
        panel,
        `${theme} DOM Config import with an error`,
      );

      await panel
        .getByRole("region", { name: "Pages" })
        .getByRole("button", { name: /^Home by hand/ })
        .click();
      await panel
        .getByRole("region", { name: "Details of Home by hand" })
        .waitFor();
      await assertNoSeriousViolations(panel, `${theme} DOM Config page detail`);

      for (const tab of ["Iframes", "Coverage", "Warnings"]) {
        await panel.getByRole("tab", { name: tab }).click();
        await panel.getByRole("tab", { name: tab, selected: true }).waitFor();
        await assertNoSeriousViolations(
          panel,
          `${theme} DOM Config ${tab} tab`,
        );
      }
      await panel
        .getByRole("button", { name: "Clear the DOM Config results" })
        .click();
      await panel.close();
      await target.close();
    });

    it("side panel, a DOM Health result and its export dialog at side-panel size", async () => {
      const app = await browser.context.newPage();
      await app.goto(`${site.origin}/form.html`);
      const panel = await openSidePanel(browser, model, app, {
        developerTools: true,
      });
      await assertThemeApplied(panel, theme);
      await panel.setViewportSize(SIDE_PANEL);
      await openToolPage(panel, "DOM health");
      await panel.getByRole("button", { name: /check dom health/i }).click();
      await panel
        .locator("text=/Last checked/")
        .first()
        .waitFor({ timeout: 150_000 });
      await panel
        .getByRole("region", {
          name: "How Apty's DES would find these elements",
        })
        .getByText("checkInitialPath")
        .waitFor();
      await assertNoSeriousViolations(panel, `${theme} DOM Health result`);

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
    });

    it("every Options tab", async () => {
      const options = await extensionPage(browser);
      await assertThemeApplied(options, theme);
      // Options shows a spinner, not its tabs, until settings have loaded.
      await options.getByRole("tab").nth(2).waitFor();
      const tabs = await options.getByRole("tab").allInnerTexts();
      assert.ok(tabs.length >= 3, tabs.join());
      for (const name of tabs) {
        await options.getByRole("tab", { name }).first().click();
        await options.waitForLoadState("networkidle");
        await assertNoSeriousViolations(options, `${theme} Options, ${name}`);
      }
      await options.close();
    });

    it("Options, widget network calls with a body open", async () => {
      const options = await extensionPage(browser);
      await assertThemeApplied(options, theme);
      await options.getByRole("tab", { name: "Apty Integration" }).click();
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
    });
  });
}
