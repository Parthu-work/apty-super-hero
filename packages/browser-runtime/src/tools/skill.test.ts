import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockInitialize = vi.hoisted(() => vi.fn());
const mockExecuteSkillScript = vi.hoisted(() => vi.fn());
const mockGetSkillContent = vi.hoisted(() => vi.fn());

vi.mock("../skills/lib/services/skill-manager", () => ({
  skillManager: {
    initialize: mockInitialize,
    executeSkillScript: mockExecuteSkillScript,
    getSkillContent: mockGetSkillContent,
  },
}));

vi.mock("../skills/mcp-servers/skills", () => ({
  getSkillInfo: vi.fn(),
}));

let storageStore: Record<string, unknown> = {};

(global as any).chrome = {
  storage: {
    local: {
      get: (key: string) => Promise.resolve({ [key]: storageStore[key] }),
      set: (items: Record<string, unknown>) => {
        storageStore = { ...storageStore, ...items };
        return Promise.resolve();
      },
    },
  },
};

import { resetApprovalStateForTests } from "./approval";
import { answerApprovals } from "./approval-test-utils";
import { executeSkillScriptTool, loadSkillTool } from "./skill";

beforeEach(async () => {
  vi.clearAllMocks();
  await resetApprovalStateForTests();
  storageStore = {};
  mockInitialize.mockResolvedValue(undefined);
  mockExecuteSkillScript.mockResolvedValue({ output: "ok" });
  mockGetSkillContent.mockResolvedValue("# A skill");
});

afterEach(() => {
  vi.restoreAllMocks();
});

const EMPTY_CONTEXT = { context: {} } as any;

describe("execute_skill_script gate", () => {
  it("refuses to run when skillExecutionEnabled is unset (default off)", async () => {
    const result = (await executeSkillScriptTool.invoke(
      EMPTY_CONTEXT,
      JSON.stringify({
        skillName: "demo",
        scriptPath: "scripts/run.js",
        args: null,
      }),
    )) as any;

    expect(result).toMatchObject({ success: false });
    expect(result.error).toMatch(/disabled/i);
    expect(mockExecuteSkillScript).not.toHaveBeenCalled();
    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it("refuses to run when skillExecutionEnabled is explicitly false", async () => {
    storageStore.aipex_settings = { skillExecutionEnabled: false };

    const result = (await executeSkillScriptTool.invoke(
      EMPTY_CONTEXT,
      JSON.stringify({
        skillName: "demo",
        scriptPath: "scripts/run.js",
        args: null,
      }),
    )) as any;

    expect(result).toMatchObject({ success: false });
    expect(mockExecuteSkillScript).not.toHaveBeenCalled();
  });

  it("does not run the script when the user denies it", async () => {
    storageStore.aipex_settings = { skillExecutionEnabled: true };
    const { requests, stop } = answerApprovals({ approved: false });

    const result = (await executeSkillScriptTool.invoke(
      EMPTY_CONTEXT,
      JSON.stringify({
        skillName: "demo",
        scriptPath: "scripts/run.js",
        args: null,
      }),
    )) as any;
    stop();

    expect(requests[0]?.summary).toMatch(/scripts\/run\.js.*"demo"/);
    expect(result).toMatchObject({ status: "denied", reason: "user_denied" });
    expect(mockExecuteSkillScript).not.toHaveBeenCalled();
  });

  it("runs the script once the user allows it", async () => {
    storageStore.aipex_settings = { skillExecutionEnabled: true };
    const { stop } = answerApprovals({ approved: true });

    const result = (await executeSkillScriptTool.invoke(
      EMPTY_CONTEXT,
      JSON.stringify({
        skillName: "demo",
        scriptPath: "scripts/run.js",
        args: null,
      }),
    )) as any;
    stop();

    expect(result).toMatchObject({ success: true, result: { output: "ok" } });
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockExecuteSkillScript).toHaveBeenCalledWith(
      "demo",
      "scripts/run.js",
      null,
    );
  });

  it("does not gate read-only skill tools like load_skill", async () => {
    // No settings stored at all — load_skill must still work, since it
    // only reads SKILL.md and never executes code.
    const result = (await loadSkillTool.invoke(
      EMPTY_CONTEXT,
      JSON.stringify({ name: "demo" }),
    )) as any;

    expect(result).toMatchObject({ success: true, content: "# A skill" });
    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });
});
