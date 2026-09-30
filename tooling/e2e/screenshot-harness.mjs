#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
/**
 * WP16 item 5: a real-browser screenshot harness for the built extension
 * pages. Loads the built side panel and options HTML over a local static
 * server (not file://, so ES module imports resolve like they do when
 * loaded from a real `chrome-extension://` origin), with a minimal
 * `window.chrome` stub standing in for the extension APIs these pages
 * call during initial render, and captures PNGs at the viewports WP16/
 * WP18/WP21 care about, in both themes.
 *
 * This does not load the page as a real installed MV3 extension (no
 * `chrome-extension://` origin, no service worker, no side-panel chrome
 * around it) — it renders the same HTML/JS/CSS a real load would, which is
 * enough to judge layout, spacing, and the tab-highlight/CSS regressions
 * WP16-WP21 are about. Real extension-boundary behaviour (side panel host
 * chrome, `chrome.sidePanel`, cross-extension messaging) still needs the
 * real-Chrome e2e harness described as WP8 in the master prompt, which is
 * not implemented here.
 */
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DIST_DIR = join(ROOT, "apps/browser-extension/dist");
const OUT_DIR = join(ROOT, "tooling/e2e/screenshots");
const CHROMIUM_PATH =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

const CHROME_STUB = `
(function () {
  // A generic fallback for anything not explicitly stubbed below: any
  // \`on*\` property becomes a no-op event ({ addListener, removeListener,
  // hasListener }), any other property access returns a further fallback,
  // and calling it as a function resolves a callback (if the last arg is
  // one) and returns a resolved promise — covering the get(keys, cb) /
  // await get(keys) dual calling convention most chrome.* APIs use.
  function fallback() {
    const fn = function (...args) {
      const cb = args[args.length - 1];
      if (typeof cb === "function") {
        try { cb({}); } catch (e) {}
      }
      return Promise.resolve({});
    };
    return new Proxy(fn, {
      get(target, prop) {
        if (prop === "then" || typeof prop === "symbol") return undefined;
        if (typeof prop === "string" && prop.startsWith("on")) {
          return { addListener: () => {}, removeListener: () => {}, hasListener: () => false };
        }
        if (!(prop in target)) target[prop] = fallback();
        return target[prop];
      },
    });
  }

  const base = {
    runtime: {
      id: "screenshot-harness-fake-id",
      getManifest: () => ({ version: "0.0.0-screenshot-harness" }),
      getURL: (p) => p,
      openOptionsPage: () => {},
      sendMessage: () => Promise.resolve(),
      connect: () => ({
        onMessage: { addListener: () => {}, removeListener: () => {} },
        onDisconnect: { addListener: () => {}, removeListener: () => {} },
        postMessage: () => {},
        disconnect: () => {},
      }),
    },
    storage: {
      local: {
        get: (_keys, cb) => { const r = {}; if (cb) cb(r); return Promise.resolve(r); },
        set: (_items, cb) => { if (cb) cb(); return Promise.resolve(); },
        remove: (_keys, cb) => { if (cb) cb(); return Promise.resolve(); },
        clear: (cb) => { if (cb) cb(); return Promise.resolve(); },
      },
      session: {
        get: (_keys, cb) => { const r = {}; if (cb) cb(r); return Promise.resolve(r); },
        set: (_items, cb) => { if (cb) cb(); return Promise.resolve(); },
        remove: (_keys, cb) => { if (cb) cb(); return Promise.resolve(); },
        setAccessLevel: () => Promise.resolve(),
      },
    },
    management: { getAll: (cb) => { if (cb) cb([]); return Promise.resolve([]); } },
    bookmarks: {
      getTree: (cb) => { if (cb) cb([]); return Promise.resolve([]); },
      getRecent: (_n, cb) => { if (cb) cb([]); return Promise.resolve([]); },
      search: (_q, cb) => { if (cb) cb([]); return Promise.resolve([]); },
    },
    history: {
      search: (_q, cb) => { if (cb) cb([]); return Promise.resolve([]); },
    },
    tabs: {
      query: (_q, cb) => { const r = []; if (cb) cb(r); return Promise.resolve(r); },
      get: () => Promise.resolve({}),
    },
    action: { setBadgeText: () => Promise.resolve() },
    i18n: { getMessage: () => "" },
  };

  function wrap(namespace) {
    return new Proxy(namespace, {
      get(target, prop) {
        if (prop === "then" || typeof prop === "symbol") return undefined;
        if (typeof prop === "string" && prop.startsWith("on") && !(prop in target)) {
          return { addListener: () => {}, removeListener: () => {}, hasListener: () => false };
        }
        if (!(prop in target)) return fallback();
        const value = target[prop];
        return value && typeof value === "object" && !Array.isArray(value) ? wrap(value) : value;
      },
    });
  }

  window.chrome = wrap(base);
})();
`;

function startStaticServer(rootDir) {
  return new Promise((resolvePromise) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const filePath = join(rootDir, decodeURIComponent(url.pathname));
        if (!existsSync(filePath)) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        const body = await readFile(filePath);
        res.writeHead(200, {
          "content-type":
            MIME_TYPES[extname(filePath)] ?? "application/octet-stream",
        });
        res.end(body);
      } catch (error) {
        res.writeHead(500);
        res.end(String(error));
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolvePromise({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

const TARGETS = [
  {
    name: "sidepanel",
    path: "/src/entrypoints/sidepanel/index.html",
    viewports: [320, 360, 420].map((width) => ({ width, height: 700 })),
  },
  {
    name: "options",
    path: "/src/entrypoints/options/index.html",
    viewports: [360, 768, 1280, 1600].map((width) => ({ width, height: 900 })),
  },
];

const THEMES = ["light", "dark"];

async function main() {
  if (!existsSync(DIST_DIR)) {
    console.error(
      `✗ ${DIST_DIR} does not exist — run \`pnpm --filter @apty/browser-extension build\` first`,
    );
    process.exit(1);
  }
  if (!existsSync(CHROMIUM_PATH)) {
    console.error(
      `✗ Chromium not found at ${CHROMIUM_PATH}. Set PLAYWRIGHT_CHROMIUM_PATH to a Chromium binary.`,
    );
    process.exit(1);
  }

  const { server, baseUrl } = await startStaticServer(DIST_DIR);
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });

  const report = [];

  try {
    for (const target of TARGETS) {
      for (const theme of THEMES) {
        for (const viewport of target.viewports) {
          const context = await browser.newContext({
            viewport,
            colorScheme: theme,
          });
          await context.addInitScript(CHROME_STUB);
          const page = await context.newPage();
          const consoleIssues = [];
          page.on("console", (msg) => {
            if (msg.type() === "error" || msg.type() === "warning") {
              consoleIssues.push(`[${msg.type()}] ${msg.text()}`);
            }
          });
          page.on("pageerror", (err) => {
            consoleIssues.push(`[pageerror] ${err.message}`);
          });
          page.on("requestfailed", (req) => {
            consoleIssues.push(
              `[requestfailed] ${req.url()} ${req.failure()?.errorText ?? ""}`,
            );
          });
          page.on("response", (res) => {
            if (res.status() >= 400) {
              consoleIssues.push(`[http ${res.status()}] ${res.url()}`);
            }
          });

          const url = `${baseUrl}${target.path}`;
          let ok = true;
          try {
            await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
            await page.waitForSelector("#root", { timeout: 10000 });
            // Let async effects (settings load, agent creation) settle.
            await page.waitForTimeout(500);
          } catch (error) {
            ok = false;
            consoleIssues.push(`[navigation] ${error.message}`);
          }

          const fileName = `${target.name}-${theme}-${viewport.width}.png`;
          const outPath = join(OUT_DIR, fileName);
          await page.screenshot({ path: outPath }).catch((error) => {
            ok = false;
            consoleIssues.push(`[screenshot] ${error.message}`);
          });

          // Horizontal-scroll check (WP16/WP18/WP21 require none from
          // 320px up).
          let hasHorizontalScroll = null;
          try {
            hasHorizontalScroll = await page.evaluate(
              () =>
                document.documentElement.scrollWidth >
                document.documentElement.clientWidth + 1,
            );
          } catch {
            // navigation failed above; leave as null
          }

          report.push({
            target: target.name,
            theme,
            width: viewport.width,
            file: fileName,
            ok,
            hasHorizontalScroll,
            consoleIssues,
          });

          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  const reportPath = join(OUT_DIR, "report.json");
  await import("node:fs/promises").then((fs) =>
    fs.writeFile(reportPath, JSON.stringify(report, null, 2)),
  );

  console.log(`\nCaptured ${report.length} screenshots to ${OUT_DIR}`);
  const failures = report.filter(
    (r) => !r.ok || r.hasHorizontalScroll || r.consoleIssues.length > 0,
  );
  if (failures.length > 0) {
    console.log(`\n${failures.length} screen(s) have issues:`);
    for (const f of failures) {
      console.log(`  - ${f.target} ${f.theme} ${f.width}px (${f.file})`);
      if (f.hasHorizontalScroll) console.log("      horizontal scroll present");
      for (const issue of f.consoleIssues) console.log(`      ${issue}`);
    }
  } else {
    console.log(
      "All captured screens: no console errors/warnings, no horizontal scroll.",
    );
  }
  console.log(`\nFull report: ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
