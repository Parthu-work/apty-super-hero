/**
 * Settings → AI Configuration against an OpenAI-compatible mock model
 * (C1): "Fetch models" reads the provider's live list (and falls back to
 * manual entry on a 401), and Test Connection's tool-calling probe reports
 * yes, no or unknown, in the real Options page.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { extensionPage, launchBrowser, startMockModel } from "./harness.mjs";

let browser;
let model;
let options;

/** The probe offers a single tool named report_probe; how each model id answers it. */
function scriptModels(request) {
  const probing = request.tools?.some(
    (t) => (t.function?.name ?? t.name) === "report_probe",
  );
  if (!probing) return { text: "Hello" };
  switch (request.model) {
    case "mock-tools":
      return { tool: "report_probe", args: { value: "ok" } };
    case "mock-refuses-tools":
      return {
        error: { status: 400, message: "This model does not support tools" },
      };
    case "mock-flaky":
      return { error: { status: 503, message: "Service Unavailable" } };
    default:
      return { text: "I would rather not." };
  }
}

before(async () => {
  model = await startMockModel();
  model.script(scriptModels);
  browser = await launchBrowser();
  options = await extensionPage(
    browser,
    "src/entrypoints/options/index.html?tab=ai",
  );
  await options
    .getByRole("tab", { name: "AI Configuration" })
    .click()
    .catch(() => {});
  await options.getByLabel("AI Host").fill(model.baseUrl);
  await options.getByPlaceholder("Your API Key").fill("e2e-key");
});

after(async () => {
  await browser?.close();
  model?.close();
});

async function suggestions() {
  return options.evaluate(() =>
    [...document.querySelectorAll("datalist option")].map((o) => o.value),
  );
}

async function testWithModel(id) {
  await options.getByLabel("AI Model").fill(id);
  await options.getByRole("button", { name: "Test Connection" }).click();
  return options
    .getByText(/^Connection test successful · /)
    .last()
    .innerText({ timeout: 60_000 });
}

describe("Fetch models (C1)", () => {
  it("names a 401, keeps manual entry, and sends the key only as a Bearer header", async () => {
    model.serveModels(401, { error: { message: "Invalid API key" } });
    await options.getByRole("button", { name: "Fetch models" }).click();

    await options
      .getByRole("alert")
      .filter({ hasText: "The provider rejected the API key (401)." })
      .waitFor();
    assert.deepEqual(model.modelListAuth, ["Bearer e2e-key"]);
    await options.getByLabel("AI Model").fill("typed-by-hand");
    assert.equal(
      await options.getByLabel("AI Model").inputValue(),
      "typed-by-hand",
    );
  });

  it("lists the provider's models as suggestions", async () => {
    model.serveModels(200, {
      object: "list",
      data: [{ id: "mock-tools" }, { id: "mock-text-only" }],
    });
    await options.getByRole("button", { name: "Fetch models" }).click();

    await options.getByText("2 models from the provider").waitFor();
    assert.deepEqual((await suggestions()).slice(0, 2), [
      "mock-text-only",
      "mock-tools",
    ]);
  });
});

describe("tool-calling probe in Test Connection (C1)", () => {
  it("yes: the model calls the probe tool", async () => {
    assert.equal(
      await testWithModel("mock-tools"),
      "Connection test successful · Tool calling: yes",
    );
    const probe = model.requests.findLast((r) => r.tools);
    assert.equal(probe.model, "mock-tools");
    assert.equal(probe.tools.length, 1);
  });

  it("no: the model answers in text, and the model is flagged", async () => {
    assert.equal(
      await testWithModel("mock-text-only"),
      "Connection test successful · Tool calling: no — the agent needs it",
    );
    await options.getByText("No tools").first().waitFor();
  });

  it("no: the provider refuses tools", async () => {
    assert.equal(
      await testWithModel("mock-refuses-tools"),
      "Connection test successful · Tool calling: no — the agent needs it",
    );
  });

  it("unknown: two probe attempts both fail", async () => {
    const before = model.requests.length;
    assert.equal(
      await testWithModel("mock-flaky"),
      "Connection test successful · Tool calling: unknown",
    );
    // The basic check, then the probe and its one retry.
    assert.equal(model.requests.length - before, 3);
  });
});
