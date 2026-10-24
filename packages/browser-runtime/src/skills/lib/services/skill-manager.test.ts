import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillMetadata } from "../../skill/types.js";

const saveSkillMetadata = vi.hoisted(() => vi.fn());

vi.mock("../../../vm/zenfs-manager", () => ({
  zenfs: {
    getSkillPath: (name: string) => `/skills/${name}`,
    exists: vi.fn().mockResolvedValue(false),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
  },
}));

vi.mock("../storage/skill-storage", () => ({
  skillStorage: {
    initialize: vi.fn(),
    listSkills: vi.fn().mockResolvedValue([]),
    saveSkillMetadata,
  },
}));

vi.mock("./skill-executor", () => ({
  skillExecutor: { initialize: vi.fn() },
}));

vi.mock("./skill-registry", () => ({
  skillRegistry: { initialize: vi.fn(), getAllSkills: () => [] },
}));

import { SkillManager } from "./skill-manager";

describe("the built-in skill-creator", () => {
  beforeEach(() => {
    saveSkillMetadata.mockClear();
  });

  it("describes itself as extending the Apty Agent", async () => {
    await new SkillManager({ autoLoadEnabledSkills: false }).initialize();

    const saved = saveSkillMetadata.mock.calls
      .map(([metadata]) => metadata as SkillMetadata)
      .find((metadata) => metadata.id === "skill-creator");
    expect(saved?.description).toContain("the Apty Agent's capabilities");
    expect(saved?.description).not.toMatch(/aipex/i);
  });
});
