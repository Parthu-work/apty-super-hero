/**
 * Accessibility (C3): axe-core on the real side panel and Options page, in
 * light and dark themes. Fails on any `serious` or `critical` violation.
 * Side panel states: empty, a chat with a tool result, an approval prompt,
 * the evidence viewers (the investigation summary and the full response
 * viewer), and a DOM Health result with its export dialog at side-panel
 * size. Options: every tab. No axe rule is disabled.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  AGENT_EXTENSION_ID,
  callToolThenReport,
  chatAndWait,
  describeViolations,
  extensionPage,
  launchBrowser,
  openSidePanel,
  runAxe,
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

before(async () => {
  model = await startMockModel();
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

async function openPanel(theme) {
  const app = await browser.context.newPage();
  await app.goto(`${site.origin}/app.html`);
  const panel = await openSidePanel(browser, model, app);
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

    it("side panel, a DOM Health result and its export dialog at side-panel size", async () => {
      const app = await browser.context.newPage();
      await app.goto(`${site.origin}/form.html`);
      const panel = await openSidePanel(browser, model, app, {
        developerTools: true,
      });
      await assertThemeApplied(panel, theme);
      await panel.setViewportSize(SIDE_PANEL);
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
  });
}
