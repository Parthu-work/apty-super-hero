/**
 * S4: in Strict (the default), a page whose URL carries a record number and
 * date of birth and whose title names the patient reaches neither the model
 * nor an MCP client through the tab, page and screenshot tools.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  chatAndWait,
  extensionPage,
  launchBrowser,
  openSidePanel,
  ROOT,
  startMockModel,
  startPageServer,
  tempDir,
  toolResults,
} from "./harness.mjs";

const PATIENT = "Jane Testpatient";
const MRN = "884213";
const DOB = "1961-04-02";
const PAGE = `<!doctype html><title>${PATIENT} - Chart</title>
<main><h1>Chart</h1><a href="/chart.html?mrn=${MRN}">Reload</a>
<button type="button">Save</button></main>`;
const LEAKS = [PATIENT, "Testpatient", MRN, DOB];

let browser;
let model;
let site;
let chartUrl;

before(async () => {
  model = await startMockModel();
  site = await startPageServer({ "/chart.html": PAGE });
  chartUrl = `${site.origin}/chart.html?mrn=${MRN}&dob=${DOB}`;
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

function leaked(text) {
  return LEAKS.filter((needle) => text.includes(needle));
}

describe("PHI in the page URL and title (Strict)", () => {
  it("does not reach the model through tab and page tools", async () => {
    const app = await browser.context.newPage();
    await app.goto(chartUrl);
    const tabId = await browser.agentWorker.evaluate(
      async (url) => (await chrome.tabs.query({ url })).at(0)?.id,
      chartUrl,
    );
    const calls = [
      { tool: "get_all_tabs", args: {} },
      { tool: "get_current_tab", args: {} },
      { tool: "get_tab_info", args: { tabId } },
      { tool: "get_page_metadata", args: {} },
      { tool: "search_elements", args: { tabId, query: "*Reload*" } },
    ];
    const ran = [];
    model.script((request) => {
      const offered = new Set(
        (request.tools ?? []).map((t) => t.function?.name),
      );
      const pending = calls.filter((c) => offered.has(c.tool));
      const done = toolResults(request).length;
      if (done < pending.length) {
        ran.push(pending[done].tool);
        return pending[done];
      }
      return { text: "RESULT: done" };
    });
    const panel = await openSidePanel(browser, model, app);
    await chatAndWait(panel, "Show the page metadata and my open tabs");

    const sent = JSON.stringify(model.requests);
    for (const tool of ["get_all_tabs", "get_current_tab", "get_tab_info"]) {
      assert.ok(ran.includes(tool), `${tool} ran: ${ran}`);
    }
    assert.deepEqual(leaked(sent), []);
    await panel.close();
    await app.close();
  });
});

function freePort() {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

describe("PHI in the page URL and title over MCP (Strict)", () => {
  it("does not reach an MCP client", async () => {
    const configDir = tempDir("apty-phi-mcp-");
    const port = await freePort();
    const daemon = spawn(
      process.execPath,
      [
        join(ROOT, "apps/mcp-bridge/dist/daemon.js"),
        "--port",
        String(port),
        "--host",
        "127.0.0.1",
        "--extension-id",
        browser.extensionId,
      ],
      {
        env: {
          ...process.env,
          APTY_MCP_CONFIG_DIR: configDir,
          HOME: configDir,
        },
        stdio: "ignore",
      },
    );
    try {
      for (let i = 0; i < 50; i++) {
        const ok = await fetch(`http://127.0.0.1:${port}/health`).then(
          (r) => r.ok,
          () => false,
        );
        if (ok) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const token = readFileSync(join(configDir, "token"), "utf8").trim();
      const page = await extensionPage(browser);
      const connected = await page.evaluate(
        ({ url, token }) =>
          chrome.runtime.sendMessage({
            request: "ws-bridge-connect",
            url,
            token,
          }),
        { url: `ws://127.0.0.1:${port}/extension`, token },
      );
      assert.equal(connected?.success, true, JSON.stringify(connected));

      const app = await browser.context.newPage();
      await app.goto(chartUrl);
      await app.bringToFront();

      const replies = [];
      for (const name of ["get_all_tabs", "get_current_tab"]) {
        replies.push(
          await new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/cli`, [
              "apty-mcp.v1",
              `apty-token.${token}`,
            ]);
            const timer = setTimeout(() => reject(new Error(name)), 60_000);
            ws.addEventListener("open", () =>
              ws.send(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  method: "tools/call",
                  params: { name, arguments: {} },
                }),
              ),
            );
            ws.addEventListener("message", (event) => {
              clearTimeout(timer);
              ws.close();
              resolve(event.data);
            });
            ws.addEventListener("error", reject);
          }),
        );
      }
      const text = replies.join("\n");
      assert.ok(text.includes(site.origin), text.slice(0, 300));
      assert.deepEqual(leaked(text), []);
      await page.evaluate(() =>
        chrome.runtime.sendMessage({ request: "ws-bridge-disconnect" }),
      );
      await page.close();
      await app.close();
    } finally {
      daemon.kill();
    }
  });
});
