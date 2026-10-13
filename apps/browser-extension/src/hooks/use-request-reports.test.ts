import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
const watch = vi.hoisted(() => vi.fn());
vi.mock("@apty/browser-runtime/runtime/request-reports", () => ({
  readRequestReports: read,
  watchRequestReports: watch,
}));

import { useRequestReports } from "./use-request-reports";

describe("useRequestReports", () => {
  it("loads the stored reports, follows new ones and stops on unmount", async () => {
    const first = [{ at: 1 }];
    const next = [{ at: 2 }, { at: 1 }];
    const stop = vi.fn();
    let push: (reports: unknown[]) => void = () => {};
    read.mockResolvedValue(first);
    watch.mockImplementation((listener) => {
      push = listener;
      return stop;
    });

    const { result, unmount } = renderHook(() => useRequestReports());
    await waitFor(() => expect(result.current).toEqual(first));
    act(() => push(next));
    expect(result.current).toEqual(next);
    unmount();
    expect(stop).toHaveBeenCalled();
  });
});
