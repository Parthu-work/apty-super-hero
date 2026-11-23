/**
 * KB-RAG K29 P3: a pack built before the latest card rules (no
 * classifierRevision, a four-layer "start here" card) imports and is used;
 * the start-here card counts as routing, and Options and Preflight say the
 * pack needs a rebuild. Axe in both themes. Synthetic cards only.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildPack, packSha256 } from "../scripts/kb/build-kb-pack.mjs";
import {
  describeViolations,
  extensionPage,
  launchBrowser,
  runAxe,
  tempDir,
} from "./harness.mjs";
import { signWithTestKey, TEST_KEY_POLICY } from "./kb-fixture.mjs";
import { ensurePolicyBuild, setTestPolicy } from "./policy-build.mjs";

const OPTIONS = "src/entrypoints/options/index.html?tab=general#knowledge-base";
const REBUILD =
  /Built before the latest card rules: rebuild this pack for the best answers/;

function syntheticPage(id, title) {
  const layer = (n, text) =>
    `<h2>Layer ${n}: FIXTURE ${id}, part ${n}</h2><ol><li><p>${text}</p></li></ol>`;
  return {
    id,
    title: `RAG Card: ${title}`,
    group: "FIXTURE group",
    updatedAt: "2026-02-01T00:00:00.000Z",
    body: `<p>Verified on: FIXTURE code, 2026-01-01.</p>${layer(1, `In Studio, turn on the FIXTURE ${id} setting.`)}${layer(2, "FIXTURE page checks.")}${layer(3, "FIXTURE data.")}${layer(4, "Send support: the FIXTURE version.")}`,
  };
}

/** The pack a builder before K27 wrote: the start-here page a full card, and no classifierRevision. */
function oldPack() {
  const { pack } = buildPack({
    pages: [
      syntheticPage("101", "FIXTURE banner never glows"),
      syntheticPage("102", "FIXTURE glow questions"),
    ],
    site: "fixture.atlassian.net",
    space: "FX",
    label: "rag-card",
    builtAt: new Date().toISOString(),
    aptyVersion: "5.x",
  });
  const {
    sha256: _sha,
    classifierRevision: _revision,
    ...rest
  } = {
    ...pack,
    cards: pack.cards.map((card) =>
      card.pageId === "102"
        ? { ...card, title: "Start here: FIXTURE glow questions" }
        : card,
    ),
  };
  return signWithTestKey({ ...rest, sha256: packSha256(rest) });
}

let browser;
let packFile;

before(async () => {
  packFile = join(
    tempDir("apty-kb-old-e2e-"),
    "apty-kb-FX-5.x-old.kbpack.json",
  );
  writeFileSync(packFile, JSON.stringify(oldPack()));
  browser = await launchBrowser({ extensionDir: ensurePolicyBuild() });
  await setTestPolicy(browser, TEST_KEY_POLICY);
});

after(async () => {
  await browser?.close();
});

async function openCard(theme = "light") {
  const page = await extensionPage(browser);
  await page.evaluate(
    (t) => chrome.storage.local.set({ apty_theme: t }),
    theme,
  );
  await page.goto(`chrome-extension://${browser.extensionId}/${OPTIONS}`);
  await page.waitForFunction(
    (dark) => document.documentElement.classList.contains("dark") === dark,
    theme === "dark",
  );
  const card = page.locator("#knowledge-base");
  await card.getByRole("button", { name: "Import pack…" }).waitFor();
  return { page, card };
}

describe("a pack built before the latest card rules (KB-RAG K29, P3)", () => {
  it("imports, counts its start-here card as routing and says it needs a rebuild", async () => {
    const { page, card } = await openCard();
    await card.getByTestId("knowledge-base-file").setInputFiles(packFile);
    await card
      .getByText("Imported 2 cards for Apty 5.x from space FX.")
      .waitFor();
    const row = card.getByRole("region", {
      name: "Loaded knowledge base (5.x)",
    });
    await row.getByText(REBUILD).waitFor();
    assert.match(await row.innerText(), /1 routing, never shown as an answer/);
    assert.doesNotMatch(await row.innerText(), /Not used/);
    await page.close();
  });

  it("Preflight says the same, as a warning", async () => {
    const options = await extensionPage(
      browser,
      "src/entrypoints/options/index.html#preflight",
    );
    await options.getByRole("button", { name: "Run all checks" }).click();
    const row = options.locator('li[data-check="knowledge-base"]');
    await row.first().waitFor({ timeout: 90_000 });
    assert.equal(await row.count(), 1);
    assert.match(await row.innerText(), REBUILD);
    assert.equal(await row.getAttribute("data-status"), "warn");
    await options.close();
  });

  for (const theme of ["light", "dark"]) {
    it(`has no serious accessibility violations with the rebuild note, in the ${theme} theme`, async () => {
      const { page, card } = await openCard(theme);
      await card.getByText(REBUILD).waitFor();
      const violations = await runAxe(page);
      assert.deepEqual(violations, [], describeViolations(violations));
      await page.close();
    });
  }
});
