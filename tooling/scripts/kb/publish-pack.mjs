#!/usr/bin/env node
/**
 * Moves KB packs to and from the internal pack host (KB-RAG K26, D5,
 * D-DEL4) with the publish token, a bearer token from the environment
 * (`KB_PUBLISH_TOKEN`) that is never printed.
 *
 *   download --url <url> --out <file> --kind pack|names: the last published
 *     pack (for --diff and the card-count gate) or the customer-name list.
 *     The body is written only if it is that kind of file (checkedDownload).
 *     A 404 (the first run) writes nothing and succeeds.
 *   upload --url <url> --pack <file>: PUT the pack, then GET it back and
 *     compare its sha256 with the file's. With KB_PUBLISH_DRY_RUN=1 nothing
 *     is sent.
 *
 * It prints HTTP statuses and sha256 values only: never the URL (not even
 * its host, since the job's log may be public), the token or the pack.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const TIMEOUT_MS = 120_000;
/** The pack limit (KB_PACK_LIMITS.maxBytes) and a generous cap for a name list. */
const MAX_BYTES = { pack: 25 * 1024 * 1024, names: 1024 * 1024 };

/**
 * The downloaded body as text, only if it is what the caller asked for: a
 * pack is a JSON object of kind "apty-kb-pack", a name list is UTF-8 text;
 * both within their size cap. Anything else is not written.
 */
export function checkedDownload(bytes, kind) {
  if (bytes.length > MAX_BYTES[kind]) return { error: "too_large" };
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { error: "not_utf8" };
  }
  if (kind === "names") return { text };
  try {
    const parsed = JSON.parse(text);
    if (parsed?.kind !== "apty-kb-pack" || Array.isArray(parsed)) {
      return { error: "not_a_pack" };
    }
  } catch {
    return { error: "not_json" };
  }
  return { text };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command };
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    if (
      !["--url", "--out", "--pack", "--kind"].includes(flag) ||
      rest[i + 1] === undefined
    ) {
      throw new Error(`Unknown or incomplete option: ${flag}`);
    }
    options[flag.slice(2)] = rest[i + 1];
  }
  if (command !== "download" && command !== "upload") {
    throw new Error("Use download or upload.");
  }
  if (!options.url) throw new Error("--url is required.");
  const url = new URL(options.url);
  if (url.protocol !== "https:") throw new Error("--url must be https.");
  if (command === "download" && !options.out)
    throw new Error("--out is required.");
  if (command === "upload" && !options.pack)
    throw new Error("--pack is required.");
  return { ...options, url };
}

export async function run({
  argv,
  env = process.env,
  fetchImpl = globalThis.fetch,
  cwd = process.cwd(),
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
  const host = "the pack host";
  const dryRun = env.KB_PUBLISH_DRY_RUN === "1";
  const token = env.KB_PUBLISH_TOKEN;
  if (!token && !(dryRun && options.command === "upload")) {
    err("KB_PUBLISH_TOKEN is not set.");
    return 1;
  }
  const call = (method, body) =>
    fetchImpl(options.url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        "Cache-Control": "no-cache",
      },
      ...(body ? { body } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  try {
    if (options.command === "download") {
      const response = await call("GET");
      if (response.status === 404) {
        out(`No published pack on ${host} yet (404).`);
        return 0;
      }
      if (!response.ok) {
        err(`Download from ${host} failed: HTTP ${response.status}.`);
        return 1;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      const checked = checkedDownload(bytes, options.kind);
      if ("error" in checked) {
        err(`The file from ${host} was not written: ${checked.error}.`);
        return 1;
      }
      writeFileSync(resolve(cwd, options.out), checked.text, { mode: 0o600 });
      out(
        `Downloaded the ${options.kind === "pack" ? "published pack" : "name list"} from ${host} (sha256 ${sha256(bytes).slice(0, 12)}).`,
      );
      return 0;
    }
    const bytes = readFileSync(resolve(cwd, options.pack));
    const expected = sha256(bytes);
    if (dryRun) {
      out(
        `Dry run: not uploaded to ${host} (file sha256 ${expected.slice(0, 12)}).`,
      );
      return 0;
    }
    const put = await call("PUT", bytes);
    if (!put.ok) {
      err(`Upload to ${host} failed: HTTP ${put.status}.`);
      return 1;
    }
    const back = await call("GET");
    if (!back.ok) {
      err(`Reading the pack back from ${host} failed: HTTP ${back.status}.`);
      return 1;
    }
    const got = sha256(Buffer.from(await back.arrayBuffer()));
    if (got !== expected) {
      err(
        `The pack read back from ${host} differs (sha256 ${got.slice(0, 12)}, uploaded ${expected.slice(0, 12)}).`,
      );
      return 1;
    }
    out(
      `Published to ${host}: HTTP ${put.status}, read back with the same file sha256 ${expected}.`,
    );
    return 0;
  } catch (error) {
    err(`${options.command} at ${host} failed (${error?.name ?? "Error"}).`);
    return 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await run({ argv: process.argv.slice(2) });
}
