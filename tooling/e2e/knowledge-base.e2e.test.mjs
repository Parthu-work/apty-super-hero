/**
 * KB-RAG K3, K12: KB packs built by the K1 builder, one per Apty version,
 * import in Options → Settings → Knowledge base, survive an extension
 * restart, show in Preflight (a row each) and are removed one version at a
 * time after confirmation. A pack an earlier version of the Agent stored
 * moves to 5.x. The card passes axe in both themes and the removal works
 * by keyboard. Synthetic cards only.
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
  restartAgent,
  runAxe,
  tempDir,
  writeRestartHelper,
} from "./harness.mjs";
import { signWithTestKey, TEST_KEY_POLICY } from "./kb-fixture.mjs";
import { ensurePolicyBuild, setTestPolicy } from "./policy-build.mjs";

const OPTIONS = "src/entrypoints/options/index.html?tab=general#knowledge-base";

function syntheticPage(id, words) {
  const layer = (n, text) =>
    `<h2>Layer ${n}: FIXTURE card ${id}, part ${n}</h2><ol><li><p>${text}</p></li></ol>`;
  return {
    id,
    title: `RAG Card: FIXTURE card ${id}`,
    group: "FIXTURE group",
    updatedAt: "2026-02-01T00:00:00.000Z",
    body: `<p>Verified on: FIXTURE code, 2026-01-01.</p>${layer(1, `In Studio, turn on the FIXTURE ${words} setting.`)}${layer(2, "FIXTURE page checks.")}${layer(3, "NOT VERIFIED: FIXTURE data.")}${layer(4, "Send support: the FIXTURE version.")}`,
  };
}

let browser;
let helperDir;
let packFile;
let fourXFile;
let tamperedFile;
let legacyPack;

before(async () => {
  const dir = tempDir("apty-kb-e2e-");
  const { pack } = buildPack({
    pages: [
      syntheticPage("101", "Glowing Banner"),
      syntheticPage("202", "Double Trigger"),
    ],
    site: "fixture.atlassian.net",
    space: "FX",
    label: "rag-card",
    builtAt: new Date().toISOString(),
    aptyVersion: "5.x",
  });
  packFile = join(dir, "apty-kb-FX-5.x-fixture.kbpack.json");
  writeFileSync(packFile, JSON.stringify(signWithTestKey(pack)));
  const fourX = buildPack({
    pages: [
      syntheticPage("401", "Beacon Glow"),
      syntheticPage("402", "Step Skip"),
      syntheticPage("403", "Locale Fallback"),
    ],
    site: "fixture.atlassian.net",
    space: "A4X",
    label: "rag-card",
    builtAt: new Date().toISOString(),
    aptyVersion: "4.x",
  }).pack;
  fourXFile = join(dir, "apty-kb-A4X-4.x-fixture.kbpack.json");
  writeFileSync(fourXFile, JSON.stringify(signWithTestKey(fourX)));
  const { sha256: _sha, ...v1 } = { ...pack, schemaVersion: 1 };
  legacyPack = { ...v1, sha256: packSha256(v1) };
  tamperedFile = join(dir, "tampered.kbpack.json");
  writeFileSync(
    tamperedFile,
    JSON.stringify(signWithTestKey(pack)).replace(
      "Glowing Banner",
      "Glowing Banner edited",
    ),
  );
  helperDir = writeRestartHelper(tempDir("apty-restart-helper-"));
  // Non-demo packs are signed with the run-time test key, which the E2E
  // policy build trusts (KB-RAG K23 P2).
  browser = await launchBrowser({
    extensionDir: ensurePolicyBuild(),
    extraExtensions: [helperDir],
  });
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

/** Writes an earlier version's one pack, under the keys it used, as that version did. */
async function seedLegacyPack(page, pack) {
  await page.evaluate(
    (stored) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("apty-kb-db", 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains("records")) {
            open.result.createObjectStore("records");
          }
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("records", "readwrite");
          tx.objectStore("records").put(stored, "pack");
          tx.objectStore("records").put(
            {
              site: stored.source.site,
              space: stored.source.space,
              label: stored.source.label,
              cardCount: stored.cards.length,
              chunkCount: stored.chunks.length,
              builtAt: stored.builtAt,
              importedAt: stored.builtAt,
              mode: "bm25",
              calibrated: false,
              sha256: stored.sha256,
            },
            "meta",
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    pack,
  );
}

async function kbRecords(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("apty-kb-db");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("records")) {
            db.close();
            resolve([]);
            return;
          }
          const req = db
            .transaction("records")
            .objectStore("records")
            .getAllKeys();
          req.onsuccess = () => {
            db.close();
            resolve(req.result.sort());
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

describe("knowledge base packs (KB-RAG K3, K12)", () => {
  it("moves the one pack an earlier version stored to 5.x", async () => {
    const page = await extensionPage(browser);
    await seedLegacyPack(page, legacyPack);
    await page.goto(`chrome-extension://${browser.extensionId}/${OPTIONS}`);
    const card = page.locator("#knowledge-base");
    const row = card.getByRole("region", {
      name: "Loaded knowledge base (5.x)",
    });
    await row.getByText("FX · fixture.atlassian.net").waitFor();
    assert.deepEqual(await kbRecords(page), ["meta:5.x", "pack:5.x"]);
    await row.getByRole("button", { name: "Remove 5.x pack" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Remove" })
      .click();
    await card.getByText(/No knowledge base loaded/).waitFor();
    await page.close();
  });

  it("imports a 5.x and a 4.x pack side by side, names a tampered one, and keeps both across a restart", async () => {
    const { page, card } = await openCard();
    await card.getByText(/No knowledge base loaded/).waitFor();
    await card.getByTestId("knowledge-base-file").setInputFiles(packFile);
    await card
      .getByText("Imported 2 cards for Apty 5.x from space FX.")
      .waitFor();
    await card.getByTestId("knowledge-base-file").setInputFiles(fourXFile);
    await card
      .getByText("Imported 3 cards for Apty 4.x from space A4X.")
      .waitFor();
    const five = card.getByRole("region", {
      name: "Loaded knowledge base (5.x)",
    });
    assert.match(await five.innerText(), /FX · fixture\.atlassian\.net/);
    assert.match(await five.innerText(), /Keyword \(BM25\)/);
    const four = card.getByRole("region", {
      name: "Loaded knowledge base (4.x)",
    });
    assert.match(await four.innerText(), /A4X · fixture\.atlassian\.net/);

    await card.getByTestId("knowledge-base-file").setInputFiles(tamperedFile);
    await card.getByText(/checksum does not match its contents/).waitFor();
    assert.deepEqual(await kbRecords(page), [
      "meta:4.x",
      "meta:5.x",
      "pack:4.x",
      "pack:5.x",
    ]);
    await page.close();

    await restartAgent(browser, helperDir);
    const again = await openCard();
    await again.card.getByText("FX · fixture.atlassian.net").waitFor();
    await again.card.getByText("A4X · fixture.atlassian.net").waitFor();
    await again.page.close();
  });

  it("shows each loaded version in Preflight", async () => {
    const options = await extensionPage(
      browser,
      "src/entrypoints/options/index.html#preflight",
    );
    await options.getByRole("button", { name: "Run all checks" }).click();
    const rows = options.locator('li[data-check="knowledge-base"]');
    await rows.nth(1).waitFor({ timeout: 90_000 });
    const texts = await rows.allInnerTexts();
    assert.equal(texts.length, 2);
    assert.match(texts[0], /Knowledge base \(4\.x\)/);
    assert.match(
      texts[0],
      /Loaded: 3 cards from space A4X, built \d{4}-\d{2}-\d{2}\./,
    );
    assert.match(texts[1], /Knowledge base \(5\.x\)/);
    assert.match(
      texts[1],
      /Loaded: 2 cards from space FX, built \d{4}-\d{2}-\d{2}\./,
    );
    for (const status of await rows.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-status")),
    )) {
      assert.equal(status, "pass");
    }
    await options.close();
  });

  for (const theme of ["light", "dark"]) {
    it(`has no serious accessibility violations with two packs loaded, in the ${theme} theme`, async () => {
      const { page, card } = await openCard(theme);
      await card.getByText("A4X · fixture.atlassian.net").waitFor();
      const violations = await runAxe(page);
      assert.deepEqual(violations, [], describeViolations(violations));

      await card.getByRole("button", { name: "Remove 4.x pack" }).click();
      await page.getByRole("alertdialog").waitFor();
      const inDialog = await runAxe(page);
      assert.deepEqual(inDialog, [], describeViolations(inDialog));
      await page.keyboard.press("Escape");
      await page.getByRole("alertdialog").waitFor({ state: "detached" });
      await page.close();
    });
  }

  it("removes the 4.x pack by keyboard, after confirmation, and keeps the 5.x one", async () => {
    const { page, card } = await openCard();
    await card.getByText("A4X · fixture.atlassian.net").waitFor();
    await card.getByRole("button", { name: "Remove 4.x pack" }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("alertdialog");
    await dialog.waitFor();
    assert.equal(
      await page.evaluate(() => document.activeElement?.textContent),
      "Cancel",
    );
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await card.getByText("The 4.x knowledge base was removed.").waitFor();
    await card.getByText("FX · fixture.atlassian.net").waitFor();
    assert.equal(
      await card
        .getByRole("region", { name: "Loaded knowledge base (4.x)" })
        .count(),
      0,
    );
    assert.deepEqual(await kbRecords(page), ["meta:5.x", "pack:5.x"]);
    await page.close();
  });
});
