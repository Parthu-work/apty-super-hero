/**
 * S3: deleting stored data reaches the agent's own session store
 * (IndexedDB apty-sessions), which holds raw tool outputs.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  chatAndWait,
  extensionPage,
  launchBrowser,
  openSidePanel,
  startMockModel,
  startPageServer,
} from "./harness.mjs";

let browser;
let model;
let site;

before(async () => {
  model = await startMockModel();
  model.script(() => ({ text: "RESULT: noted" }));
  site = await startPageServer({
    "/app.html": "<!doctype html><title>App</title><main>Hello</main>",
  });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

function readStore(page, dbName, storeName) {
  return page.evaluate(
    ({ dbName, storeName }) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open(dbName);
        // Reading must not create the database: the app creates it, with
        // its stores, when it first saves.
        open.onupgradeneeded = () => open.transaction.abort();
        open.onerror = () =>
          open.error?.name === "AbortError" ? resolve([]) : reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.close();
            resolve([]);
            return;
          }
          const req = db.transaction(storeName).objectStore(storeName).getAll();
          req.onsuccess = () => {
            db.close();
            resolve(req.result);
          };
          req.onerror = () => reject(req.error);
        };
      }),
    { dbName, storeName },
  );
}

const sessionIds = async (page) =>
  (await readStore(page, "apty-sessions", "sessions")).map((s) => s.id).sort();

const conversations = (page) =>
  readStore(page, "apty-conversations-db", "conversations");

async function waitFor(check, what, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** One chat in a fresh side panel; resolves when its conversation names its session. */
async function chatOnce(text) {
  const app = await browser.context.newPage();
  await app.goto(`${site.origin}/app.html`);
  const panel = await openSidePanel(browser, model, app);
  await chatAndWait(panel, text);
  const conversation = await waitFor(
    async () =>
      (await conversations(panel)).find(
        (c) => c.agentSessionId && c.title.startsWith(text),
      ),
    `the conversation for "${text}"`,
  );
  return { app, panel, conversation };
}

describe("deleting stored data", () => {
  it("Settings' delete empties the agent's session store", async () => {
    const first = await chatOnce("purge check");
    await first.panel.close();
    await first.app.close();

    const options = await extensionPage(browser);
    assert.notDeepEqual(await sessionIds(options), []);

    await options
      .getByRole("button", { name: "Delete stored data now" })
      .click();
    await options.getByRole("button", { name: "Delete everything" }).click();
    await waitFor(
      async () => (await sessionIds(options)).length === 0,
      "apty-sessions to be empty",
    );

    assert.deepEqual(await sessionIds(options), []);
    assert.deepEqual(await conversations(options), []);
    await options.close();
  });

  it("deleting one conversation removes only its agent session", async () => {
    const alpha = await chatOnce("alpha topic");
    await alpha.panel.close();
    await alpha.app.close();
    const beta = await chatOnce("beta topic");
    const alphaSession = alpha.conversation.agentSessionId;
    const betaSession = beta.conversation.agentSessionId;
    assert.notEqual(alphaSession, betaSession);
    assert.ok((await sessionIds(beta.panel)).includes(alphaSession));

    await beta.panel.getByRole("button", { name: "Menu", exact: true }).click();
    const menu = beta.panel.getByRole("dialog", { name: "Menu" });
    await menu.getByRole("button", { name: /^alpha topic/ }).hover();
    await menu
      .getByRole("button", { name: "Delete conversation: alpha topic" })
      .click();
    await beta.panel
      .getByRole("alertdialog", { name: "Delete this chat?" })
      .getByRole("button", { name: "Delete" })
      .click();

    await waitFor(
      async () => !(await sessionIds(beta.panel)).includes(alphaSession),
      "alpha's session to be deleted",
    );
    const remaining = await sessionIds(beta.panel);
    assert.ok(remaining.includes(betaSession));
    assert.ok(!remaining.includes(alphaSession));
    assert.deepEqual(
      (await conversations(beta.panel)).map((c) => c.agentSessionId),
      [betaSession],
    );
    await beta.panel.close();
    await beta.app.close();
  });
});
