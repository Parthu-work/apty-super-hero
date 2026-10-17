import { beforeEach, describe, expect, it, vi } from "vitest";

const zenfs = vi.hoisted(() => ({
  writeFile: vi.fn(async () => undefined),
  writeFileSync: vi.fn(),
  mkdir: vi.fn(async () => undefined),
  mkdirSync: vi.fn(),
}));

vi.mock("./zenfs-manager", () => ({ zenfs }));

const download = vi.hoisted(() => vi.fn(async () => 1));
vi.stubGlobal("chrome", { downloads: { download } });

import { createSkillAPIBridge } from "./skill-api";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("skill scripts cannot write scripts", () => {
  const api = () => createSkillAPIBridge({ skillId: "skill-creator" });

  it.each([
    "/skills/new-skill/scripts/run.js",
    "/skills/new-skill/scripts",
    "/skills/new-skill/./scripts/run.js",
    "/skills/other/../new-skill/scripts/run.js",
    "//skills//new-skill//scripts//run.js",
  ])("refuses to write %s", async (path) => {
    await expect(api().fs.writeFile(path, "x")).rejects.toThrow(/scripts/);
    expect(() => api().fs.writeFileSync(path, "x")).toThrow(/scripts/);
    await expect(api().fs.mkdir(path, { recursive: true })).rejects.toThrow(
      /scripts/,
    );
    expect(() => api().fs.mkdirSync(path)).toThrow(/scripts/);
    expect(zenfs.writeFile).not.toHaveBeenCalled();
    expect(zenfs.writeFileSync).not.toHaveBeenCalled();
    expect(zenfs.mkdir).not.toHaveBeenCalled();
    expect(zenfs.mkdirSync).not.toHaveBeenCalled();
  });

  it.each([
    "/skills/new-skill/SKILL.md",
    "/skills/new-skill/references/scripts-guide.md",
    "/skills/new-skill/assets/scripts.txt",
  ])("still writes %s", async (path) => {
    await api().fs.writeFile(path, "x");
    expect(zenfs.writeFile).toHaveBeenCalledWith(path, "x");
  });
});

describe("downloadFile", () => {
  it("always shows the save dialog, even when a script asks not to", async () => {
    await createSkillAPIBridge({ skillId: "s" }).downloadFile("aGk=", {
      filename: "out.txt",
      encoding: "base64",
      saveAs: false,
    });
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({ saveAs: true }),
    );
  });
});
