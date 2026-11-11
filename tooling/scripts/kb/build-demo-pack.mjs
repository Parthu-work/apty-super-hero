#!/usr/bin/env node
/**
 * Builds a demo KB pack from synthetic cards (KB-RAG K20), so anyone can
 * try the KB features without a Confluence token or real card text. It
 * runs the real builder (`build-kb-pack.mjs` `run`) against a fake
 * Confluence serving the DEMO cards in `fixtures/demo-cards.mjs`,
 * calibrates the coverage settings on `fixtures/demo-questions-<4|5>x.json`
 * with `kb:eval`'s own calibration, and writes the pack outside this
 * repository.
 *
 * Usage: pnpm kb:demo-pack [--version 4.x|5.x] [--out <file>]
 * Default output: ~/apty-kb/apty-kb-DEMO-<version>.kbpack.json
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run as buildRun } from "./build-kb-pack.mjs";
import {
  calibrateCoverage,
  floorWarning,
  loadAgentCore,
  readPack,
  readQuestions,
} from "./eval-kb.mjs";
import { DEMO_PAGES_4X, DEMO_PAGES_5X } from "./fixtures/demo-cards.mjs";

const SITE = "demo.atlassian.invalid";
const SPACE = "DEMO";
const ROOT_PAGE = "1000";
const PAGES = { "4.x": DEMO_PAGES_4X, "5.x": DEMO_PAGES_5X };

/**
 * What `kb:eval --calibrate --by-category` gives on each demo question set,
 * recorded after the K21 ranking changes (F2, F5, F6, F7) and checked again
 * after K24 (context words, the names questions): unchanged. The build
 * calibrates the same way and warns when it lands elsewhere, so a ranking
 * change shows up here in review.
 */
export const DEMO_COVERAGE = {
  "4.x": { min: 0.35, minIdf: 2.024 },
  "5.x": { min: 0.35, minIdf: 2.234 },
};
const json = (body) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => body,
});

/** A fake Confluence serving the demo cards: CQL search, then each page. */
export function demoConfluence(pages) {
  return async (url) => {
    const { pathname } = new URL(url);
    if (pathname === "/wiki/rest/api/search") {
      return json({
        results: pages.map((p) => ({ content: { id: p.id, title: p.title } })),
        _links: {},
      });
    }
    if (pathname === `/wiki/api/v2/pages/${ROOT_PAGE}1`) {
      return json({ id: `${ROOT_PAGE}1`, title: "RAG Cards: DEMO group" });
    }
    const id = pathname.split("/").pop();
    const page = pages.find((p) => p.id === id);
    if (!page) return { ok: false, status: 404, headers: { get: () => null } };
    return json({
      id: page.id,
      title: page.title,
      parentId: `${ROOT_PAGE}1`,
      body: { storage: { value: page.body } },
      version: { createdAt: page.updatedAt },
    });
  };
}

export const demoQuestionsFile = (version) =>
  fileURLToPath(
    new URL(`./fixtures/demo-questions-${version[0]}x.json`, import.meta.url),
  );

function parseArgs(argv) {
  const options = { version: "5.x" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if ((flag === "--version" || flag === "--out") && value !== undefined) {
      options[flag.slice(2)] = value;
      i++;
    } else {
      throw new Error(`Unknown or incomplete option: ${flag}`);
    }
  }
  if (!PAGES[options.version]) throw new Error("--version takes 4.x or 5.x.");
  return options;
}

/** The CLI, with its inputs injected for tests. Returns the exit code. */
export async function run({
  argv,
  home = homedir(),
  cwd = process.cwd(),
  now = () => new Date(),
  out = (line) => console.log(line),
  err = (line) => console.error(line),
}) {
  let scratch;
  try {
    const options = parseArgs(argv);
    const pages = PAGES[options.version];
    const target = resolve(
      cwd,
      options.out ??
        join(home, "apty-kb", `apty-kb-DEMO-${options.version}.kbpack.json`),
    );
    const build = (extra, file, print = () => {}) =>
      buildRun({
        argv: [
          "--site",
          SITE,
          "--space",
          SPACE,
          "--root",
          ROOT_PAGE,
          "--version",
          options.version,
          "--out",
          file,
          ...extra,
        ],
        env: {
          CONFLUENCE_EMAIL: "demo@example.invalid",
          CONFLUENCE_TOKEN: "demo-token-never-sent",
        },
        fetchImpl: demoConfluence(pages),
        now,
        home,
        cwd,
        out: print,
        err,
      });

    scratch = mkdtempSync(join(tmpdir(), "apty-kb-demo-"));
    const first = join(scratch, "uncalibrated.kbpack.json");
    if ((await build([], first)) !== 0) return 1;
    const core = await loadAgentCore();
    const questions = readQuestions(
      readFileSync(demoQuestionsFile(options.version), "utf8"),
    );
    const coverage = calibrateCoverage(
      core,
      await readPack(core, readFileSync(first, "utf8")),
      questions,
    );
    const warning = floorWarning(coverage);
    if (warning) err(warning);
    const recorded = DEMO_COVERAGE[options.version];
    if (recorded.min !== coverage.min || recorded.minIdf !== coverage.minIdf) {
      err(
        `Calibration moved from the recorded min ${recorded.min}, minIdf ${recorded.minIdf}: update DEMO_COVERAGE in build-demo-pack.mjs with the before and after numbers.`,
      );
    }
    const code = await build(
      [
        "--coverage-min",
        String(coverage.min),
        "--coverage-min-idf",
        String(coverage.minIdf),
      ],
      target,
      out,
    );
    if (code === 0) {
      out(
        `Demo pack for Apty ${options.version}: synthetic DEMO cards only, coverage min ${coverage.min} and minIdf ${coverage.minIdf} calibrated on ${questions.length} demo questions. Import it in Options → Settings → General → Knowledge base.`,
      );
    }
    return code;
  } catch (error) {
    err(error.message);
    return 1;
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await run({ argv: process.argv.slice(2) });
}
