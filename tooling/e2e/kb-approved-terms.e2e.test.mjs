/**
 * KB-RAG K27, E10: words the KB owner approved for a card (`kb:pack
 * --approved-terms`, from Feedback's synonym proposals) travel in the signed
 * pack. A pack whose approved terms changed after signing is refused at
 * import; the signed one finds the card by an approved word no card holds,
 * with no model request. Synthetic cards only.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { packSha256 } from "../scripts/kb/build-kb-pack.mjs";
import {
  extensionPage,
  launchBrowser,
  openSidePanel,
  sendChat,
  startMockModel,
  startPageServer,
  tempDir,
} from "./harness.mjs";
import { importPack, writeFixturePack } from "./kb-fixture.mjs";

const APPROVED = [{ pageId: "202", terms: ["twinkles"] }];

let browser;
let model;
let site;
let dir;

before(async () => {
  model = await startMockModel();
  model.script(() => ({ text: "MODEL WAS CALLED" }));
  site = await startPageServer({
    "/app.html": "<!doctype html><title>App</title><main>FIXTURE app</main>",
  });
  browser = await launchBrowser();
  dir = tempDir("apty-kb-approved-");
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

describe("approved terms in a signed pack (KB-RAG K27, E10)", () => {
  it("refuses a pack whose approved terms changed after signing", async () => {
    const { pack } = writeFixturePack(dir, {
      name: "signed.kbpack.json",
      approvedTerms: APPROVED,
    });
    const edited = {
      ...pack,
      retrieval: {
        ...pack.retrieval,
        approvedTerms: [{ pageId: "101", terms: ["twinkles"] }],
      },
    };
    const file = join(dir, "tampered.kbpack.json");
    writeFileSync(
      file,
      JSON.stringify({ ...edited, sha256: packSha256(edited) }),
    );
    const options = await extensionPage(
      browser,
      "src/entrypoints/options/index.html?tab=general#knowledge-base",
    );
    const card = options.locator("#knowledge-base");
    await card.getByTestId("knowledge-base-file").setInputFiles(file);
    await card
      .getByText("This pack's signature does not match its content.")
      .waitFor();
    await options.close();
  });

  it("finds the card by an approved word no card holds, with no model request", async () => {
    const { file } = writeFixturePack(dir, {
      name: "approved.kbpack.json",
      approvedTerms: APPROVED,
    });
    await importPack(browser, file);
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app, { aiToken: "" });
    await sendChat(panel, "the screen twinkles");
    const matches = panel.getByRole("region", { name: "KB cards that match" });
    await matches.waitFor({ timeout: 30_000 });
    assert.equal(
      await matches
        .getByRole("link", { name: /FIXTURE tooltip opens twice/ })
        .first()
        .getAttribute("href"),
      "https://fixture.atlassian.invalid/wiki/spaces/FX/pages/202",
    );
    assert.equal(model.requests.length, 0, "no model request");
    await panel.close();
    await app.close();
  });
});
