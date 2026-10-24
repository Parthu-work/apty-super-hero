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

/** Opens `dbName` at the version the Agent itself asks for; the error name if it can't. */
function openAsTheAgentDoes(page, dbName, version) {
  return page.evaluate(
    ({ dbName, version }) =>
      new Promise((resolve) => {
        const open = indexedDB.open(dbName, version);
        open.onsuccess = () => {
          const stores = Array.from(open.result.objectStoreNames);
          open.result.close();
          resolve(stores);
        };
        open.onerror = () => resolve(open.error?.name ?? "error");
      }),
    { dbName, version },
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

/**
 * Copy database `from` (every store, index and record with its key) to `to`,
 * then start deleting `from`. The delete finishes once no page holds `from`
 * open, at the latest when the Agent restarts.
 */
function renameDatabaseInPage(page, from, to) {
  return page.evaluate(
    async ({ from, to }) => {
      const req = (r) =>
        new Promise((resolve, reject) => {
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
      const source = await req(indexedDB.open(from));
      const shapes = [];
      for (const name of Array.from(source.objectStoreNames)) {
        const store = source.transaction(name).objectStore(name);
        const keys = await req(store.getAllKeys());
        const values = await req(store.getAll());
        shapes.push({
          name,
          keyPath: store.keyPath,
          autoIncrement: store.autoIncrement,
          indexes: Array.from(store.indexNames).map((n) => {
            const index = store.index(n);
            return { name: n, keyPath: index.keyPath, unique: index.unique };
          }),
          records: keys.map((key, i) => ({ key, value: values[i] })),
        });
      }
      const version = source.version;
      source.close();
      const open = indexedDB.open(to, version);
      open.onupgradeneeded = () => {
        for (const shape of shapes) {
          const store = open.result.createObjectStore(shape.name, {
            keyPath: shape.keyPath ?? undefined,
            autoIncrement: shape.autoIncrement,
          });
          for (const index of shape.indexes) {
            store.createIndex(index.name, index.keyPath, {
              unique: index.unique,
            });
          }
        }
      };
      const target = await req(open);
      for (const shape of shapes) {
        const store = target
          .transaction(shape.name, "readwrite")
          .objectStore(shape.name);
        for (const { key, value } of shape.records) {
          await req(
            shape.keyPath === null ? store.put(value, key) : store.put(value),
          );
        }
      }
      target.close();
      indexedDB.deleteDatabase(from);
    },
    { from, to },
  );
}

/** Create database `name` with one store, its indexes and these records, as an earlier version would have. */
function createDatabaseInPage(
  page,
  name,
  storeName,
  keyPath,
  records,
  indexes = [],
) {
  return page.evaluate(
    async ({ name, storeName, keyPath, records, indexes }) => {
      const open = indexedDB.open(name, 1);
      open.onupgradeneeded = () => {
        const store = open.result.createObjectStore(
          storeName,
          keyPath ? { keyPath } : {},
        );
        for (const index of indexes) {
          store.createIndex(index, index, { unique: false });
        }
      };
      const db = await new Promise((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const tx = db.transaction(storeName, "readwrite");
      for (const { key, value } of records) {
        if (keyPath) tx.objectStore(storeName).put(value);
        else tx.objectStore(storeName).put(value, key);
      }
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { name, storeName, keyPath, records, indexes },
  );
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

const LEGACY_SKILL = {
  id: "legacy-skill",
  name: "legacy-skill",
  description: "A skill an earlier version listed",
  version: "1.0.0",
  uploadedAt: 1,
  enabled: true,
};

/** The record, index names and version of `skills` in apty-skills-db, or null. */
function readSkillsDb(page) {
  return page.evaluate(async (id) => {
    const names = (await indexedDB.databases()).map((db) => db.name);
    if (!names.includes("apty-skills-db")) return null;
    const open = indexedDB.open("apty-skills-db");
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const store = db.transaction("skills").objectStore("skills");
    const record = await new Promise((resolve, reject) => {
      const get = store.index("name").get(id);
      get.onsuccess = () => resolve(get.result ?? null);
      get.onerror = () => reject(get.error);
    });
    const result = {
      record,
      keyPath: store.keyPath,
      indexes: Array.from(store.indexNames).sort(),
      version: db.version,
    };
    db.close();
    return result;
  }, LEGACY_SKILL.id);
}

describe("data stored under the AIPex names (R2)", () => {
  // Runs first: the next test's stand-in ZenFS record is not a real ZenFS
  // file system, so skills can't load after it.
  it("keeps the skills list after a restart, under apty-skills-db", async () => {
    const probe = await extensionPage(browser);
    await createDatabaseInPage(
      probe,
      "AIPexSkills",
      "skills",
      "id",
      [{ value: LEGACY_SKILL }],
      ["name", "enabled"],
    );
    await probe.close();

    await restartAgent(browser, helperDir);

    const after = await extensionPage(browser);
    const skills = await poll(async () => {
      const names = await after.evaluate(async () =>
        (await indexedDB.databases()).map((db) => db.name),
      );
      if (names.includes("AIPexSkills")) return null;
      const moved = await readSkillsDb(after);
      return moved?.record ? moved : null;
    }, "the skills to move");
    assert.deepEqual(skills, {
      record: LEGACY_SKILL,
      keyPath: "id",
      indexes: ["enabled", "name"],
      version: 1,
    });
    await after.close();

    const options = await extensionPage(
      browser,
      "src/entrypoints/options/index.html?tab=skills",
    );
    await options.getByText(LEGACY_SKILL.description).waitFor();
    await options
      .getByText(/extends the Apty Agent's capabilities/)
      .first()
      .waitFor();
    await options.close();
  });

  it("keeps settings, grants, conversations, agent sessions, screenshots and skill files after a restart, under the Apty names", async () => {
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
        "apty-conversations-db",
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
    await renameDatabaseInPage(
      probe,
      "apty-conversations-db",
      "aipex-conversations-db",
    );
    await createDatabaseInPage(
      probe,
      "aipex-screenshots-db",
      "screenshots",
      "uid",
      [{ value: { uid: "screenshot_1_legacy", timestamp: 1, tabId: 1 } }],
    );
    // ZenFS names its one store after the database and keeps keys outside the records.
    await createDatabaseInPage(
      probe,
      "aipex-skills-fs",
      "aipex-skills-fs",
      null,
      [{ key: "/skills/demo/SKILL.md", value: "# Demo skill" }],
    );
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
    const conversations = await poll(async () => {
      const legacy = await readDb(
        after,
        "aipex-conversations-db",
        "conversations",
      );
      const rows = await readDb(
        after,
        "apty-conversations-db",
        "conversations",
      );
      return legacy === null && rows?.length ? rows : null;
    }, "the conversations to move");
    assert.deepEqual(
      conversations.map((c) => c.id).sort(),
      conversationsBefore.map((c) => c.id).sort(),
    );
    const screenshots = await poll(async () => {
      const legacy = await readDb(after, "aipex-screenshots-db", "screenshots");
      const rows = await readDb(after, "apty-screenshots-db", "screenshots");
      return legacy === null && rows ? rows : null;
    }, "the screenshots to move");
    assert.ok(
      screenshots.some((row) => row.uid === "screenshot_1_legacy"),
      JSON.stringify(screenshots),
    );
    const skillFile = await poll(async () => {
      const legacy = await readDb(after, "aipex-skills-fs", "aipex-skills-fs");
      if (legacy !== null) return null;
      return after.evaluate(async () => {
        const open = indexedDB.open("apty-skills-fs");
        const db = await new Promise((resolve, reject) => {
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        });
        if (!db.objectStoreNames.contains("apty-skills-fs")) return null;
        const get = db
          .transaction("apty-skills-fs")
          .objectStore("apty-skills-fs")
          .get("/skills/demo/SKILL.md");
        return new Promise((resolve) => {
          get.onsuccess = () => resolve(get.result ?? null);
        });
      });
    }, "the skill files to move");
    assert.equal(skillFile, "# Demo skill");
    assert.deepEqual(
      await openAsTheAgentDoes(after, "apty-conversations-db", 1),
      ["conversations"],
    );
    assert.deepEqual(
      await openAsTheAgentDoes(after, "apty-screenshots-db", 1),
      ["screenshots"],
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
    await poll(async () => {
      const rows = await readDb(
        panelAgain,
        "apty-conversations-db",
        "conversations",
      );
      return rows && rows.length > conversationsBefore.length ? rows : null;
    }, "the chat after the move to be saved");
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
