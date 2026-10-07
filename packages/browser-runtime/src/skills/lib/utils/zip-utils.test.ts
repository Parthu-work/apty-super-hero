import { strToU8, zipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockMkdir = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockExists = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const mockInitialize = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../../../vm/zenfs-manager", () => ({
  zenfs: {
    initialize: mockInitialize,
    exists: mockExists,
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
  },
}));

import {
  extractZipToFS,
  parseSkillMetadata,
  parseSkillMetadataFromZip,
  SkillConflictError,
  SkillZipTooLargeError,
  SkillZipTooManyEntriesError,
  SkillZipUnsafePathError,
} from "./zip-utils";

function zipBlob(files: Record<string, Uint8Array>): Blob {
  const zipped = zipSync(files);
  return new Blob([zipped]);
}

const SKILL_MD = strToU8(
  "---\nname: demo-skill\ndescription: A demo skill\nversion: 1.0.0\n---\n\nBody.",
);

beforeEach(() => {
  vi.clearAllMocks();
  mockExists.mockResolvedValue(false);
});

describe("parseSkillMetadata", () => {
  it("extracts name/description/version from YAML frontmatter", () => {
    const meta = parseSkillMetadata(
      "---\nname: foo\ndescription: bar\nversion: 2.0.0\n---\nbody",
    );
    expect(meta).toEqual({ name: "foo", description: "bar", version: "2.0.0" });
  });

  it("throws when frontmatter is missing", () => {
    expect(() => parseSkillMetadata("no frontmatter here")).toThrow(
      /no yaml frontmatter/i,
    );
  });
});

describe("parseSkillMetadataFromZip / extractZipToFS — caps (M4)", () => {
  it("accepts a well-formed small skill zip", async () => {
    const blob = zipBlob({
      "SKILL.md": SKILL_MD,
      "scripts/run.js": strToU8("console.log('hi')"),
    });

    const meta = await parseSkillMetadataFromZip(blob);
    expect(meta.name).toBe("demo-skill");

    await expect(
      extractZipToFS(blob, "/skills/demo-skill"),
    ).resolves.toBeUndefined();
    expect(mockWriteFile).toHaveBeenCalled();
  });

  it("rejects a conflicting skill path before ever unzipping", async () => {
    mockExists.mockResolvedValueOnce(true);
    const blob = zipBlob({ "SKILL.md": SKILL_MD });

    await expect(extractZipToFS(blob, "/skills/demo-skill")).rejects.toThrow(
      SkillConflictError,
    );
  });

  it("rejects a path-traversal entry instead of writing outside the target directory", async () => {
    const blob = zipBlob({
      "SKILL.md": SKILL_MD,
      "../../../escape.txt": strToU8("pwned"),
    });

    await expect(extractZipToFS(blob, "/skills/demo-skill")).rejects.toThrow(
      SkillZipUnsafePathError,
    );
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("rejects a zip with more than the max entry count", async () => {
    const files: Record<string, Uint8Array> = { "SKILL.md": SKILL_MD };
    for (let i = 0; i < 2100; i++) {
      files[`assets/file-${i}.txt`] = strToU8("x");
    }
    const blob = zipBlob(files);

    await expect(extractZipToFS(blob, "/skills/demo-skill")).rejects.toThrow(
      SkillZipTooManyEntriesError,
    );
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("rejects a single entry larger than the per-file cap (zip-bomb guard)", async () => {
    const huge = new Uint8Array(21 * 1024 * 1024); // 21 MB, all zeros (compresses tiny)
    const blob = zipBlob({
      "SKILL.md": SKILL_MD,
      "assets/huge.bin": huge,
    });

    await expect(extractZipToFS(blob, "/skills/demo-skill")).rejects.toThrow(
      SkillZipTooLargeError,
    );
    expect(mockWriteFile).not.toHaveBeenCalled();
  }, 20_000);

  it("rejects when cumulative uncompressed size exceeds the total cap, even with no single oversized file", async () => {
    // 3 files at 18 MB each = 54 MB total, each individually under the
    // 20 MB per-file cap — only the running total should trip this.
    const chunk = new Uint8Array(18 * 1024 * 1024);
    const blob = zipBlob({
      "SKILL.md": SKILL_MD,
      "assets/a.bin": chunk,
      "assets/b.bin": chunk,
      "assets/c.bin": chunk,
    });

    await expect(extractZipToFS(blob, "/skills/demo-skill")).rejects.toThrow(
      SkillZipTooLargeError,
    );
    expect(mockWriteFile).not.toHaveBeenCalled();
  }, 20_000);
});
