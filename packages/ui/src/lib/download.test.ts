import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadText,
  sanitizeFilename,
  timestampedFilename,
} from "./download";

describe("sanitizeFilename", () => {
  it("strips path separators and control characters", () => {
    expect(sanitizeFilename('a/b\\c?d%e*f:g|h"i<j>k')).not.toMatch(
      /[/\\?%*:|"<>]/,
    );
  });

  it("falls back to a default name for an empty/whitespace-only input", () => {
    expect(sanitizeFilename("   ")).toBe("download");
  });
});

describe("timestampedFilename", () => {
  it("produces a distinct, sanitized name each call", () => {
    const a = timestampedFilename("message", "md");
    expect(a).toMatch(/^message-.*\.md$/);
    expect(a).not.toMatch(/[/\\?%*:|"<>]/);
  });
});

describe("downloadText", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("creates a Blob URL, clicks a synthetic anchor, and revokes the URL", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    const revokeObjectURL = vi.fn();
    (global as any).URL.createObjectURL = createObjectURL;
    (global as any).URL.revokeObjectURL = revokeObjectURL;

    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "a") el.click = clickSpy;
      return el;
    });

    const result = downloadText("report.json", '{"a":1}', "application/json");

    expect(result).toBe(true);
    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("falls back to chrome.downloads.download when the DOM anchor path throws", () => {
    vi.spyOn(document, "createElement").mockImplementation(() => {
      throw new Error("no DOM");
    });
    const download = vi.fn();
    (global as any).chrome = { downloads: { download } };

    const result = downloadText("report.txt", "hello");

    expect(result).toBe(true);
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "report.txt" }),
    );
  });

  it("never throws even if every download path is unavailable", () => {
    vi.spyOn(document, "createElement").mockImplementation(() => {
      throw new Error("no DOM");
    });
    (global as any).chrome = undefined;

    expect(() => downloadText("report.txt", "hello")).not.toThrow();
    expect(downloadText("report.txt", "hello")).toBe(false);
  });
});
