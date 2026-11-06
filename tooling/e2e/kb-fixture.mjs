/**
 * Synthetic KB packs for the KB-RAG E2E suites, built by the K1 builder
 * itself so its checksum is the one the extension checks. FIXTURE cards
 * only: no real card text belongs in this repository.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPack } from "../scripts/kb/build-kb-pack.mjs";
import { extensionPage } from "./harness.mjs";

/** A synthetic Confluence card page: four layers of FIXTURE text. */
export function fixturePage(id, title, layers) {
  const body = layers
    .map(
      (text, i) =>
        `<h2>Layer ${i + 1}: ${title}, part ${i + 1}</h2><ol><li><p>${text}</p></li></ol>`,
    )
    .join("");
  return {
    id,
    title: `RAG Card: ${title}`,
    group: "FIXTURE group",
    updatedAt: "2026-02-01T00:00:00.000Z",
    body: `<p>Verified on: FIXTURE code, 2026-01-01.</p>${body}`,
  };
}

export const FIXTURE_PAGES = [
  fixturePage("101", "FIXTURE banner never glows", [
    "In Studio, turn on the FIXTURE Glowing Banner setting.",
    "FIXTURE page checks for the banner slot.",
    "NOT VERIFIED: FIXTURE glow.json lists glowIds.",
    "Send support: the FIXTURE version.",
  ]),
  fixturePage("202", "FIXTURE tooltip opens twice", [
    "In Studio, clear the FIXTURE Double Trigger setting.",
    "FIXTURE anchor element must be unique.",
    "FIXTURE tooltip.json lists triggerCount.",
    "Send support: the FIXTURE version.",
  ]),
];

/** Writes the synthetic pack to `dir` and returns its path and the pack. */
export function writeFixturePack(
  dir,
  { pages = FIXTURE_PAGES, threshold } = {},
) {
  const { pack } = buildPack({
    pages,
    site: "fixture.atlassian.net",
    space: "FX",
    label: "rag-card",
    builtAt: new Date().toISOString(),
    threshold,
  });
  const file = join(dir, "apty-kb-FX-fixture.kbpack.json");
  writeFileSync(file, JSON.stringify(pack));
  return { file, pack };
}

/** Imports `file` through Options → Settings → Knowledge base, as an SE does. */
export async function importPack(browser, file) {
  const options = await extensionPage(
    browser,
    "src/entrypoints/options/index.html?tab=general#knowledge-base",
  );
  const card = options.locator("#knowledge-base");
  await card.getByTestId("knowledge-base-file").setInputFiles(file);
  await card.getByText(/^Imported \d+ cards from space FX\.$/).waitFor();
  await options.close();
}
