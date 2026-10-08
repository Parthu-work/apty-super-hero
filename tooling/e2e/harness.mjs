/**
 * Shared helpers for the real-browser tests: launches Chromium with the
 * built extension (plus optional fixture extensions), serves test pages,
 * fakes an OpenAI-compatible model so the real agent loop can be driven
 * deterministically, and opens the real side panel UI.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
/** The built extension under test; E2E_EXTENSION_DIR points at another build (e.g. main's) for comparison. */
export const EXTENSION_DIR =
  process.env.E2E_EXTENSION_DIR ?? join(ROOT, "apps/browser-extension/dist");

export function chromiumPath() {
  if (process.env.E2E_CHROMIUM_PATH) return process.env.E2E_CHROMIUM_PATH;
  if (existsSync("/opt/pw-browsers/chromium"))
    return "/opt/pw-browsers/chromium";
  const require = createRequire(
    join(ROOT, "packages/browser-runtime/package.json"),
  );
  return require("puppeteer").executablePath();
}

export function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** HTTP server on a random loopback port; `handler(req, res, body)`. */
export async function startServer(handler) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => {
      body += d;
    });
    req.on("end", () => handler(req, res, body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.origin = `http://127.0.0.1:${server.address().port}`;
  return server;
}

/** Serves fixed pages by path. */
export function startPageServer(pages) {
  return startServer((req, res) => {
    const page = pages[new URL(req.url, "http://x").pathname];
    if (page === undefined) {
      res.writeHead(404).end();
      return;
    }
    const isJson = req.url.endsWith(".json");
    res.writeHead(200, {
      "content-type": isJson ? "application/json" : "text/html",
    });
    res.end(typeof page === "function" ? page() : page);
  });
}

/**
 * Launch Chromium with the built Agent extension and any `extraExtensions`
 * (directories). Resolves the Agent's extension id from its service worker.
 */
export async function launchBrowser({ extraExtensions = [] } = {}) {
  if (!existsSync(join(EXTENSION_DIR, "manifest.json"))) {
    throw new Error("Build the extension first (npm run build).");
  }
  const userDataDir = tempDir("apty-e2e-profile-");
  const all = [EXTENSION_DIR, ...extraExtensions].join(",");
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromiumPath(),
    headless: true,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${all}`, `--load-extension=${all}`],
  });
  const agentWorker = await waitForWorker(context, (url) =>
    url.endsWith("/service-worker-loader.js"),
  );
  const extensionId = new URL(agentWorker.url()).host;
  await closeInstallOptionsTab(context, extensionId);
  return {
    context,
    extensionId,
    agentWorker,
    async close() {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

/**
 * The extension opens its Options page on install. Close that tab first, or
 * a test opening Options at the same moment gets its navigation interrupted
 * when Chrome reuses the tab.
 */
async function closeInstallOptionsTab(context, extensionId) {
  const isOptions = (page) =>
    page.url().startsWith(`chrome-extension://${extensionId}/`) &&
    page.url().includes("/options/");
  const page =
    context.pages().find(isOptions) ??
    (await context
      .waitForEvent("page", { predicate: isOptions, timeout: 5000 })
      .catch(() => undefined));
  await page?.close();
}

export async function waitForWorker(context, predicate, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = context.serviceWorkers().find((w) => predicate(w.url()));
    if (found) return found;
    await context
      .waitForEvent("serviceworker", { timeout: 1000 })
      .catch(() => undefined);
  }
  throw new Error("Service worker did not start");
}

/** An extension page of the Agent, for calling chrome.* APIs. */
export async function extensionPage(
  browser,
  path = "src/entrypoints/options/index.html",
) {
  const page = await browser.context.newPage();
  await page.goto(`chrome-extension://${browser.extensionId}/${path}`);
  return page;
}

// ---------------------------------------------------------------------------
// Mock model
// ---------------------------------------------------------------------------

function sse(res, chunks) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.end("data: [DONE]\n\n");
}

function chunk(delta, finish = null) {
  return {
    id: "mock",
    object: "chat.completion.chunk",
    created: 1,
    model: "mock",
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

/**
 * OpenAI-compatible chat-completions endpoint driven by `respond(request)`,
 * which returns `{ tool: name, args }` to make a tool call or `{ text }` to
 * answer. Every request body is kept in `requests`.
 */
export async function startMockModel() {
  let respond = () => ({ text: "No script set." });
  let callCount = 0;
  const requests = [];
  const server = await startServer(async (req, res, body) => {
    if (!req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const request = JSON.parse(body);
    requests.push(request);
    const reply = await respond(request, requests.length);
    if (reply.tool) {
      callCount += 1;
      sse(res, [
        chunk({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `call_${callCount}`,
              type: "function",
              function: {
                name: reply.tool,
                arguments: JSON.stringify(reply.args ?? {}),
              },
            },
          ],
        }),
        chunk({}, "tool_calls"),
      ]);
      return;
    }
    sse(res, [
      chunk({ role: "assistant", content: reply.text }),
      chunk({}, "stop"),
    ]);
  });
  return {
    server,
    requests,
    baseUrl: `${server.origin}/v1`,
    script(fn) {
      respond = fn;
      requests.length = 0;
    },
    close: () => server.close(),
  };
}

/**
 * Tool results from the current turn (after the last user message), newest
 * last, parsed when JSON. Earlier turns of the same chat are ignored.
 */
export function toolResults(request) {
  const messages = request.messages ?? [];
  const lastUser = messages.findLastIndex((m) => m.role === "user");
  return messages
    .slice(lastUser + 1)
    .filter((m) => m.role === "tool")
    .map((m) => {
      const text =
        typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    });
}

/**
 * The common two-step script: call one tool, then answer with
 * `RESULT:` + the tool result so the test can read it in the UI too.
 */
export function callToolThenReport(tool, args) {
  return (request) => {
    const results = toolResults(request);
    if (results.length === 0) return { tool, args };
    return { text: `RESULT: ${JSON.stringify(results.at(-1)).slice(0, 400)}` };
  };
}

// ---------------------------------------------------------------------------
// Side panel
// ---------------------------------------------------------------------------

/**
 * Open the real side panel UI in a background tab of the same window as
 * `targetPage`, configured to use `model`, with `targetPage` active so the
 * conversation binds to it exactly as the docked side panel would.
 */
export async function openSidePanel(browser, model, targetPage, settings = {}) {
  const panel = await extensionPage(
    browser,
    "src/entrypoints/sidepanel/index.html",
  );
  panel.consoleErrors = [];
  panel.on("console", (m) => {
    if (m.type() === "error") panel.consoleErrors.push(m.text());
  });
  await panel.evaluate(
    async ({ baseUrl, settings }) => {
      await chrome.storage.local.set({
        aipex_settings: {
          aiProvider: "custom",
          aiHost: baseUrl,
          aiToken: "e2e-key",
          aiModel: "mock-model",
          providerEnabled: true,
          ...settings,
        },
      });
    },
    { baseUrl: model.baseUrl, settings },
  );
  await panel.reload();
  await panel.locator("textarea").first().waitFor();
  await targetPage.bringToFront();
  return panel;
}

export async function sendChat(panel, text) {
  const box = panel.locator("textarea").first();
  await box.fill(text);
  await box.press("Enter");
}

/**
 * Send `text` and resolve once a new reply matching `pattern` appears
 * (earlier replies in the same chat do not count). `whileWaiting` runs
 * after sending, e.g. to answer an approval prompt.
 */
export async function chatAndWait(
  panel,
  text,
  { pattern = /^RESULT:/, timeout = 60_000, whileWaiting } = {},
) {
  const replies = panel.getByText(pattern);
  const before = await replies.count();
  await sendChat(panel, text);
  await whileWaiting?.();
  const deadline = Date.now() + timeout;
  while ((await replies.count()) <= before) {
    if (Date.now() > deadline) {
      throw new Error(`No new reply matching ${pattern} to "${text}"`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return replies.last().innerText();
}

// ---------------------------------------------------------------------------
// Fake Apty Client extensions
// ---------------------------------------------------------------------------

const CLIENT_BACKGROUND = `
const MODE = __MODE__;
const AGENT_ID = __AGENT_ID__;
const SEGMENTS = Array.from({ length: 206 }, (_, i) => ({
  id: 4000 + i,
  name: "segment-" + i,
  description: "Segment number " + i + " ".repeat(400),
}));
const RESOURCES = [
  { requestId: "r1", url: "https://cdn.apty.example/config/segment.json", method: "GET", status: 200, mimeType: "application/json", timestamp: Date.now() },
  { requestId: "r2", url: "https://cdn.apty.example/config/themes.json", method: "GET", status: 403, mimeType: "application/json", timestamp: Date.now() },
];
const BODIES = {
  r1: JSON.stringify(SEGMENTS),
  r2: JSON.stringify({ error: "Forbidden", reason: "token expired" }),
};
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (sender.id !== AGENT_ID || MODE === "bridge-missing") return false;
  switch (message?.type) {
    case "apty-debug-agent:get-service-worker-status":
      sendResponse({ running: true, lastActivity: Date.now() });
      return true;
    case "apty-debug-agent:get-service-worker-logs":
      sendResponse({ logs: [
        { level: "error", message: "Failed to load themes.json: 403", timestamp: Date.now() },
        { level: "log", message: "widget initialised", timestamp: Date.now() },
      ] });
      return true;
    case "apty-debug-agent:list-observed-resources":
      sendResponse({ resources: RESOURCES });
      return true;
    case "apty-debug-agent:get-resource-body":
      sendResponse(BODIES[message.requestId]
        ? { found: true, body: BODIES[message.requestId], base64Encoded: false }
        : { found: false });
      return true;
    default:
      return false;
  }
});
`;

/**
 * Write a fake Apty Client extension. `mode`: "working" answers the whole
 * contract; "bridge-missing" lists the Agent but answers nothing;
 * "not-allowlisted" allow-lists a different extension only. (With no
 * `externally_connectable` key at all, Chrome lets every extension in.)
 */
export function writeFakeClient(dir, mode, agentId) {
  mkdirSync(dir, { recursive: true });
  const manifest = {
    manifest_version: 3,
    name: `Apty Client E2E (${mode})`,
    version: "1.0.0",
    background: { service_worker: "background.js" },
    externally_connectable: {
      ids: [mode === "not-allowlisted" ? "a".repeat(32) : agentId],
    },
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(
    join(dir, "background.js"),
    CLIENT_BACKGROUND.replace("__MODE__", JSON.stringify(mode)).replace(
      "__AGENT_ID__",
      JSON.stringify(agentId),
    ),
  );
  return dir;
}

/**
 * A helper extension with the `management` permission. Disabling and
 * re-enabling the Agent through it orphans the Agent's content scripts in
 * already-open tabs, exactly like an extension update does; Chrome does not
 * re-inject declared content scripts into those tabs.
 * (`chrome.runtime.reload()` leaves a --load-extension extension unloaded
 * in headless Chromium, so it can't be used for this.)
 */
export function writeRestartHelper(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Apty E2E restart helper",
      version: "1.0.0",
      permissions: ["management"],
      background: { service_worker: "background.js" },
    }),
  );
  writeFileSync(
    join(dir, "background.js"),
    "self.restartExtension = async (id) => { await chrome.management.setEnabled(id, false); await chrome.management.setEnabled(id, true); };",
  );
  return dir;
}

/** Disable and re-enable the Agent via the helper from `writeRestartHelper`. */
export async function restartAgent(browser, helperDir) {
  const helperId = unpackedExtensionId(helperDir);
  const helper = await waitForWorker(browser.context, (url) =>
    url.includes(helperId),
  );
  await helper.evaluate((id) => self.restartExtension(id), browser.extensionId);
  await new Promise((r) => setTimeout(r, 1500));
}

/** Chrome's id for an unpacked extension without a `key`: derived from its absolute path. */
export function unpackedExtensionId(dir) {
  return [...createHash("sha256").update(dir).digest("hex").slice(0, 32)]
    .map((c) => String.fromCharCode(97 + Number.parseInt(c, 16)))
    .join("");
}

/** The Agent's extension id is pinned by the manifest `key`. */
export const AGENT_EXTENSION_ID = "bpiondflhhdplemamgggcdajclmoeple";
