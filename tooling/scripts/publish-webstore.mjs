#!/usr/bin/env node
/**
 * Uploads the release's `-webstore` zip to the Chrome Web Store and
 * publishes it (KB-RAG K28, A5), with the Chrome Web Store API v2: an OAuth
 * access token from the refresh token, `:upload`, then `:publish` with the
 * default publish type, which publishes to the visibility the listing has
 * in the developer dashboard (set it to Private for the Apty domain once).
 *
 * It runs only when CWS_PUBLISH is 1 and CWS_CLIENT_ID, CWS_CLIENT_SECRET,
 * CWS_REFRESH_TOKEN, CWS_PUBLISHER_ID and CWS_ITEM_ID are set; otherwise it
 * prints a skip line naming what is missing and exits 0. It prints the item
 * id, version and states for the job summary, never a secret or token.
 *
 * Usage: node tooling/scripts/publish-webstore.mjs --zip <apty-agent-vX.Y.Z-webstore.zip>
 * Exits 1 when the store refuses, 2 on a usage error.
 */
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_ENV = [
  "CWS_CLIENT_ID",
  "CWS_CLIENT_SECRET",
  "CWS_REFRESH_TOKEN",
  "CWS_PUBLISHER_ID",
  "CWS_ITEM_ID",
];
const STORE_URLS = {
  oauth: "https://oauth2.googleapis.com/token",
  api: "https://chromewebstore.googleapis.com",
  upload: "https://chromewebstore.googleapis.com/upload",
};
const TIMEOUT_MS = 120_000;
const MAX_POLLS = 30;

/** The HTTP status and the API's error code, never its message (it may echo a request). */
async function failure(step, response) {
  let code = "";
  try {
    const body = await response.json();
    const status = body?.error?.status ?? body?.error;
    if (typeof status === "string" && /^[A-Za-z_]+$/.test(status)) {
      code = ` (${status})`;
    }
  } catch {}
  return new Error(`${step} failed: HTTP ${response.status}${code}.`);
}

async function accessToken(env, { urls, fetchImpl }) {
  const response = await fetchImpl(urls.oauth, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.CWS_CLIENT_ID,
      client_secret: env.CWS_CLIENT_SECRET,
      refresh_token: env.CWS_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }).toString(),
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw await failure("Getting an access token", response);
  const { access_token: token } = await response.json();
  if (typeof token !== "string" || !token) {
    throw new Error("Getting an access token failed: no token returned.");
  }
  return token;
}

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--zip") {
    throw new Error("Usage: publish-webstore.mjs --zip <file>");
  }
  if (!basename(argv[1]).endsWith("-webstore.zip")) {
    throw new Error(
      "Give the -webstore.zip package: the store rejects the pinned-ID zip's manifest key.",
    );
  }
  return { zip: argv[1] };
}

export async function run({
  argv,
  env = process.env,
  cwd = process.cwd(),
  urls = STORE_URLS,
  fetchImpl = globalThis.fetch,
  pollMs = 5_000,
  out = (line) => console.log(line),
  err = (line) => console.error(line),
}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    err(error.message);
    return 2;
  }
  out("### Chrome Web Store");
  out("");
  if (env.CWS_PUBLISH !== "1") {
    out(
      "- Chrome Web Store: skipped (the repository variable CWS_PUBLISH is not 1).",
    );
    return 0;
  }
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length > 0) {
    out(`- Chrome Web Store: skipped (not set: ${missing.join(", ")}).`);
    return 0;
  }
  const item = `/v2/publishers/${encodeURIComponent(env.CWS_PUBLISHER_ID)}/items/${encodeURIComponent(env.CWS_ITEM_ID)}`;
  try {
    const token = await accessToken(env, { urls, fetchImpl });
    const call = (url, init = {}) =>
      fetchImpl(url, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...init.headers },
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    const upload = await call(`${urls.upload}${item}:upload`, {
      method: "POST",
      headers: { "Content-Type": "application/zip" },
      body: readFileSync(resolve(cwd, options.zip)),
    });
    if (!upload.ok) throw await failure("The upload", upload);
    const uploaded = await upload.json();
    let state = uploaded.uploadState;
    for (let poll = 0; state === "IN_PROGRESS" && poll < MAX_POLLS; poll++) {
      await new Promise((done) => setTimeout(done, pollMs));
      const status = await call(`${urls.api}${item}:fetchStatus`);
      if (!status.ok) throw await failure("Reading the upload state", status);
      state = (await status.json()).lastAsyncUploadState;
    }
    if (state !== "SUCCEEDED") {
      throw new Error(`The upload did not succeed: upload state ${state}.`);
    }
    out(
      `- Uploaded version ${uploaded.crxVersion ?? "?"} to item ${env.CWS_ITEM_ID}.`,
    );
    const publish = await call(`${urls.api}${item}:publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publishType: "DEFAULT_PUBLISH" }),
    });
    if (!publish.ok) throw await failure("Publishing", publish);
    out(`- Published: ${(await publish.json()).state ?? "submitted"}.`);
    return 0;
  } catch (error) {
    out(`- **Chrome Web Store: not published.** ${error.message}`);
    return 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await run({ argv: process.argv.slice(2) });
}
