#!/usr/bin/env node
/**
 * Builds a TEST-ONLY copy of a 5.x Apty Client (WXT Chrome build) that
 * reports its own calls to the Apty Agent, so SEs can test the Agent's
 * record path. Never for customers.
 *
 * What it changes (see docs/integrations/apty/TEST-RECORDER.md):
 * - background.js: the reference module
 *   (docs/integrations/apty/apty-widget-service-worker.reference.ts),
 *   compiled to an IIFE, and a fetch wrapper go in front of the Client's own
 *   bundle, which is a classic script (`var background=(function(){…`, 5.2.0.1
 *   build). The reference's `fetch` is the original one, captured before the
 *   Client runs, so the recorder never records itself. The wrapper sends the
 *   widget chat call (`/ai-service/api/v1/ai/{t}/widget/chat`, and `/stream`)
 *   and the content files (`/tenant-…/*.json`) through `observedFetch`
 *   (background-script-ipc.service.ts), passes a storage save of a stored
 *   chat (`POST …/widget-storage-service/api/v1/storage` with `{data, key}`,
 *   key ending `/widget-chat/{id}.json`; storage-api.ts) to
 *   `recordWidgetChatTurn`, and leaves every other call alone, so analytics
 *   and the event gateway are never recorded.
 * - manifest.json: `externally_connectable.ids` set to the Agent's IDs, the
 *   name marked " (test recorder)", and each `--match` pattern added to every
 *   content script's `matches`.
 * - TEST-BUILD.txt: not for customers, this repository's commit, the date.
 *
 * It refuses an input that is not a 5.x WXT build: no player-config.json,
 * or no window-script.js among the web-accessible resources.
 *
 * Usage: node tooling/scripts/build-client-test-recorder.mjs <client.zip> <out.zip> [--match <url pattern>]...
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REFERENCE = join(
  ROOT,
  "docs/integrations/apty/apty-widget-service-worker.reference.ts",
);
const AGENT_ID = /^[a-p]{32}$/;
export const TEST_BUILD_SUFFIX = " (test recorder)";

/** The real Agent IDs the reference allows; a placeholder for an ID not yet assigned is left out. */
export function agentIdsFromReference(
  source = readFileSync(REFERENCE, "utf8"),
) {
  const list =
    /DEBUG_AGENT_EXTENSION_IDS[^=]*=\s*\[([\s\S]*?)\]/.exec(source)?.[1] ?? "";
  return [...list.matchAll(/"([^"]*)"/g)]
    .map((m) => m[1])
    .filter((id) => AGENT_ID.test(id));
}

/** Why the unzipped input is not a 5.x WXT Chrome build of the Client, or undefined. */
export function notA5xClient(dir) {
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) return "no manifest.json";
  if (!existsSync(join(dir, "player-config.json"))) {
    return "no player-config.json (a 4.x Client has config.json instead)";
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const accessible = (manifest.web_accessible_resources ?? []).flatMap(
    (entry) => entry.resources ?? [],
  );
  if (!accessible.includes("window-script.js")) {
    return "window-script.js is not a web-accessible resource";
  }
  if (typeof manifest.background?.service_worker !== "string") {
    return "no background service worker";
  }
  if (manifest.background.type === "module") {
    return "the background is a module worker; the recorder goes in front of a classic script";
  }
  return undefined;
}

/** The fetch wrapper that runs before the Client's bundle. */
export function recorderPrelude(referenceIife) {
  return `/* Apty Agent test recorder: NOT FOR CUSTOMERS. Built by tooling/scripts/build-client-test-recorder.mjs. */
var __aptyRecorderFetch = globalThis.fetch.bind(globalThis);
var __aptyDebugRef = (function (fetch) {
${referenceIife}
return __aptyDebugRef;
})(__aptyRecorderFetch);
(function () {
  var CHAT = /\\/ai-service\\/api\\/v1\\/ai\\/[^/]+\\/widget\\/chat(?:\\/stream)?$/;
  var CONTENT = /\\/tenant-[^/]+\\/.*\\.json$/;
  var STORAGE = /\\/widget-storage-service\\/api\\/v1\\/storage$/;
  var STORED_CHAT = /\\/widget-chat\\/([^/]+)\\.json$/;
  function pathOf(input) {
    try {
      var url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new URL(url, globalThis.location && globalThis.location.href).pathname;
    } catch (e) {
      return "";
    }
  }
  function methodOf(input, init) {
    return String((init && init.method) || (input instanceof Request ? input.method : "GET")).toUpperCase();
  }
  function recordStoredChat(input, init) {
    var body = init && typeof init.body === "string"
      ? Promise.resolve(init.body)
      : input instanceof Request && !(init && init.body)
        ? input.clone().text()
        : Promise.resolve(undefined);
    body.then(function (text) {
      if (typeof text !== "string") return;
      var save = JSON.parse(text);
      var key = save && typeof save.key === "string" ? save.key : "";
      var match = STORED_CHAT.exec(key);
      var data = save && save.data;
      if (!match || match[1] === "chat-list" || !data || !Array.isArray(data.messages)) return;
      __aptyDebugRef.recordWidgetChatTurn(String(data.id), String(data.name || ""), data.messages);
    }).catch(function () {});
  }
  globalThis.fetch = function (input, init) {
    var path = pathOf(input);
    if (CHAT.test(path) || CONTENT.test(path)) {
      return __aptyDebugRef.observedFetch(input, init);
    }
    if (STORAGE.test(path) && methodOf(input, init) === "POST") {
      try {
        recordStoredChat(input, init);
      } catch (e) {}
    }
    return __aptyRecorderFetch(input, init);
  };
})();
`;
}

async function compileReference() {
  const { build } = await import("esbuild");
  const out = await build({
    entryPoints: [REFERENCE],
    bundle: true,
    format: "iife",
    globalName: "__aptyDebugRef",
    target: "chrome116",
    write: false,
    logLevel: "silent",
  });
  return out.outputFiles[0].text;
}

function repoCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

export async function buildTestRecorder({
  input,
  output,
  matches = [],
  now = new Date(),
}) {
  const dir = mkdtempSync(join(tmpdir(), "apty-client-recorder-"));
  try {
    execFileSync("unzip", ["-q", resolve(input), "-d", dir]);
    const refusal = notA5xClient(dir);
    if (refusal) {
      throw new Error(`Not a 5.x Apty Client (WXT) build: ${refusal}`);
    }
    const manifestPath = join(dir, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const ids = agentIdsFromReference();
    manifest.name = `${manifest.name}${TEST_BUILD_SUFFIX}`;
    manifest.externally_connectable = { ids };
    for (const script of manifest.content_scripts ?? []) {
      script.matches = [...new Set([...(script.matches ?? []), ...matches])];
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const backgroundPath = join(dir, manifest.background.service_worker);
    const background = readFileSync(backgroundPath, "utf8");
    writeFileSync(
      backgroundPath,
      `${recorderPrelude(await compileReference())}\n${background}`,
    );
    writeFileSync(
      join(dir, "TEST-BUILD.txt"),
      [
        "Apty Client: Apty Agent test recorder build.",
        "NOT FOR CUSTOMERS. For testing the Apty Agent's record path only.",
        `Source: Parthu-work/apty-super-hero at ${repoCommit()}`,
        `Built: ${now.toISOString()}`,
        `Allows the Agent IDs: ${ids.join(", ")}`,
        "",
      ].join("\n"),
    );
    rmSync(resolve(output), { force: true });
    execFileSync("zip", ["-qr", resolve(output), "."], { cwd: dir });
    return { ids, name: manifest.name };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [input, output, ...rest] = process.argv.slice(2);
  const matches = rest.flatMap((arg, i) =>
    rest[i - 1] === "--match" ? [arg] : [],
  );
  if (!input || !output || rest.length !== matches.length * 2) {
    console.error(
      "Usage: node tooling/scripts/build-client-test-recorder.mjs <client.zip> <out.zip> [--match <url pattern>]...",
    );
    process.exit(2);
  }
  try {
    const { ids, name } = await buildTestRecorder({ input, output, matches });
    console.log(`✓ ${output}: "${name}", allows ${ids.join(", ")}`);
    console.log("  TEST ONLY: never give this build to a customer.");
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}
