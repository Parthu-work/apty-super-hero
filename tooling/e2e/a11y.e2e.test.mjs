/**
 * Accessibility (C3): axe-core on the real side panel and Options page, in
 * light and dark themes. Fails on any `serious` or `critical` violation.
 * Side panel states: empty, a chat with a tool result, an approval prompt,
 * and the evidence viewers (the investigation summary and the full
 * response viewer). Options: every tab. No axe rule is disabled.
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
    (t) => chrome.storage.local.set({ aipex_theme: t }),
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

// One resource per theme: inspecting the same request twice in one browser
// session returns an evidence id the viewer cannot find (REVIEW.md,
// "Observed, not changed").
const VIEWED = {
  light: { query: "segments.json", shown: "Array(206)" },
  dark: { query: "themes.json", shown: "token expired" },
};

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
          resourceQuery: VIEWED[theme].query,
        }),
      );
      await chatAndWait(
        panel,
        `get the data from ${VIEWED[theme].query} in the apty client`,
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
      await panel.getByText(VIEWED[theme].shown).first().waitFor();
      await assertNoSeriousViolations(
        panel,
        `${theme} side panel, full response viewer`,
      );
      await panel.close();
      await app.close();
    });

    it("every Options tab", async () => {
      const options = await extensionPage(browser);
      await assertThemeApplied(options, theme);
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
