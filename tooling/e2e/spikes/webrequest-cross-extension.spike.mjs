/**
 * Spike: can one extension's passive chrome.webRequest listener see the
 * requests another extension's service worker makes? Stands in for "the
 * Agent observes the Apty Client's network calls with no Client change".
 *
 * Loads, next to the Agent, an observer extension (webRequest + <all_urls>,
 * listeners on onCompleted and onErrorOccurred, recording to
 * chrome.storage.session) and a widget extension whose service worker
 * fetches a local test-server URL. A page in a normal tab fetches the same
 * server as a control. The observer is then left idle past Chrome's
 * service-worker idle timeout and the widget fetches again.
 *
 * Run: npm run build && node tooling/e2e/spikes/webrequest-cross-extension.spike.mjs
 * Prints the evidence as JSON. Not part of the e2e suite.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  launchBrowser,
  startPageServer,
  tempDir,
  unpackedExtensionId,
  waitForWorker,
} from "../harness.mjs";

const IDLE_MS = 45_000;

function writeExtension(dir, manifest, background, page) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, "background.js"), background);
  if (page) writeFileSync(join(dir, "page.html"), page);
  return dir;
}

const base = tempDir("apty-spike-webrequest-");
const observerDir = writeExtension(
  join(base, "observer"),
  {
    manifest_version: 3,
    name: "WebRequest observer (spike)",
    version: "1.0.0",
    permissions: ["webRequest", "storage"],
    host_permissions: ["<all_urls>"],
    background: { service_worker: "background.js" },
  },
  `
const record = (event) => (details) => {
  if (!details.url.includes("/spike/")) return;
  chrome.storage.session.get("seen").then(({ seen = [] }) =>
    chrome.storage.session.set({
      seen: [...seen, {
        event,
        url: details.url,
        initiator: details.initiator,
        tabId: details.tabId,
        type: details.type,
        statusCode: details.statusCode,
        error: details.error,
      }],
    }),
  );
};
chrome.webRequest.onCompleted.addListener(record("completed"), { urls: ["<all_urls>"] });
chrome.webRequest.onErrorOccurred.addListener(record("error"), { urls: ["<all_urls>"] });
`,
  `<!doctype html><title>observer</title><script src="page.js"></script>`,
);
writeFileSync(join(observerDir, "page.js"), "");
const widgetDir = writeExtension(
  join(base, "widget"),
  {
    manifest_version: 3,
    name: "Widget fixture (spike)",
    version: "1.0.0",
    host_permissions: ["<all_urls>"],
    background: { service_worker: "background.js" },
  },
  "// Fetches are started from the test through this worker.\n",
);
const observerId = unpackedExtensionId(observerDir);
const widgetId = unpackedExtensionId(widgetDir);

const site = await startPageServer({
  "/page.html": "<title>page</title>",
  "/spike/data.json": '{"ok":true}',
});
const browser = await launchBrowser({
  extraExtensions: [observerDir, widgetDir],
});

const evidence = {
  chrome: browser.context.browser()?.version() ?? "unknown",
  observerId,
  widgetId,
  widgetOrigin: `chrome-extension://${widgetId}`,
};

async function seen() {
  const page = await browser.context.newPage();
  await page.goto(`chrome-extension://${observerId}/page.html`);
  const { seen = [] } = await page.evaluate(() =>
    chrome.storage.session.get("seen"),
  );
  await page.close();
  return seen;
}

try {
  const observer = await waitForWorker(browser.context, (url) =>
    url.startsWith(`chrome-extension://${observerId}/`),
  );
  const widget = await waitForWorker(browser.context, (url) =>
    url.startsWith(`chrome-extension://${widgetId}/`),
  );
  let observerStopped = false;
  observer.on("close", () => {
    observerStopped = true;
  });

  const tab = await browser.context.newPage();
  await tab.goto(`${site.origin}/page.html`);
  await tab.evaluate(
    (url) => fetch(url).then((r) => r.status),
    `${site.origin}/spike/data.json?from=tab`,
  );
  const widgetFetch = (query) =>
    widget.evaluate(
      (url) =>
        fetch(url).then(
          (r) => r.status,
          (e) => String(e),
        ),
      `${site.origin}/spike/data.json?from=widget-${query}`,
    );
  evidence.widgetFetchStatus = await widgetFetch("active");
  evidence.widgetFailedFetch = await widget.evaluate(() =>
    fetch("http://127.0.0.1:9/spike/refused.json").then(
      (r) => r.status,
      (e) => String(e),
    ),
  );
  await new Promise((r) => setTimeout(r, 1500));
  evidence.seenWhileActive = await seen();

  await new Promise((r) => setTimeout(r, IDLE_MS));
  evidence.observerWorkerStoppedWhileIdle = observerStopped;
  evidence.widgetFetchAfterIdleStatus = await widgetFetch("after-idle");
  await tab.evaluate(
    (url) => fetch(url).then((r) => r.status),
    `${site.origin}/spike/data.json?from=tab-after-idle`,
  );
  await new Promise((r) => setTimeout(r, 1500));
  evidence.seenAfterIdle = await seen();

  const fromWidget = (list) =>
    list.filter(
      (s) => s.url.includes("from=widget") || s.url.includes("refused"),
    );
  evidence.summary = {
    controlTabRequestSeen: evidence.seenWhileActive.some((s) =>
      s.url.includes("from=tab"),
    ),
    widgetRequestsSeen: fromWidget(evidence.seenAfterIdle).length,
    controlTabRequestSeenAfterIdle: evidence.seenAfterIdle.some((s) =>
      s.url.includes("from=tab-after-idle"),
    ),
  };
} finally {
  console.log(JSON.stringify(evidence, null, 2));
  await browser.close();
  site.close();
}
