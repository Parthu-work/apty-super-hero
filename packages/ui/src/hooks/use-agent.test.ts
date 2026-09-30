/**
 * `useAgent`'s catch block used to log every model-factory failure via
 * `console.error`, including the completely expected "not configured" state
 * on a fresh install (no provider set up yet) — which fails a "zero console
 * errors" CI/screenshot-regression gate for what is just the normal
 * first-run screen. Only a genuinely unexpected failure should still log.
 */

import type { SessionStorageAdapter } from "@apty/agent-core";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgent } from "./use-agent";

function createFakeSessionStorage(): SessionStorageAdapter {
  return {
    save: vi.fn(async () => {}),
    load: vi.fn(async () => null),
    delete: vi.fn(async () => {}),
    listAll: vi.fn(async () => []),
    query: vi.fn(async () => []),
  } as unknown as SessionStorageAdapter;
}

describe("useAgent", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not log a console.error for a 'not configured' model-factory failure", async () => {
    const modelFactory = vi.fn(() => {
      throw new Error(
        "AI provider is not configured. Set an API key and model in Settings.",
      );
    });

    const { result } = renderHook(() =>
      useAgent({
        settings: {},
        isLoading: false,
        modelFactory,
        storage: createFakeSessionStorage(),
      }),
    );

    await waitFor(() => {
      expect(result.current.error).toBeDefined();
    });

    expect(result.current.agent).toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("still logs a console.error for a genuinely unexpected model-factory failure", async () => {
    const modelFactory = vi.fn(() => {
      throw new Error("network timeout while fetching model list");
    });

    const { result } = renderHook(() =>
      useAgent({
        settings: {},
        isLoading: false,
        modelFactory,
        storage: createFakeSessionStorage(),
      }),
    );

    await waitFor(() => {
      expect(result.current.error).toBeDefined();
    });

    expect(console.error).toHaveBeenCalledWith(
      "Failed to create agent:",
      expect.any(Error),
    );
  });
});
