/**
 * KB-RAG K27, E4: "check if Alpha Ledger Page workflow is present in
 * all-users segment" answered from the Apty Client's content files, in a
 * table, with zero model requests, for a 5.x and a 4.x Client. The names
 * match ignoring case and punctuation. Synthetic content only.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  AGENT_EXTENSION_ID,
  axeInBothThemes,
  describeViolations,
  extensionPage,
  launchBrowser,
  openSidePanel,
  sendChat,
  startMockModel,
  startPageServer,
  tempDir,
  unpackedExtensionId,
  writeContentClient,
} from "./harness.mjs";

const QUESTION =
  "check if Alpha Ledger Page workflow is present in all-users segment";

/** K28, F1: phrasings the K27 router sent to the model. */
const NEW_PHRASINGS = [
  [
    "from flows.json check if Alpha Ledger Page is present in All Users Segment in segments.json",
    '"Alpha Ledger Page" is in the "All Users" segment.',
  ],
  [
    "does the All Users segment include Alpha Ledger Page",
    '"Alpha Ledger Page" is in the "All Users" segment.',
  ],
  [
    "which workflows are in All Users",
    'Workflows the "All Users" segment lists: 1.',
  ],
];

const CLIENTS = {
  "5.x": {
    "workflow.json": JSON.stringify([
      { sourceId: "wf-1", name: "Alpha Ledger Page", hideFromWidget: false },
      { sourceId: "wf-2", name: "Beta Intake", hideFromWidget: true },
    ]),
    "segment.json": JSON.stringify([
      { id: "s-1", name: "All Users", isActive: true, workflowIds: ["wf-1"] },
    ]),
  },
  "4.x": {
    "flow.json": JSON.stringify([
      { id: 11, name: { en: "Alpha Ledger Page" }, hideInWidget: false },
    ]),
    "segments.json": JSON.stringify([
      { id: 21, name: "All Users", flows: [11] },
    ]),
    "rules.json": "[]",
  },
};

let model;
let site;

before(async () => {
  model = await startMockModel();
  model.script(() => ({ text: "MODEL WAS CALLED" }));
  site = await startPageServer({
    "/app.html": "<title>App</title><h1>FIXTURE app</h1>",
  });
});

after(() => {
  model?.close();
  site?.close();
});

describe("lookups from the content files (KB-RAG K27, E4)", () => {
  for (const version of ["5.x", "4.x"]) {
    it(`${version}: answers in a table, from the Client's files, with no model request`, async () => {
      const clientDir = join(tempDir(`apty-e2e-lookup-${version}-`), "client");
      writeContentClient(clientDir, AGENT_EXTENSION_ID, CLIENTS[version]);
      const browser = await launchBrowser({ extraExtensions: [clientDir] });
      try {
        const options = await extensionPage(browser);
        await options.getByRole("tab", { name: "Connection" }).click();
        await options
          .getByLabel("Extension ID")
          .fill(unpackedExtensionId(clientDir));
        await options
          .getByLabel("Extension ID")
          .locator("..")
          .getByRole("button", { name: "Connect", exact: true })
          .click();
        await options.getByText("Answering").waitFor({ timeout: 30_000 });
        await options.close();

        const app = await browser.context.newPage();
        await app.goto(`${site.origin}/app.html`);
        const panel = await openSidePanel(browser, model, app);
        const before = model.requests.length;
        await sendChat(panel, QUESTION);
        const card = panel.getByTestId("lookup-card");
        await card.waitFor({ timeout: 30_000 });
        assert.equal(
          await card.getByTestId("lookup-answer").innerText(),
          '"Alpha Ledger Page" is in the "All Users" segment.',
        );
        assert.match(
          await card.innerText(),
          new RegExp(`Apty ${version} files`),
        );
        assert.equal(await card.getByRole("table").count(), 1);
        assert.equal(model.requests.length, before, "no model request");
        for (const [phrasing, answer] of NEW_PHRASINGS) {
          await sendChat(panel, phrasing);
          const cards = panel.getByTestId("lookup-card");
          await panel.waitForFunction(
            ([id, n]) =>
              document.querySelectorAll(`[data-testid="${id}"]`).length >= n,
            ["lookup-card", (await cards.count()) + 1],
            { timeout: 30_000 },
          );
          const latest = cards.last();
          assert.equal(
            await latest.getByTestId("lookup-answer").innerText(),
            answer,
            phrasing,
          );
          assert.equal(await latest.getByRole("table").count(), 1, phrasing);
        }
        assert.equal(model.requests.length, before, "no model request");
        const violations = await axeInBothThemes(panel);
        assert.deepEqual(violations, [], describeViolations(violations));
        await panel.close();
        await app.close();
      } finally {
        await browser.close();
      }
    });
  }

  it("K28, F2 and F3: same-named workflows are told apart, one click answers, and an unreported file offers Get the evidence", async () => {
    const clientDir = join(tempDir("apty-e2e-lookup-choices-"), "client");
    writeContentClient(clientDir, AGENT_EXTENSION_ID, {
      "workflow.json": JSON.stringify([
        { sourceId: "wf-1", name: "Alpha Ledger Page", hideFromWidget: false },
        { sourceId: "wf-9", name: "Alpha Ledger Page", hideFromWidget: true },
      ]),
    });
    const browser = await launchBrowser({ extraExtensions: [clientDir] });
    try {
      const options = await extensionPage(browser);
      await options.getByRole("tab", { name: "Connection" }).click();
      await options
        .getByLabel("Extension ID")
        .fill(unpackedExtensionId(clientDir));
      await options
        .getByLabel("Extension ID")
        .locator("..")
        .getByRole("button", { name: "Connect", exact: true })
        .click();
      await options.getByText("Answering").waitFor({ timeout: 30_000 });
      await options.close();

      const app = await browser.context.newPage();
      await app.goto(`${site.origin}/app.html`);
      const panel = await openSidePanel(browser, model, app);
      const before = model.requests.length;
      await sendChat(panel, "is Alpha Ledger Page in All Users segment");
      const ask = panel.getByTestId("lookup-ask");
      await ask.waitFor({ timeout: 30_000 });
      const choices = ask.getByRole("button");
      assert.deepEqual(await choices.allInnerTexts(), [
        "Alpha Ledger Page (wf-1)",
        "Alpha Ledger Page (wf-9, hidden)",
      ]);
      await choices.nth(1).focus();
      await panel.keyboard.press("Enter");
      const chosen = panel.getByTestId("lookup-chosen");
      await chosen.waitFor();
      assert.equal(
        await chosen.getByTestId("lookup-answer").innerText(),
        "The Apty Client has not reported segment.json yet.",
      );
      const evidence = chosen.getByTestId("lookup-evidence");
      await evidence
        .getByRole("button", { name: "Get the evidence" })
        .waitFor();
      await evidence.getByRole("button", { name: "Reload the tab" }).waitFor();
      assert.equal(model.requests.length, before, "no model request");
      const violations = await axeInBothThemes(panel);
      assert.deepEqual(violations, [], describeViolations(violations));
      await panel.close();
      await app.close();
    } finally {
      await browser.close();
    }
  });
});
