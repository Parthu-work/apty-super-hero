import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPolicy = vi.hoisted(() => vi.fn());
const mockGetSnapshot = vi.hoisted(() => vi.fn());
const mockCreateSnapshot = vi.hoisted(() => vi.fn());
const mockGetNodeByUid = vi.hoisted(() => vi.fn());
const mockGetSnapshotMode = vi.hoisted(() => vi.fn());
const mockFormatSnapshot = vi.hoisted(() => vi.fn());
const mockEditorValue = vi.hoisted(() => vi.fn());
const mockExecuteScript = vi.hoisted(() => vi.fn());
const mockGetActiveTab = vi.hoisted(() => vi.fn());

vi.mock("../runtime/value-policy", () => ({
  currentValuePolicy: mockPolicy,
}));

vi.mock("../automation/snapshot-provider", () => ({
  getSnapshot: mockGetSnapshot,
  createSnapshot: mockCreateSnapshot,
  getNodeByUid: mockGetNodeByUid,
  getSnapshotMode: mockGetSnapshotMode,
  formatSnapshot: mockFormatSnapshot,
}));

vi.mock("../automation/dom-element-handle", () => ({
  DomElementHandle: class {
    dispose = vi.fn();
    asLocator() {
      return { getEditorValue: mockEditorValue };
    }
  },
}));

vi.mock("./tab-utils", () => ({ getActiveTab: mockGetActiveTab }));

vi.stubGlobal("chrome", {
  scripting: { executeScript: mockExecuteScript },
});

import { getEditorValueTool } from "./element";
import { getPageMetadataTool } from "./page";

/** The tool's result as plain data, whether the SDK hands back an object or a JSON string. */
async function run(tool: unknown, args: unknown = {}) {
  const out = await (
    tool as { invoke: (ctx: unknown, input: string) => Promise<unknown> }
  ).invoke({}, JSON.stringify(args));
  return typeof out === "string" ? JSON.parse(out) : out;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetSnapshot.mockReturnValue({ root: {} });
  mockGetNodeByUid.mockReturnValue({ id: "u1" });
  mockGetSnapshotMode.mockResolvedValue("dom");
  mockEditorValue.mockResolvedValue("Jane Testpatient");
  mockGetActiveTab.mockResolvedValue({
    id: 7,
    title: "Chart",
    url: "https://app.example.com/chart?mrn=123",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("get_editor_value under a value policy", () => {
  it.each([
    ["show", { success: true, value: "Jane Testpatient", length: 16 }],
    ["mask", { success: true, value: "[masked]", masked: true }],
  ])("%s", async (policy, expected) => {
    mockPolicy.mockReturnValue(policy);
    expect(await run(getEditorValueTool, { tabId: 1, uid: "u1" })).toEqual(
      expected,
    );
  });

  it("withholds the value entirely", async () => {
    mockPolicy.mockReturnValue("withhold");
    const result = await run(getEditorValueTool, { tabId: 1, uid: "u1" });
    expect(JSON.stringify(result)).not.toContain("Jane");
    expect(result).toMatchObject({ success: false, withheld: true });
  });
});

describe("get_page_metadata under a value policy", () => {
  beforeEach(() => {
    mockExecuteScript.mockResolvedValue([
      {
        result: {
          title: "Chart",
          url: "https://app.example.com/chart?mrn=123#t",
        },
      },
    ]);
  });

  it("strips the query and fragment from the URL when withholding", async () => {
    mockPolicy.mockReturnValue("withhold");
    const raw = await run(getPageMetadataTool);
    expect(raw).toMatchObject({
      title: "Chart",
      url: "https://app.example.com/chart",
    });
  });

  it("leaves the URL alone when showing", async () => {
    mockPolicy.mockReturnValue("show");
    const raw = await run(getPageMetadataTool);
    expect(raw.url).toBe("https://app.example.com/chart?mrn=123#t");
  });
});
