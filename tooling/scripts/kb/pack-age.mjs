#!/usr/bin/env node
/**
 * The age of each published KB pack (KB-RAG K28, A3): reads the pack from
 * the pack host with the publish token (`KB_PUBLISH_TOKEN`) into memory,
 * parses it with the extension's own parser, and fails when its `builtAt`
 * is more than 48 hours old or it cannot be read. The nightly build should
 * have replaced it long before.
 *
 * It prints the job summary on stdout: versions, build times, ages and
 * reasons only, never the URL, the token or card text.
 *
 * Usage: node tooling/scripts/kb/pack-age.mjs --version 5.x --url <https url>
 *   [--version 4.x --url <https url> ...] [--max-hours 48]
 * Exits 1 when a pack is too old or unreadable, 2 on a usage error.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgentCore, readPack } from "./eval-kb.mjs";
import { fetchText } from "./publish-gate.mjs";

export const MAX_PACK_AGE_HOURS = 48;
const VERSIONS = ["4.x", "5.x", "common"];

function parseArgs(argv) {
  const checks = [];
  let maxHours = MAX_PACK_AGE_HOURS;
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined) throw new Error(`${flag} needs a value.`);
    if (flag === "--version") {
      if (!VERSIONS.includes(value)) {
        throw new Error("--version takes 4.x, 5.x or common.");
      }
      checks.push({ version: value });
    } else if (flag === "--url") {
      const last = checks.at(-1);
      if (!last || last.url) throw new Error("Give --version before --url.");
      last.url = value;
    } else if (flag === "--max-hours") {
      maxHours = Number(value);
      if (!Number.isFinite(maxHours) || maxHours <= 0) {
        throw new Error("--max-hours takes a number of hours.");
      }
    } else throw new Error(`Unknown option: ${flag}`);
  }
  if (checks.length === 0 || checks.some((check) => !check.url)) {
    throw new Error("Give --version <v> --url <https url> for each pack.");
  }
  return { checks, maxHours };
}

/** One pack's summary line and whether it passes. */
async function checkPack(
  core,
  { version, url },
  { maxHours, now, token, fetchImpl },
) {
  const label = `- KB pack ${version}`;
  let pack;
  try {
    const text = await fetchText(url, "pack", { token, fetchImpl });
    if (text === undefined) {
      throw new Error("not on the pack host (HTTP 404)");
    }
    pack = await readPack(core, text);
  } catch (error) {
    return { ok: false, line: `${label}: could not be read: ${error.message}` };
  }
  if (pack.aptyVersion !== version) {
    return {
      ok: false,
      line: `${label}: the published file is a ${pack.aptyVersion} pack.`,
    };
  }
  const built = new Date(pack.builtAt);
  const hours = (now.getTime() - built.getTime()) / 3_600_000;
  const age = `built ${built.toISOString()}, ${hours.toFixed(1)} hours ago`;
  return hours > maxHours
    ? { ok: false, line: `${label}: ${age}: older than ${maxHours} hours.` }
    : { ok: true, line: `${label}: ${age}.` };
}

export async function run({
  argv,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
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
  out("### KB pack age");
  out("");
  if (!env.KB_PUBLISH_TOKEN) {
    out("- **Failed.** KB_PUBLISH_TOKEN is not set.");
    return 1;
  }
  const core = await loadAgentCore();
  let ok = true;
  for (const check of options.checks) {
    const result = await checkPack(core, check, {
      maxHours: options.maxHours,
      now: now(),
      token: env.KB_PUBLISH_TOKEN,
      fetchImpl,
    });
    ok &&= result.ok;
    out(result.line);
  }
  out(ok ? "- Every pack is current." : "- **Failed.** See the lines above.");
  out("");
  return ok ? 0 : 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await run({ argv: process.argv.slice(2) });
}
