#!/usr/bin/env node
/**
 * Turns an Ask Dapty evidence bundle (the card's "Export evidence") and the
 * HAR the SE recorded alongside it into a live-data fixture for
 * `dapty-live-fixtures.test.ts`:
 *
 *   <out>/<name>/expected.json     what the card showed: rule ids, gate
 *                                  statuses and suggestion rows
 *   <out>/<name>/evidence.json     the bundle's build facts and evidence
 *                                  summary, for reference
 *   <out>/<name>/capture.har.json  the HAR the check runs on (with --har)
 *
 * The bundle holds no conversation text or id; the HAR does, so it is
 * refused while it still holds an email address, a cookie or an
 * authorization header. Redact it first (see the fixtures README).
 *
 * Usage: node tooling/scripts/dapty-bundle-to-fixture.mjs <bundle.json> <name> [--har <capture.har>] [--out <dir>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SUPPORTED_BUNDLE = "apty-dapty-evidence/1";
const DEFAULT_OUT =
  "packages/browser-runtime/src/apty/diagnosis/fixtures/dapty-live";
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const SECRET_HEADERS = new Set(["cookie", "set-cookie", "authorization"]);

/** What the fixture suite compares: the card's rule ids, gates and suggestion rows. */
export function expectedFrom(bundle) {
  if (bundle?.bundleVersion !== SUPPORTED_BUNDLE) {
    throw new Error(
      `Not an Ask Dapty evidence bundle (${SUPPORTED_BUNDLE}): ${bundle?.bundleVersion ?? "no bundleVersion"}`,
    );
  }
  const { result } = bundle;
  return {
    verdict: result.verdict.status,
    ruleIds: result.verdict.causes.map((cause) => cause.ruleId),
    gates: result.gates.map(({ id, status, reason }) => ({
      id,
      status,
      reason,
    })),
    suggestions: (result.dapty?.suggestions ?? []).map(
      ({ name, type, status }) => ({
        name,
        ...(type ? { type } : {}),
        status,
      }),
    ),
  };
}

/** Why a HAR cannot go into the repository as it is, or an empty list. */
export function harProblems(har) {
  const problems = [];
  const entries = har?.log?.entries;
  if (!Array.isArray(entries)) return ["not a HAR: no log.entries"];
  for (const [index, entry] of entries.entries()) {
    for (const side of ["request", "response"]) {
      for (const header of entry?.[side]?.headers ?? []) {
        if (SECRET_HEADERS.has(String(header.name).toLowerCase())) {
          problems.push(`entry ${index}: ${side} header ${header.name}`);
        }
      }
    }
  }
  if (EMAIL.test(JSON.stringify(har))) problems.push("an email address");
  return problems;
}

function parseArgs(argv) {
  const [bundlePath, name, ...rest] = argv;
  const option = (flag) => {
    const at = rest.indexOf(flag);
    return at >= 0 ? rest[at + 1] : undefined;
  };
  return { bundlePath, name, har: option("--har"), out: option("--out") };
}

export function writeFixture({ bundle, name, har, outDir }) {
  if (!NAME_PATTERN.test(name ?? "")) {
    throw new Error(
      `Name the fixture in kebab-case (tenant-free), e.g. "aptyid-chat-panel": ${name}`,
    );
  }
  const expected = expectedFrom(bundle);
  if (har) {
    const problems = harProblems(har);
    if (problems.length > 0) {
      throw new Error(
        `The HAR is not redacted: ${problems.join("; ")}. Follow the checklist in the fixtures README.`,
      );
    }
  }
  const dir = join(outDir, name);
  if (existsSync(dir)) throw new Error(`${dir} already exists`);
  mkdirSync(dir, { recursive: true });
  const write = (file, value) =>
    writeFileSync(join(dir, file), `${JSON.stringify(value, null, 2)}\n`);
  write("expected.json", expected);
  write("evidence.json", {
    versions: bundle.versions,
    generatedAt: bundle.generatedAt,
    evidence: bundle.evidence,
  });
  if (har) write("capture.har.json", har);
  return dir;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { bundlePath, name, har, out } = parseArgs(process.argv.slice(2));
  if (!bundlePath || !name) {
    console.error(
      "Usage: node tooling/scripts/dapty-bundle-to-fixture.mjs <bundle.json> <name> [--har <capture.har>] [--out <dir>]",
    );
    process.exit(2);
  }
  try {
    const dir = writeFixture({
      bundle: JSON.parse(readFileSync(resolve(bundlePath), "utf8")),
      name,
      har: har ? JSON.parse(readFileSync(resolve(har), "utf8")) : undefined,
      outDir: resolve(out ?? DEFAULT_OUT),
    });
    console.log(`✓ Wrote ${dir}`);
    if (!har) {
      console.log(
        "  No --har: the fixture suite needs capture.har.json to run the check; add it when the SE sends it.",
      );
    }
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}
