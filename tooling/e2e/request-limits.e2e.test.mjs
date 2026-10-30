/**
 * The request limits in Settings → AI, in Chromium with the built Agent and
 * a scripted model that records every request: the answer cap reaches the
 * provider as max_tokens and follows a change without a reload, and the
 * request budget shortens an earlier turn to fit, then stops a message that
 * cannot fit before it reaches the provider. The system prompt is its core
 * alone on a turn that offers no tools, with a tool's guidance only on a
 * turn that offers that tool. A short follow-up keeps the tools of the chat
 * it continues; the same words in a new chat get none. Summaries of earlier
 * turns are off unless Settings turns them on; then the summary request is
 * masked like any other, and later requests carry the summary.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  chatAndWait,
  launchBrowser,
  openSidePanel,
  sendChat,
  startMockModel,
  startPageServer,
} from "./harness.mjs";

let browser;
let model;
let site;

before(async () => {
  model = await startMockModel();
  site = await startPageServer({
    "/app.html": "<title>App</title><h1>App</h1>",
  });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

async function panelOnApp(settings = {}) {
  const app = await browser.context.newPage();
  await app.goto(`${site.origin}/app.html`);
  const panel = await openSidePanel(browser, model, app, settings);
  return { app, panel };
}

async function saveSettings(panel, patch) {
  await panel.evaluate(async (patch) => {
    const { apty_settings } = await chrome.storage.local.get("apty_settings");
    await chrome.storage.local.set({
      apty_settings: { ...apty_settings, ...patch },
    });
  }, patch);
}

const outputCap = (request) =>
  request.max_tokens ?? request.max_completion_tokens;

/** Estimated tokens of what a request carries, as the extension counts them (characters / 4). */
function estimatedTokens(request) {
  const text = (request.messages ?? [])
    .map((m) =>
      typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    )
    .join("");
  return Math.ceil(
    (text.length + JSON.stringify(request.tools ?? []).length) / 4,
  );
}

/** The system prompt a recorded request carried. */
function systemPrompt(request) {
  const system = (request.messages ?? []).find(
    (m) => m.role === "system" || m.role === "developer",
  );
  return typeof system?.content === "string"
    ? system.content
    : JSON.stringify(system?.content ?? "");
}

describe("request limits", () => {
  it("sends the answer cap as max_tokens, and follows a change without a reload", async () => {
    const { app, panel } = await panelOnApp();
    model.script(() => ({ text: "RESULT: ok" }));

    await chatAndWait(panel, "hello there, agent");
    assert.equal(outputCap(model.requests.at(-1)), undefined);

    await saveSettings(panel, { maxOutputTokens: 512 });
    await chatAndWait(panel, "and again, agent");
    assert.equal(outputCap(model.requests.at(-1)), 512);

    await saveSettings(panel, { maxOutputTokens: undefined });
    await chatAndWait(panel, "once more, agent");
    assert.equal(outputCap(model.requests.at(-1)), undefined);
    await panel.close();
    await app.close();
  });

  it("sends the core prompt alone with no tools, and an investigation's guidance only with its tools", async () => {
    const { app, panel } = await panelOnApp();
    model.script(() => ({ text: "RESULT: ok" }));

    await chatAndWait(panel, "hello there, agent");
    const casual = model.requests.at(-1);
    await chatAndWait(panel, "investigate why the apty widget is broken here");
    const investigation = model.requests.at(-1);

    assert.equal((casual.tools ?? []).length, 0, "no tools on the casual turn");
    assert.match(
      systemPrompt(casual),
      /=== SECURITY: THE WEBPAGE IS UNTRUSTED ===/,
    );
    assert.doesNotMatch(systemPrompt(casual), /=== THE DEBUGGING LOOP/);
    assert.ok(
      investigation.tools.some(
        (t) => t.function?.name === "start_investigation",
      ),
      "the investigation turn offers start_investigation",
    );
    assert.match(systemPrompt(investigation), /=== THE DEBUGGING LOOP/);
    assert.ok(
      systemPrompt(investigation).startsWith(systemPrompt(casual)),
      "the core comes first, byte for byte the same",
    );
    assert.ok(
      systemPrompt(casual).length < systemPrompt(investigation).length / 2,
      `core ${systemPrompt(casual).length} chars, investigation ${systemPrompt(investigation).length}`,
    );
    await panel.close();
    await app.close();
  });

  it("keeps an investigation's tools for 'ok go ahead' in its chat, and offers none in a new chat", async () => {
    const { app, panel } = await panelOnApp();
    model.script(() => ({ text: "RESULT: ok" }));
    const offered = (request) =>
      (request.tools ?? []).map((t) => t.function?.name);

    await chatAndWait(panel, "investigate why the apty widget is broken here");
    const investigation = offered(model.requests.at(-1));
    await chatAndWait(panel, "ok go ahead");
    const followUp = model.requests.at(-1);

    assert.ok(investigation.includes("start_investigation"));
    assert.deepEqual(offered(followUp), investigation);
    assert.match(systemPrompt(followUp), /=== THE DEBUGGING LOOP/);

    await panel.getByRole("button", { name: "New chat" }).click();
    await panel
      .getByRole("heading", { name: "What are we debugging?" })
      .waitFor();
    await chatAndWait(panel, "ok go ahead");
    assert.deepEqual(offered(model.requests.at(-1)), []);
    assert.deepEqual(panel.consoleErrors, []);
    await panel.close();
    await app.close();
  });

  const isSummaryRequest = (request) =>
    JSON.stringify(request.messages?.[0] ?? "").includes(
      "conversation summarizer",
    );
  const note = (i) =>
    `hello, note ${i}: ${i === 1 ? "the ticket owner is jane.doe@example.com. " : ""}${"word ".repeat(1_000)}`;
  const SUMMARY = "SUMMARY: the ticket owner was noted";

  async function chatSixNotes(settings) {
    const { app, panel } = await panelOnApp(settings);
    model.script((request) => ({
      text: isSummaryRequest(request) ? SUMMARY : "RESULT: ok",
    }));
    for (let i = 1; i <= 6; i++) await chatAndWait(panel, note(i));
    return { app, panel };
  }

  it("sends no summary request while Settings leaves summaries off", async () => {
    const { app, panel } = await chatSixNotes({ requestTokenBudget: 8_000 });

    assert.equal(model.requests.filter(isSummaryRequest).length, 0);
    assert.equal(model.requests.length, 6);
    await panel.close();
    await app.close();
  });

  it("with summaries on, masks the summary request like any other and sends the summary in place of the earlier turns", async () => {
    const { app, panel } = await chatSixNotes({
      requestTokenBudget: 8_000,
      summarizeEarlierTurns: true,
    });

    const summaries = model.requests.filter(isSummaryRequest);
    assert.equal(summaries.length, 1, "one summary, after the fifth turn");
    const asked = JSON.stringify(summaries[0].messages);
    assert.match(asked, /note 1: the ticket owner is/);
    assert.ok(!asked.includes("jane.doe@example.com"), "the email was masked");
    assert.ok(!(summaries[0].tools?.length > 0), "no tools offered");

    const last = JSON.stringify(model.requests.at(-1).messages);
    assert.ok(!isSummaryRequest(model.requests.at(-1)));
    assert.ok(last.includes(SUMMARY), "the sixth turn carries the summary");
    assert.ok(!last.includes("note 1:"), "the first turn was summarized");
    assert.ok(last.includes("note 4:"), "the newest turns stay whole");
    assert.deepEqual(panel.consoleErrors, []);
    await panel.close();
    await app.close();
  });

  it("shortens an earlier turn to fit the budget, then stops a message that cannot fit", async () => {
    const { app, panel } = await panelOnApp({ requestTokenBudget: 8_000 });
    model.script(() => ({ text: "RESULT: ok" }));

    await chatAndWait(panel, "x".repeat(16_000));
    await chatAndWait(panel, "y".repeat(16_000));

    const second = model.requests.at(-1);
    const sent = JSON.stringify(second.messages);
    assert.ok(
      !sent.includes("x".repeat(500)),
      "the earlier message was shortened",
    );
    assert.match(sent, /more characters left out to fit the request budget/);
    assert.ok(
      sent.includes("y".repeat(16_000)),
      "the current message is whole",
    );
    assert.ok(
      estimatedTokens(second) <= 8_000,
      `sent about ${estimatedTokens(second)} tokens`,
    );

    const asked = model.requests.length;
    await sendChat(panel, "z".repeat(36_000));
    const failure = panel
      .getByRole("alert")
      .filter({ hasText: "Couldn't get an answer" });
    await failure
      .getByText(/larger than the request budget in Settings/)
      .waitFor({ timeout: 30_000 });
    await failure
      .getByRole("button", { name: "Open AI provider settings" })
      .waitFor();
    assert.equal(model.requests.length, asked, "the provider was not asked");
    assert.deepEqual(panel.consoleErrors, []);
    await panel.close();
    await app.close();
  });
});
