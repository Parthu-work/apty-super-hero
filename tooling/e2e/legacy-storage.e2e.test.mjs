/**
 * R2: data an earlier version stored under the upstream AIPex names moves to
 * the Apty names when the Agent starts again, and pages the Agent works on
 * carry only Apty names.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  chatAndWait,
  extensionPage,
  launchBrowser,
  openSidePanel,
  restartAgent,
  startMockModel,
  startPageServer,
  tempDir,
  toolResults,
  writeRestartHelper,
} from "./harness.mjs";

let browser;
let model;
let site;
let helperDir;

const GRANT = {
  toolName: "click",
  origin: "https://grant.example",
  requester: "chat",
  expiresAt: Date.now() + 10 * 60_000,
};

before(async () => {
  model = await startMockModel();
  site = await startPageServer({
    "/app.html":
      "<!doctype html><title>App</title><main><button>Deploy now</button></main>",
  });
  helperDir = writeRestartHelper(join(tempDir("apty-e2e-helper-"), "helper"));
  browser = await launchBrowser({ extraExtensions: [helperDir] });
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

/** Every IndexedDB row of `storeName` in `dbName`, or null when the database doesn't exist. */
function readDb(page, dbName, storeName) {
  return page.evaluate(
    async ({ dbName, storeName }) => {
      const names = (await indexedDB.databases()).map((db) => db.name);
      if (!names.includes(dbName)) return null;
      return new Promise((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction(storeName).objectStore(storeName).getAll();
          req.onsuccess = () => {
            db.close();
            resolve(req.result);
          };
          req.onerror = () => reject(req.error);
        };
      });
    },
    { dbName, storeName },
  );
}

/** Put the agent's sessions back under the old database name, as an earlier version left them. */
function moveSessionsToLegacyDb(page) {
  return page.evaluate(async () => {
    const readAll = () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("apty-sessions");
        open.onsuccess = () => {
          const db = open.result;
          const req = db
            .transaction("sessions")
            .objectStore("sessions")
            .getAll();
          req.onsuccess = () => {
            db.close();
            resolve(req.result);
          };
          req.onerror = () => reject(req.error);
        };
        open.onerror = () => reject(open.error);
      });
    const rows = await readAll();
    await new Promise((resolve, reject) => {
      const open = indexedDB.open("aipex-sessions", 1);
      open.onupgradeneeded = () =>
        open.result.createObjectStore("sessions", { keyPath: "id" });
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("sessions", "readwrite");
        for (const row of rows) tx.objectStore("sessions").put(row);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
    await new Promise((resolve, reject) => {
      const del = indexedDB.deleteDatabase("apty-sessions");
      del.onsuccess = resolve;
      del.onerror = () => reject(del.error);
    });
    return rows.map((row) => row.id).sort();
  });
}

async function poll(check, what, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe("data stored under the AIPex names (R2)", () => {
  it("keeps settings, grants, conversations and agent sessions after a restart, under the Apty names", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    model.script(() => ({ text: "RESULT: first" }));
    const panel = await openSidePanel(browser, model, app);
    await chatAndWait(panel, "hello");

    const probe = await extensionPage(browser);
    const settings = await probe.evaluate(
      async () =>
        (await chrome.storage.local.get("apty_settings")).apty_settings,
    );
    const conversationsBefore = await poll(async () => {
      const rows = await readDb(
        probe,
        "aipex-conversations-db",
        "conversations",
      );
      return rows?.length ? rows : null;
    }, "the chat to be saved");
    await panel.close();
    await probe.evaluate(
      async ({ settings, grant }) => {
        await chrome.storage.local.remove([
          "apty_settings",
          "apty_risky_origin_grants",
        ]);
        await chrome.storage.local.set({
          aipex_settings: settings,
          aipex_risky_origin_grants: [grant],
        });
      },
      { settings, grant: GRANT },
    );
    const sessionIds = await moveSessionsToLegacyDb(probe);
    assert.ok(sessionIds.length >= 1, "the agent kept a session");
    await probe.close();

    await restartAgent(browser, helperDir);

    const after = await extensionPage(browser);
    const stored = await poll(async () => {
      const all = await after.evaluate(() => chrome.storage.local.get(null));
      return all.apty_settings && !("aipex_settings" in all) ? all : null;
    }, "the settings to move");
    assert.deepEqual(stored.apty_settings, settings);
    assert.deepEqual(stored.apty_risky_origin_grants, [GRANT]);
    assert.ok(
      !Object.keys(stored).some((key) => key.startsWith("aipex")),
      Object.keys(stored).join(", "),
    );
    const sessions = await poll(async () => {
      const legacy = await readDb(after, "aipex-sessions", "sessions");
      const rows = await readDb(after, "apty-sessions", "sessions");
      return legacy === null && rows ? rows : null;
    }, "the sessions to move");
    assert.deepEqual(sessions.map((row) => row.id).sort(), sessionIds);
    assert.deepEqual(
      (await readDb(after, "aipex-conversations-db", "conversations")).map(
        (c) => c.id,
      ),
      conversationsBefore.map((c) => c.id),
    );

    await after.getByText("https://grant.example").first().waitFor();
    await after.close();

    // The moved settings still drive the chat: no settings are written here.
    const panelAgain = await extensionPage(
      browser,
      "src/entrypoints/sidepanel/index.html",
    );
    await panelAgain.locator("textarea").first().waitFor();
    model.script(() => ({ text: "RESULT: second" }));
    await app.bringToFront();
    assert.match(await chatAndWait(panelAgain, "again"), /RESULT: second/);
    await panelAgain.close();
    await app.close();
  });

  it("leaves only Apty names on a page the agent worked on", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const probe = await extensionPage(browser);
    const tabId = await probe.evaluate(
      async (url) => (await chrome.tabs.query({ url })).at(0)?.id,
      `${site.origin}/app.html`,
    );
    await probe.close();
    model.script((request) =>
      toolResults(request).length === 0
        ? { tool: "search_elements", args: { tabId, query: "*Deploy*" } }
        : { text: "RESULT: found" },
    );
    const panel = await openSidePanel(browser, model, app);
    // "click" offers the UI tools, search_elements among them.
    await chatAndWait(panel, "click the deploy button on this page");
    await panel.close();

    const html = await app.evaluate(() => document.documentElement.outerHTML);
    assert.match(html, /data-apty-nodeid=/);
    assert.doesNotMatch(html, /aipex/i);
    await app.close();
  });
});
