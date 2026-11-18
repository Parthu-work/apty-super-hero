/**
 * KB-RAG K27, E3: a broad symptom gets the choices of the "start here" card
 * that covers it, not three loosely related cards; choosing one shows that
 * card; a specific question never shows choices. No AI key, no model call.
 * Synthetic cards only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  axeInBothThemes,
  describeViolations,
  launchBrowser,
  openSidePanel,
  sendChat,
  startMockModel,
  startPageServer,
  tempDir,
} from "./harness.mjs";
import { fixturePage, importPack, writeFixturePack } from "./kb-fixture.mjs";

const flow = (id, title, what) =>
  fixturePage(id, title, [
    `In Studio, check the FIXTURE gizmo ${what} setting and publish.`,
    `The FIXTURE gizmo ${what} marker must be on the page.`,
    `gizmostate.json lists the FIXTURE ${what} entries.`,
    `Send support the FIXTURE gizmo ${what} details.`,
  ]);

const PAGES = [
  flow("801", "FIXTURE gizmo halts midway through the steps", "halt"),
  flow("802", "FIXTURE gizmo never launches for anybody", "launch"),
  flow("803", "FIXTURE gizmo jumps past the final step", "jump"),
  {
    id: "800",
    title: "RAG Card: Start here, FIXTURE gizmo problems",
    group: "FIXTURE group",
    updatedAt: "2026-02-01T00:00:00.000Z",
    body: `<p>Symptom: the FIXTURE gizmo is not working.</p><ul>${[
      "801",
      "802",
      "803",
    ]
      .map(
        (id) =>
          `<li><a href="https://fixture.atlassian.invalid/wiki/spaces/FX/pages/${id}">${id}</a></li>`,
      )
      .join("")}</ul>`,
  },
];

let browser;
let model;
let site;

before(async () => {
  model = await startMockModel();
  site = await startPageServer({
    "/app.html": "<!doctype html><title>App</title><main>FIXTURE app</main>",
  });
  browser = await launchBrowser();
  const { file, pack } = writeFixturePack(tempDir("apty-kb-choices-"), {
    pages: PAGES,
  });
  assert.equal(
    pack.cards.find((card) => card.pageId === "800").options.length,
    3,
  );
  await importPack(browser, file);
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

describe("choices on a broad symptom (KB-RAG K27, E3)", () => {
  it("asks which one, shows the chosen card, and never asks on a specific question", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app, { aiToken: "" });

    await sendChat(panel, "the FIXTURE gizmo is not working");
    const choices = panel.getByTestId("kb-choices");
    await choices.waitFor({ timeout: 30_000 });
    assert.equal(await choices.getByRole("button").count(), 3);
    const violations = await axeInBothThemes(panel);
    assert.deepEqual(violations, [], describeViolations(violations));
    await choices
      .getByRole("button", { name: "FIXTURE gizmo never launches for anybody" })
      .click();
    const chosen = panel.getByTestId("kb-chosen-card");
    await chosen.waitFor();
    assert.match(await chosen.innerText(), /FIXTURE gizmo never launches/);
    assert.match(await chosen.innerText(), /launch setting/);

    await sendChat(panel, "FIXTURE gizmo jumps past the final step");
    const cards = panel.getByRole("region", { name: "KB cards that match" });
    await panel.waitForFunction(
      () =>
        document.querySelectorAll('[aria-label="KB cards that match"]')
          .length >= 2,
    );
    const last = cards.last();
    assert.equal(await last.getByTestId("kb-choices").count(), 0);
    assert.match(
      await last.innerText(),
      /FIXTURE gizmo jumps past the final step/,
    );
    assert.equal(model.requests.length, 0);
    await panel.close();
    await app.close();
  });
});
