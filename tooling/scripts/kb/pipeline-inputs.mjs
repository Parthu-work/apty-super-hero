#!/usr/bin/env node
/**
 * The KB workflows' inputs check (KB-RAG K29, P1). A scheduled run waits
 * for the repository variable KB_PACKS_ENABLED, so the nightly jobs stay
 * quiet until IT and the KB owner have set the pipeline up; a manual run
 * always checks. A missing secret or variable fails the run with its name,
 * never its value.
 *
 * Usage (from a workflow step, with the inputs in the environment):
 *   node tooling/scripts/kb/pipeline-inputs.mjs gate
 *   node tooling/scripts/kb/pipeline-inputs.mjs pack --version 4.x|5.x
 *   node tooling/scripts/kb/pipeline-inputs.mjs health
 * Outputs go to $GITHUB_OUTPUT. Exits 1 when an input is missing, 2 on a
 * usage error.
 */
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const NOT_SET_UP_NOTICE =
  "KB packs are not set up yet; set KB_PACKS_ENABLED to 1 after the steps in KB_PACK_DELIVERY.md";

const DOC = "docs/release/KB_PACK_DELIVERY.md";
const PUBLISH_URL_NAME = {
  "4.x": "KB_PUBLISH_URL_4X",
  "5.x": "KB_PUBLISH_URL_5X",
};
const CONFLUENCE_INPUTS = [
  "CONFLUENCE_EMAIL",
  "CONFLUENCE_TOKEN",
  "KB_CI_SIGNING_KEY",
];

const isSet = (env, name) => Boolean(env[name]?.trim());
const enabled = (value) => value === "1" || value === "true";

export function shouldRun({ event, env }) {
  if (event === "schedule" && !enabled(env.KB_PACKS_ENABLED)) {
    return { run: false, notice: NOT_SET_UP_NOTICE };
  }
  return { run: true };
}

export function checkPackInputs({ version, env }) {
  const urlName = PUBLISH_URL_NAME[version];
  const hasConfluence = CONFLUENCE_INPUTS.every((name) => isSet(env, name));
  const dryRun = env.KB_PUBLISH_DRY_RUN === "1";
  const missing = dryRun
    ? []
    : [...CONFLUENCE_INPUTS, "KB_PUBLISH_TOKEN", urlName].filter(
        (name) => !isSet(env, name),
      );
  return {
    missing,
    outputs: {
      source: dryRun && !hasConfluence ? "demo" : "confluence",
      publish_url_name: urlName,
      has_host: String(isSet(env, urlName) && isSet(env, "KB_PUBLISH_TOKEN")),
    },
  };
}

export function checkHealthInputs({ env }) {
  return {
    missing: ["KB_PUBLISH_TOKEN", ...Object.values(PUBLISH_URL_NAME)].filter(
      (name) => !isSet(env, name),
    ),
    outputs: {},
  };
}

function githubOutput(env) {
  return (name, value) => {
    if (env.GITHUB_OUTPUT)
      appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
  };
}

export function run({
  argv = process.argv.slice(2),
  env = process.env,
  out = console.log,
  setOutput = githubOutput(env),
} = {}) {
  const [command, flag, version] = argv;
  if (command === "gate") {
    const decision = shouldRun({ event: env.GITHUB_EVENT_NAME, env });
    if (decision.notice) out(`::notice title=KB packs::${decision.notice}`);
    setOutput("run", String(decision.run));
    return 0;
  }
  let result;
  if (command === "pack") {
    if (flag !== "--version" || !PUBLISH_URL_NAME[version]) {
      out("::error::--version takes 4.x or 5.x.");
      return 2;
    }
    result = checkPackInputs({ version, env });
  } else if (command === "health") {
    result = checkHealthInputs({ env });
  } else {
    out(
      "::error::Usage: pipeline-inputs.mjs gate | pack --version <4.x|5.x> | health",
    );
    return 2;
  }
  if (result.missing.length > 0) {
    out(
      `::error::Missing: ${result.missing.join(" ")}. Set them as described in ${DOC}.`,
    );
    return 1;
  }
  for (const [name, value] of Object.entries(result.outputs))
    setOutput(name, value);
  return 0;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.exitCode = run();
}
