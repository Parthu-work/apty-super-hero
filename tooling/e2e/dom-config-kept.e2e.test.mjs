/**
 * KB-RAG K26 C1 (D-DOM1): a held DOM Config capture survives a browser
 * restart. A capture taken in the real side panel is kept on the device as
 * the panel held it, nothing more; after Chromium closes and relaunches on
 * the same profile, the DOM Config page offers to resume it and Resume
 * holds it again; Clear results deletes it, so the next launch offers
 * nothing. Retention and Discard capture are covered by the unit and
 * component tests (capture-keeper.test.ts, dom-config-page.test.tsx).
 */
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { startDomConfigApp } from "./fixtures/dom-config-app.mjs";
import {
  extensionPage,
  launchBrowser,
  openSidePanel,
  startMockModel,
  tempDir,
} from "./harness.mjs";

/** What capture-keeper.ts writes: the panel's own state, no more. */
const KEPT_FIELDS = [
  "capture",
  "coverageMarks",
  "crawlMs",
  "crawlOptions",
  "outcome",
  "savedAt",
];

let model;
let app;
let profileDir;
let browser;

before(async () => {
  [model, app] = await Promise.all([startMockModel(), startDomConfigApp()]);
  profileDir = tempDir("apty-e2e-kept-profile-");
});

after(async () => {
  await browser?.close();
  model?.close();
  app?.close();
  rmSync(profileDir, { recursive: true, force: true });
});

/** Opens the DOM Config page in the side panel, with the fixture's /home in front. */
async function openDomConfig() {
  const target = await browser.context.newPage();
  await target.goto(`${app.origin}/home`);
  const panel = await openSidePanel(browser, model, target);
  const composer = panel.locator("textarea").first();
  await composer.fill("/config");
  await panel
    .getByRole("option", { name: /^DOM config/, selected: true })
    .waitFor();
  await composer.press("Enter");
  await panel.getByRole("region", { name: "DOM config" }).waitFor();
  return panel;
}

/** The kept record in the extension's apty-dom-config-db, or null. */
async function keptRecord() {
  const page = await extensionPage(browser);
  try {
    return await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("apty-dom-config-db", 1);
          open.onupgradeneeded = () => {
            if (!open.result.objectStoreNames.contains("records")) {
              open.result.createObjectStore("records");
            }
          };
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const get = open.result
              .transaction("records")
              .objectStore("records")
              .get("held");
            get.onsuccess = () => {
              open.result.close();
              resolve(get.result ?? null);
            };
            get.onerror = () => reject(get.error);
          };
        }),
    );
  } finally {
    await page.close();
  }
}

async function waitForKept(predicate, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let record = await keptRecord();
  while (!predicate(record) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    record = await keptRecord();
  }
  return record;
}

describe("a DOM Config capture kept on the device (K26 C1)", () => {
  it("keeps a capture as the panel held it, resumes it after a browser restart, and Clear results deletes it", async () => {
    browser = await launchBrowser({ profileDir });
    let panel = await openDomConfig();
    await panel.getByRole("radio", { name: /^This page only/ }).click();
    await panel.getByRole("button", { name: "Start capture" }).click();
    await panel
      .getByText("Capture complete", { exact: true })
      .waitFor({ timeout: 90_000 });

    const kept = await waitForKept((record) => record !== null);
    assert.ok(kept, "the capture was not kept");
    assert.deepEqual(Object.keys(kept).sort(), KEPT_FIELDS);
    assert.equal(kept.capture.pages.length, 1);
    const pageId = kept.capture.pages[0].pageId;

    // A browser restart: Chromium closes and relaunches on the same profile.
    await browser.close();
    browser = await launchBrowser({ profileDir });
    panel = await openDomConfig();
    const offer = panel.getByTestId("dom-config-kept");
    await offer.waitFor({ timeout: 15_000 });
    assert.match(
      await offer.innerText(),
      /1 pages, saved \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(UTC\)/,
    );
    await panel.getByRole("button", { name: "Resume capture" }).click();
    await panel.getByText("Capture complete", { exact: true }).waitFor();
    assert.equal(await offer.count(), 0);
    assert.equal(
      (await keptRecord())?.capture.pages[0].pageId,
      pageId,
      "resuming changed the kept capture",
    );

    await panel.getByRole("button", { name: "Clear results" }).click();
    assert.equal(
      await waitForKept((record) => record === null),
      null,
      "Clear results left the capture on the device",
    );

    // The next launch offers nothing.
    await browser.close();
    browser = await launchBrowser({ profileDir });
    panel = await openDomConfig();
    await panel.getByRole("button", { name: "Start capture" }).waitFor();
    // Give the page's on-device check time to answer before asserting nothing came.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    assert.equal(await panel.getByTestId("dom-config-kept").count(), 0);
  });
});
