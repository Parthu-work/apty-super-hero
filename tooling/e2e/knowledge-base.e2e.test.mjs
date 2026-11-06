/**
 * KB-RAG K3: a KB pack built by the K1 builder imports in Options →
 * Settings → Knowledge base, survives an extension restart, shows in
 * Preflight and is removed after confirmation. The card passes axe in both
 * themes and the removal works by keyboard. Synthetic cards only.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildPack } from "../scripts/kb/build-kb-pack.mjs";
import {
  describeViolations,
  extensionPage,
  launchBrowser,
  restartAgent,
  runAxe,
  tempDir,
  writeRestartHelper,
} from "./harness.mjs";

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
let tamperedFile;

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
  });
  packFile = join(dir, "apty-kb-FX-fixture.kbpack.json");
  writeFileSync(packFile, JSON.stringify(pack));
  tamperedFile = join(dir, "tampered.kbpack.json");
  writeFileSync(
    tamperedFile,
    JSON.stringify(pack).replace("Glowing Banner", "Glowing Banner edited"),
  );
  helperDir = writeRestartHelper(tempDir("apty-restart-helper-"));
  browser = await launchBrowser({ extraExtensions: [helperDir] });
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
  await card.getByRole("button", { name: /pack…/ }).waitFor();
  return { page, card };
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

describe("knowledge base pack (KB-RAG K3)", () => {
  it("imports a pack, names a tampered one, and keeps the pack across a restart", async () => {
    const { page, card } = await openCard();
    await card.getByText(/No knowledge base loaded/).waitFor();
    await card.getByTestId("knowledge-base-file").setInputFiles(packFile);
    await card.getByText("Imported 2 cards from space FX.").waitFor();
    const details = card.getByLabel("Loaded knowledge base");
    assert.match(await details.innerText(), /FX · fixture\.atlassian\.net/);
    assert.match(await details.innerText(), /Keyword \(BM25\)/);

    await card.getByTestId("knowledge-base-file").setInputFiles(tamperedFile);
    await card.getByText(/checksum does not match its contents/).waitFor();
    assert.deepEqual(await kbRecords(page), ["meta", "pack"]);
    await page.close();

    await restartAgent(browser, helperDir);
    const again = await openCard();
    await again.card.getByText("FX · fixture.atlassian.net").waitFor();
    await again.page.close();
  });

  it("shows the loaded pack in Preflight", async () => {
    const options = await extensionPage(
      browser,
      "src/entrypoints/options/index.html#preflight",
    );
    await options.getByRole("button", { name: "Run all checks" }).click();
    const row = options.locator('li[data-check="knowledge-base"]');
    await row.waitFor({ timeout: 90_000 });
    assert.equal(await row.getAttribute("data-status"), "pass");
    assert.match(
      await row.innerText(),
      /Loaded: 2 cards from space FX, built \d{4}-\d{2}-\d{2}\./,
    );
    await options.close();
  });

  for (const theme of ["light", "dark"]) {
    it(`has no serious accessibility violations with a pack loaded, in the ${theme} theme`, async () => {
      const { page, card } = await openCard(theme);
      await card.getByText("FX · fixture.atlassian.net").waitFor();
      const violations = await runAxe(page);
      assert.deepEqual(violations, [], describeViolations(violations));

      await card.getByRole("button", { name: "Remove" }).click();
      await page.getByRole("alertdialog").waitFor();
      const inDialog = await runAxe(page);
      assert.deepEqual(inDialog, [], describeViolations(inDialog));
      await page.keyboard.press("Escape");
      await page.getByRole("alertdialog").waitFor({ state: "detached" });
      await page.close();
    });
  }

  it("removes the pack by keyboard, after confirmation", async () => {
    const { page, card } = await openCard();
    await card.getByText("FX · fixture.atlassian.net").waitFor();
    await card.getByRole("button", { name: "Remove" }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("alertdialog");
    await dialog.waitFor();
    assert.equal(
      await page.evaluate(() => document.activeElement?.textContent),
      "Cancel",
    );
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await card.getByText("Knowledge base removed.").waitFor();
    await card.getByText(/No knowledge base loaded/).waitFor();
    assert.deepEqual(await kbRecords(page), []);
    await page.close();
  });
});
