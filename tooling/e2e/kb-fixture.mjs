/**
 * Synthetic KB packs for the KB-RAG E2E suites, built by the K1 builder
 * itself so its checksum is the one the extension checks. FIXTURE cards
 * only: no real card text belongs in this repository.
 */
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_SIGNING_KEY } from "../scripts/kb/build-demo-pack.mjs";
import {
  buildPack,
  keyIdOf,
  packSha256,
  signPack,
} from "../scripts/kb/build-kb-pack.mjs";
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

/**
 * The coverage settings a KB owner would calibrate for a pack this small:
 * the defaults assume hundreds of chunks, where a card's own words reach an
 * idf of 1.5; in a few cards none does.
 */
export const FIXTURE_COVERAGE = { min: 0.4, minIdf: 0.5, minTerms: 1 };

/**
 * A fixture pack's Confluence site. Under `.invalid` it is a demo pack, whose
 * card text may reach the model with no policy (KB-RAG K22, D-SEC1); the
 * suites that check KB text is withheld build theirs on NON_DEMO_SITE.
 */
export const DEMO_SITE = "fixture.atlassian.invalid";
export const NON_DEMO_SITE = "synthetic.atlassian.example";

/**
 * The key non-demo fixture packs are signed with (KB-RAG K23 P2): made at
 * run time, never written to the repository; a suite that imports such a
 * pack trusts it through the E2E policy build (`TEST_KEY_POLICY`).
 */
const testKey = (() => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  return {
    pem: privateKey.export({ type: "pkcs8", format: "pem" }),
    entry: {
      keyId: keyIdOf(publicKey),
      spki: publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64"),
      name: "E2E test key",
    },
  };
})();

/** The trusted key entry of the run-time test key. */
export const TEST_KEY = testKey.entry;
/** The policy that trusts the test key, for a suite on the E2E policy build. */
export const TEST_KEY_POLICY = { trustedPackKeys: [TEST_KEY] };

/**
 * Writes the synthetic pack to `dir` and returns its path and the pack,
 * signed with the demo key for a `.invalid` site and with the test key
 * otherwise (or `signer`: "demo", "test" or "none").
 */
export function writeFixturePack(
  dir,
  {
    pages = FIXTURE_PAGES,
    coverage = FIXTURE_COVERAGE,
    aptyVersion = "5.x",
    space = "FX",
    site = DEMO_SITE,
    signer = site.endsWith(".invalid") ? "demo" : "test",
    builtAt = new Date().toISOString(),
    expiresAt,
    name,
  } = {},
) {
  const built = buildPack({
    pages,
    site,
    space,
    label: "rag-card",
    builtAt,
    ...(expiresAt ? { expiresAt } : {}),
    coverage,
    aptyVersion,
  }).pack;
  const pack =
    signer === "none"
      ? built
      : signPack(
          built,
          signer === "demo"
            ? readFileSync(DEMO_SIGNING_KEY, "utf8")
            : testKey.pem,
        );
  const file = join(
    dir,
    name ?? `apty-kb-${space}-${aptyVersion}-fixture.kbpack.json`,
  );
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
  await card
    .getByText(
      /^Imported \d+ cards for Apty (?:4\.x|5\.x|common) from space \w+\.$/,
    )
    .waitFor();
  await options.close();
}

/** The pack with one card's text changed after it was signed, its checksum recomputed: the signature no longer matches. */
export function tamperedPack(pack) {
  const chunks = pack.chunks.map((chunk, i) =>
    i === 0
      ? { ...chunk, text: `${chunk.text} (edited after signing)` }
      : chunk,
  );
  const edited = { ...pack, chunks };
  return { ...edited, sha256: packSha256(edited) };
}
