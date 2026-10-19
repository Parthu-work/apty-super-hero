/**
 * URLs that are not absolute web URLs, as the model and MCP clients get
 * them: after the real outbound sanitizer (chat) and redactToolOutput (what
 * the MCP server runs), in the mode current at that moment. A relative, an
 * unparsable and a file: URL are masked like any other, or emptied when
 * they can't be parsed; prose and console text are left alone.
 *
 * get_page_metadata, get_all_tabs and get_current_tab run as real tools.
 * The network, Apty diagnostics and console results come from live CDP
 * events or the page, so their result shapes go through the same wrapper
 * every tool result goes through (applyResultPrivacy in the current mode).
 */
import type { AgentInputItem } from "@apty/agent-core";
import { redactUrl } from "@apty/debug-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ID = "884213";

type Mode = "strict" | "standard";

const state = vi.hoisted(() => ({
  mode: "standard" as "strict" | "standard",
  url: "",
}));

vi.hoisted(() => {
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: { id: "agent", lastError: undefined, sendMessage: vi.fn() },
    scripting: {
      executeScript: vi.fn(async () => [
        {
          result: {
            title: "Chart",
            url: state.url,
            description: "d",
            ogImage: state.url,
            favicon: state.url,
          },
        },
      ]),
    },
    tabs: {
      query: vi.fn(async () => [
        {
          id: 1,
          url: state.url,
          title: "Chart",
          active: true,
          windowId: 1,
          index: 0,
        },
      ]),
      get: vi.fn(async () => ({ id: 1, url: state.url, title: "Chart" })),
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({
          [key]: { redactionMode: state.mode },
        })),
        set: vi.fn(async () => {}),
      },
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
      onChanged: { addListener: vi.fn() },
    },
  };
});

import {
  createOutboundSanitizer,
  redactToolOutput,
} from "../runtime/outbound-sanitizer";
import {
  currentRedactionMode,
  getRedactionMode,
  resetRedactionModeForTests,
} from "../runtime/redaction-mode";
import { applyResultPrivacy } from "../runtime/result-privacy";
import { currentValuePolicy } from "../runtime/value-policy";
import { allBrowserTools } from "./index";

const INPUTS = {
  relative: `/patients/${ID}/chart?mrn=${ID}`,
  unparsable: `https://[patients/${ID}/chart?mrn=${ID}`,
  "file:": `file:///patients/${ID}/chart?mrn=${ID}`,
};
const CONTROL = `https://ehr.example/patients/${ID}/chart?mrn=${ID}`;

async function setMode(mode: Mode): Promise<void> {
  state.mode = mode;
  resetRedactionModeForTests();
  await getRedactionMode();
}

/** A tool result as the chat model and as an MCP client get it, in the mode current now. */
async function asSent(output: unknown): Promise<{ chat: string; mcp: string }> {
  const [item] = await createOutboundSanitizer({
    getMode: currentRedactionMode,
  })([
    {
      type: "function_call_result",
      name: "tool",
      callId: "call",
      status: "completed",
      output,
    } as unknown as AgentInputItem,
  ]);
  const text = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  return {
    chat: text((item as { output: unknown }).output),
    mcp: text(redactToolOutput(output, currentRedactionMode())),
  };
}

async function realTool(name: string): Promise<unknown> {
  const found = allBrowserTools.find((t) => t.name === name) as unknown as {
    invoke: (ctx: unknown, input: string) => Promise<unknown>;
  };
  return found.invoke({ context: { conversationId: "c" } }, "{}");
}

/** What withResultPrivacy does to every tool result. */
const wrapped = (result: unknown) =>
  applyResultPrivacy(result, currentValuePolicy());

const TOOLS: Record<string, (url: string) => Promise<unknown>> = {
  get_page_metadata: () => realTool("get_page_metadata"),
  get_all_tabs: () => realTool("get_all_tabs"),
  get_current_tab: () => realTool("get_current_tab"),
  "stop_network_capture (requests[].url)": async (url) =>
    wrapped({
      session: { bodiesCaptured: false },
      requests: [{ requestId: "1", url, method: "GET", status: 200 }],
    }),
  "get_network_diagnostics (requests[].url after redactUrl)": async (url) =>
    wrapped({ requests: [{ url: redactUrl(url), status: 500 }] }),
  "Apty diagnostics (page-reported JSON under any key)": async (url) =>
    wrapped({ config: { segmentsUrl: url } }),
};

function expectMasked(sent: { chat: string; mcp: string }, mode: Mode) {
  for (const [layer, text] of Object.entries(sent)) {
    expect(text, layer).not.toContain(`mrn=${ID}`);
    expect(text, layer).not.toContain("null/");
    expect(text, layer).not.toContain("https://[");
    if (mode === "strict") expect(text, layer).not.toContain(ID);
  }
}

beforeEach(async () => {
  await setMode("standard");
});

describe("a URL that is not an absolute web URL, as the model gets it", () => {
  for (const [tool, run] of Object.entries(TOOLS)) {
    it.each(
      Object.entries(INPUTS),
    )(`${tool}: a %s URL is masked or emptied, in Strict and Standard`, async (_kind, url) => {
      for (const mode of ["strict", "standard"] as const) {
        await setMode(mode);
        state.url = url;
        expectMasked(await asSent(await run(url)), mode);
      }
    });
  }
});

describe("controls that do not change", () => {
  it.each(
    Object.keys(TOOLS),
  )("%s: an absolute web URL is masked as before", async (tool) => {
    const run = TOOLS[tool] as (url: string) => Promise<unknown>;
    state.url = CONTROL;
    await setMode("strict");
    const strict = await asSent(await run(CONTROL));
    expect(strict.chat).not.toContain(ID);
    await setMode("standard");
    const standard = await asSent(await run(CONTROL));
    expect(standard.chat).toContain(`/patients/${ID}/chart`);
    expect(standard.chat).not.toContain(`mrn=${ID}`);
  });

  it("DOM Health's own sanitized hrefs pass through unchanged", async () => {
    const hrefs = [
      "https://ehr.example/patients/:id/chart?mrn=<redacted>",
      "/patients/:id/chart?mrn=<redacted>",
      "file:///patients/:id/chart?mrn=<redacted>",
    ];
    for (const mode of ["strict", "standard"] as const) {
      await setMode(mode);
      for (const href of hrefs) {
        const sent = await asSent(
          wrapped({ findings: [{ attributes: { href } }] }),
        );
        expect(sent.chat).not.toContain(ID);
        expect(sent.mcp).not.toContain(ID);
      }
    }
  });

  it("console free text is left alone (a known limitation, not fixed here)", async () => {
    for (const mode of ["strict", "standard"] as const) {
      await setMode(mode);
      const sent = await asSent(
        wrapped({ result: `link: ${INPUTS.relative}` }),
      );
      expect(sent.chat).toContain(`link: ${INPUTS.relative}`);
    }
  });
});
