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

before(async () => {
  model = await startMockModel();
  site = await startPageServer({
    "/app.html": `<!doctype html><title>Original</title><h1>App</h1>
      <iframe src="/frame.html"></iframe>
      <script>setInterval(() => fetch("/api/segments.json").catch(() => {}), 150);</script>`,
    "/frame.html": "<!doctype html><button>inside frame</button>",
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
  helperDir = writeRestartHelper(join(tempDir("apty-e2e-helper-"), "helper"));
  browser = await launchBrowser({ extraExtensions: [helperDir] });
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
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
    const { aipex_settings } = await chrome.storage.local.get("aipex_settings");
    await chrome.storage.local.set({
      aipex_settings: { ...aipex_settings, ...patch },
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

  it("remembers 'Allow on this site' for that tool only, until revoked in options", async () => {
    const app = await openApp();
    const panel = await openSidePanel(browser, model, app);

    model.script(
      callToolThenReport("run_console_command", { expression: "1 + 1" }),
    );
    await chatAndWait(panel, "run a console command", {
      whileWaiting: answerPrompt(panel, /Allow on this site/),
    });

    model.script(
      callToolThenReport("run_console_command", {
        expression: "document.title = 'REMEMBERED'; 2 + 2",
      }),
    );
    await chatAndWait(panel, "run a console command again");
    assert.equal(
      lastToolResult().success,
      true,
      JSON.stringify(lastToolResult()),
    );
    assert.equal(await app.title(), "REMEMBERED");

    const options = await extensionPage(browser);
    await options.getByText("Remembered approvals").waitFor();
    await options.getByText(/run_console_command/).waitFor();
    await options.getByRole("button", { name: "Revoke all" }).click();
    await options.getByText("No active approvals.").waitFor();
    await options.close();
    await app.bringToFront();

    model.script(
      callToolThenReport("run_console_command", {
        expression: "document.title = 'AFTER-REVOKE'",
      }),
    );
    await chatAndWait(panel, "run a console command once more", {
      whileWaiting: answerPrompt(panel, "Deny"),
    });
    assert.equal(await app.title(), "REMEMBERED");
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

    const border = app.locator("#aipex-border-overlay > div");
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
    await chatAndWait(panel, "check dom health across the whole application", {
      timeout: 120_000,
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
