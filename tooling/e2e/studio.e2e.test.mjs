/**
 * Apty Studio as a second peer (D2), mirroring the Apty Client suite:
 * fixture Studio extensions that answer the same contract, do not
 * allow-list the Agent, or have no bridge. The Studio row in Options gives
 * each its specific fix, and the agent reads Studio's service-worker logs.
 * Studio itself is not changed; these fixtures stand in for it.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  AGENT_EXTENSION_ID,
  callToolThenReport,
  chatAndWait,
  extensionPage,
  launchBrowser,
  openSidePanel,
  savedPeerId,
  startMockModel,
  startPageServer,
  tempDir,
  toolResults,
  unpackedExtensionId,
  writeFakeClient,
} from "./harness.mjs";

const base = tempDir("apty-e2e-studio-");
const studios = Object.fromEntries(
  ["working", "bridge-missing", "not-allowlisted"].map((mode) => {
    const dir = writeFakeClient(
      join(base, mode),
      mode,
      AGENT_EXTENSION_ID,
      "Studio",
    );
    return [mode, { dir, id: unpackedExtensionId(dir) }];
  }),
);

let browser;
let model;
let site;

before(async () => {
  model = await startMockModel();
  site = await startPageServer({
    "/app.html": "<title>App</title><h1>App</h1>",
  });
  browser = await launchBrowser({
    extraExtensions: Object.values(studios).map((s) => s.dir),
  });
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

function studioCard(options) {
  return options.locator("#apty-studio");
}

async function connectStudio(mode) {
  const options = await extensionPage(
    browser,
    "src/entrypoints/options/index.html#apty-studio",
  );
  const card = studioCard(options);
  if (await savedPeerId(options, "studio")) {
    await card.getByRole("button", { name: "Disconnect" }).click();
  }
  await card.getByLabel("Apty Studio's Chrome ID").fill(studios[mode].id);
  await card.getByRole("button", { name: "Connect", exact: true }).click();
  return { options, card };
}

describe("Apty Studio peer (D2)", () => {
  it("not allow-listed: names the manifest change with this Agent's ID", async () => {
    const { options, card } = await connectStudio("not-allowlisted");
    await card.getByText("Installed, but not answering the Agent.").waitFor({
      timeout: 30_000,
    });
    await card
      .getByText(
        `Apty Studio's manifest must list this Agent ID in externally_connectable.ids: "${AGENT_EXTENSION_ID}"`,
      )
      .waitFor();
    assert.match(
      await card.innerText(),
      /Chrome found nothing listening in the Apty Studio/,
    );
    await options.close();
  });

  it("no bridge: says to install the Agent bridge module in Studio", async () => {
    const { options, card } = await connectStudio("bridge-missing");
    await card.getByText("Installed, but not answering the Agent.").waitFor({
      timeout: 30_000,
    });
    assert.match(await card.innerText(), /Agent bridge module|bridge module/);
    assert.doesNotMatch(await card.innerText(), /Apty Client/);
    await options.close();
  });

  it("working: answers the handshake, and the agent reads Studio's service-worker logs", async () => {
    const { options, card } = await connectStudio("working");
    await card.getByText("Answering").waitFor({ timeout: 30_000 });
    const stored = await options.evaluate(
      async () =>
        (await chrome.storage.local.get("apty-integration-config"))[
          "apty-integration-config"
        ],
    );
    assert.deepEqual(stored.peers, {
      studio: { extensionId: studios.working.id },
    });
    assert.equal(stored.clientExtensionId, undefined);
    await options.close();

    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app);
    model.script(
      callToolThenReport("get_apty_studio_service_worker_diagnostics", {}),
    );
    await chatAndWait(panel, "show apty studio's service worker logs");

    const result = toolResults(model.requests.at(-1)).at(-1);
    assert.equal(
      result.status.status,
      "ok",
      JSON.stringify(result).slice(0, 400),
    );
    assert.deepEqual(
      result.logs.map((l) => l.message),
      ["Failed to load themes.json: 403", "widget initialised"],
    );
    await panel.close();
    await app.close();
  });
});
