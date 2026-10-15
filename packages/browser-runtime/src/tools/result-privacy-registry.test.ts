import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPolicy = vi.hoisted(() => vi.fn());

vi.mock("../runtime/value-policy", () => ({
  currentValuePolicy: mockPolicy,
  valuePolicyForMode: vi.fn(),
}));

const PHI_TAB = vi.hoisted(() => ({
  id: 7,
  windowId: 1,
  index: 0,
  active: true,
  title: "Jane Testpatient - Chart",
  url: "https://ehr.example.com/patients/chart?mrn=884213&dob=1961-04-02",
}));

vi.hoisted(() => {
  (globalThis as { chrome?: unknown }).chrome = {
    tabs: {
      query: vi.fn(async () => [PHI_TAB]),
      get: vi.fn(async () => PHI_TAB),
      update: vi.fn(async () => PHI_TAB),
    },
    storage: {
      local: { get: vi.fn(async () => ({})) },
      onChanged: { addListener: vi.fn() },
    },
    runtime: { id: "x" },
  };
});

import { allBrowserTools, browserToolGroups } from "./index";

async function run(name: string, args: unknown = {}, tools = allBrowserTools) {
  const tool = tools.find((t) => t.name === name) as unknown as {
    invoke: (ctx: unknown, input: string) => Promise<unknown>;
  };
  const out = await tool.invoke({}, JSON.stringify(args));
  return typeof out === "string" ? JSON.parse(out) : out;
}

beforeEach(() => {
  mockPolicy.mockReset();
});

describe("tab tool results under the redaction mode", () => {
  it("get_all_tabs shows only id and origin in Strict", async () => {
    mockPolicy.mockReturnValue("withhold");
    const result = await run("get_all_tabs");
    expect(result.tabs[0]).toMatchObject({
      id: 7,
      url: "https://ehr.example.com",
    });
    expect(JSON.stringify(result)).not.toMatch(/Testpatient|884213|1961/);
  });

  it("get_current_tab masks query values and keeps the title in Standard", async () => {
    mockPolicy.mockReturnValue("mask");
    const result = await run("get_current_tab");
    expect(result).toMatchObject({
      url: "https://ehr.example.com/patients/chart?mrn=[masked]&dob=[masked]",
      title: "Jane Testpatient - Chart",
    });
  });

  it("get_tab_info is unchanged in Off", async () => {
    mockPolicy.mockReturnValue("show");
    const result = await run("get_tab_info", { tabId: 7 });
    expect(JSON.stringify(result)).toContain("mrn=884213");
  });

  it("the grouped registry offered to the model is filtered too", async () => {
    mockPolicy.mockReturnValue("withhold");
    const result = await run(
      "get_all_tabs",
      {},
      browserToolGroups.tabs as unknown as typeof allBrowserTools,
    );
    expect(JSON.stringify(result)).not.toMatch(/Testpatient|884213/);
  });
});
