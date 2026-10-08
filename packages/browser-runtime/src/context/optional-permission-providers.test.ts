import { afterEach, describe, expect, it, vi } from "vitest";
import { BookmarksProvider } from "./bookmarks-provider";
import { HistoryProvider } from "./history-provider";

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  ["bookmarks", new BookmarksProvider(), "bookmark-1"],
  ["history", new HistoryProvider(), "history-1"],
])("%s provider without its optional permission", (_name, provider, id) => {
  it("returns nothing and logs no error", async () => {
    (global as any).chrome = {};
    const error = vi.spyOn(console, "error");

    expect(await provider.getContexts()).toEqual([]);
    expect(await provider.getContext(id)).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });
});
