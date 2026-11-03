/**
 * `useAgent`'s catch block used to log every model-factory failure via
 * `console.error`, including the completely expected "not configured" state
 * on a fresh install (no provider set up yet) — which fails a "zero console
 * errors" CI/screenshot-regression gate for what is just the normal
 * first-run screen. Only a genuinely unexpected failure should still log.
 */

import { AptyAgent, type SessionStorageAdapter } from "@apty/agent-core";
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

  it("treats a stored legacy 'byokEnabled:false' with a real token and model as configured (migration)", async () => {
    // Before byokEnabled was removed, a stored settings object with the
    // flag false (its default) but a real token+model already saved would
    // be treated as "not configured" until the user pressed Save again.
    // `AppSettings` no longer has this field, but a real stored object
    // from before this change still carries it — it must be ignored, not
    // required to be absent.
    const legacyStoredSettings = {
      aiToken: "sk-test",
      aiModel: "gpt-test",
      aiProvider: "openai",
      byokEnabled: false,
    } as unknown as Parameters<typeof useAgent>[0]["settings"];

    const model = { id: "fake-model" };
    const modelFactory = vi.fn(() => model);

    const { result } = renderHook(() =>
      useAgent({
        settings: legacyStoredSettings,
        isLoading: false,
        modelFactory,
        storage: createFakeSessionStorage(),
      }),
    );

    await waitFor(() => {
      expect(result.current.agent).toBeDefined();
    });

    expect(result.current.error).toBeUndefined();
    expect(modelFactory).toHaveBeenCalled();
  });

  it("still logs a console.error for a genuinely unexpected model-factory failure", async () => {
    const modelFactory = vi.fn(() => {
      throw new Error("network timeout while fetching model list");
    });

    const { result } = renderHook(() =>
      useAgent({
        settings: { aiToken: "sk-test", aiModel: "gpt-test" },
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

  it("creates an agent without a provider when answers that need no model may run, without building a provider model (8)", async () => {
    const modelFactory = vi.fn(() => ({ id: "fake-model" }));

    const { result } = renderHook(() =>
      useAgent({
        settings: {},
        isLoading: false,
        modelFactory,
        storage: createFakeSessionStorage(),
        localAnswersWithoutModel: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.agent).toBeDefined();
    });
    expect(modelFactory).not.toHaveBeenCalled();
  });

  it("builds the summary request's model from summaryModelFor, with the same provider (C6)", async () => {
    const create = vi.spyOn(AptyAgent, "create");
    const modelFactory = vi.fn((settings: { aiModel?: string }) => ({
      id: settings.aiModel,
    }));
    const compression = { summarizeAfterItems: 8 };

    const { result } = renderHook(() =>
      useAgent({
        settings: {
          aiProvider: "anthropic",
          aiToken: "sk-ant-test",
          aiModel: "claude-sonnet-5-5",
          summarizeEarlierTurns: true,
        },
        isLoading: false,
        modelFactory,
        storage: createFakeSessionStorage(),
        agentOptions: { compression },
      }),
    );

    await waitFor(() => expect(result.current.agent).toBeDefined());
    const options = create.mock.lastCall?.[0];
    expect(options?.model).toEqual({ id: "claude-sonnet-5-5" });
    expect(options?.compression).toEqual({
      ...compression,
      model: { id: "claude-haiku-5-5" },
    });
    expect(modelFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        aiProvider: "anthropic",
        aiModel: "claude-haiku-5-5",
      }),
    );
  });

  it("leaves summaries on the chat model while they are off", async () => {
    const create = vi.spyOn(AptyAgent, "create");
    const compression = { summarizeAfterItems: 8 };

    const { result } = renderHook(() =>
      useAgent({
        settings: {
          aiProvider: "anthropic",
          aiToken: "sk-ant-test",
          aiModel: "claude-sonnet-5-5",
        },
        isLoading: false,
        modelFactory: vi.fn(() => ({ id: "chat" })),
        storage: createFakeSessionStorage(),
        agentOptions: { compression },
      }),
    );

    await waitFor(() => expect(result.current.agent).toBeDefined());
    expect(create.mock.lastCall?.[0]?.compression).toBe(compression);
  });
});
