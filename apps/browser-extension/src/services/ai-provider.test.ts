import { AI_PROVIDERS } from "@apty/agent-core";
import { describe, expect, it, vi } from "vitest";
import {
  anthropicBaseUrl,
  anthropicHeaders,
  createAIProvider,
  describeConnectionTestError,
} from "./ai-provider";

// Provide minimal mock for import.meta.env
vi.stubGlobal("import", { meta: { env: { PROD: false } } });

describe("createAIProvider", () => {
  describe("URL validation", () => {
    it("accepts valid https URLs", () => {
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
          aiHost: "https://api.openai.com/v1",
        }),
      ).not.toThrow();
    });

    it("accepts undefined aiHost", () => {
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
        }),
      ).not.toThrow();
    });

    it("accepts empty string aiHost", () => {
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
          aiHost: "",
        }),
      ).not.toThrow();
    });

    it("rejects invalid URLs", () => {
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
          aiHost: "not-a-url",
        }),
      ).toThrow("Invalid aiHost URL");
    });

    it("rejects non-http protocols", () => {
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
          aiHost: "ftp://evil.com",
        }),
      ).toThrow("Unsupported protocol");
    });

    it("rejects javascript: protocol", () => {
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
          // eslint-disable-next-line no-script-url
          aiHost: "javascript:alert(1)",
        }),
      ).toThrow("Unsupported protocol");
    });

    it("allows http on loopback hosts (local model servers)", () => {
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
          aiHost: "http://localhost:11434/v1",
        }),
      ).not.toThrow();
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
          aiHost: "http://127.0.0.1:11434/v1",
        }),
      ).not.toThrow();
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
          aiHost: "http://[::1]:11434/v1",
        }),
      ).not.toThrow();
    });

    it("always blocks cloud metadata hosts, regardless of mode", () => {
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
          aiHost: "http://169.254.169.254/latest/meta-data",
        }),
      ).toThrow("restricted address");
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
          aiHost: "https://metadata.google.internal/",
        }),
      ).toThrow("restricted address");
    });

    it("blocks broader private ranges even outside of PROD", () => {
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
          aiHost: "https://10.0.0.5/v1",
        }),
      ).toThrow("restricted address");
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
          aiHost: "https://192.168.1.50/v1",
        }),
      ).toThrow("restricted address");
    });

    it("rejects http for non-loopback hosts", () => {
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
          aiHost: "http://api.openai.com/v1",
        }),
      ).toThrow("Unsupported protocol");
    });

    it("normalizes an obfuscated decimal IP literal and allows it as loopback", () => {
      // 2130706433 === 127.0.0.1
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
          aiHost: "http://2130706433/v1",
        }),
      ).not.toThrow();
    });

    it("normalizes an obfuscated hex/octet-form private IP and still blocks it", () => {
      // 0x0a.0.0.1 === 10.0.0.1 (private, non-loopback)
      expect(() =>
        createAIProvider({
          aiProvider: "openai",
          aiToken: "sk-test",
          aiHost: "https://0x0a.0.0.1/v1",
        }),
      ).toThrow("restricted address");
    });
  });

  describe("provider creation", () => {
    it("creates openai provider by default", () => {
      const provider = createAIProvider({
        aiProvider: "openai",
        aiToken: "sk-test",
      });
      expect(provider).toBeDefined();
    });

    it("creates anthropic provider", () => {
      const provider = createAIProvider({
        aiProvider: "anthropic",
        aiToken: "sk-test",
      });
      expect(provider).toBeDefined();
    });

    it("creates google provider", () => {
      const provider = createAIProvider({
        aiProvider: "google",
        aiToken: "sk-test",
      });
      expect(provider).toBeDefined();
    });

    it("requires baseURL for custom providers", () => {
      expect(() =>
        createAIProvider({
          aiProvider: "custom" as any,
          aiToken: "sk-test",
        }),
      ).toThrow("requires aiHost");
    });

    it("creates custom provider with valid baseURL", () => {
      const provider = createAIProvider({
        aiProvider: "custom" as any,
        aiToken: "sk-test",
        aiHost: "https://my-proxy.example.com",
      });
      expect(provider).toBeDefined();
    });

    it("creates a Groq provider through the OpenAI-compatible path (provider-agnostic, no Groq-specific branch)", () => {
      // aiProvider "groq" isn't one of the explicitly-cased providers
      // (anthropic/google/openai) in createAIProvider's switch, so this
      // exercises the generic OpenAI-compatible fallback branch — the same
      // code path any other OpenAI-compatible provider goes through.
      const provider = createAIProvider({
        aiProvider: "groq" as any,
        aiToken: "gsk-test",
        aiHost: "https://api.groq.com/openai/v1",
      });
      expect(provider).toBeDefined();
    });
  });
});

describe("Groq provider configuration", () => {
  it("does not list the decommissioned mixtral-8x7b-32768 model", () => {
    expect(AI_PROVIDERS.groq.models).not.toContain("mixtral-8x7b-32768");
  });

  it("suggests no Groq model id it cannot verify, so no stale id becomes the default", () => {
    // settings/index.tsx picks provider.models[0] as a new config's model.
    // Groq's catalogue changes often; "Fetch models" reads the live list.
    expect(AI_PROVIDERS.groq.models).toEqual([]);
  });

  it("points at Groq's OpenAI-compatible endpoint", () => {
    expect(AI_PROVIDERS.groq.host).toBe("https://api.groq.com/openai/v1");
    expect(AI_PROVIDERS.groq.providerType).toBe("openai");
  });
});

describe("anthropicHeaders", () => {
  it("always allows direct browser access, and adds a trimmed workspace ID when set", () => {
    expect(anthropicHeaders(" wrkspc_01Test ")).toEqual({
      "anthropic-dangerous-direct-browser-access": "true",
      "anthropic-workspace-id": "wrkspc_01Test",
    });
    expect(anthropicHeaders("  ")).toEqual({
      "anthropic-dangerous-direct-browser-access": "true",
    });
    expect(anthropicHeaders(undefined)).toEqual({
      "anthropic-dangerous-direct-browser-access": "true",
    });
  });
});

describe("describeConnectionTestError", () => {
  it("says where to enter the workspace ID when Anthropic asks for one", () => {
    const error = Object.assign(
      new Error(
        "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use.",
      ),
      { statusCode: 400 },
    );
    expect(describeConnectionTestError(error)).toMatch(
      /^400: This API key is not scoped .* Fix: enter the workspace ID \(wrkspc_…, from Claude Console → Settings → Workspaces\) in Settings → AI Configuration → Workspace ID, or use an API key created for a single workspace\.$/,
    );
  });

  it("prefixes the message with the status code when present", () => {
    const error = Object.assign(new Error("Model not found"), {
      statusCode: 404,
    });
    expect(describeConnectionTestError(error)).toBe("404: Model not found");
  });

  it("falls back to the plain message when there is no status code", () => {
    expect(describeConnectionTestError(new Error("network error"))).toBe(
      "network error",
    );
  });

  it("redacts an Authorization header if one ever ends up in an error message", () => {
    const message = describeConnectionTestError(
      new Error("failed: Authorization: Bearer sk-abcdef1234567890"),
    );
    expect(message).not.toContain("sk-abcdef1234567890");
    expect(message).toContain("[REDACTED]");
  });

  it("redacts a provider API key pattern embedded in an error message", () => {
    const message = describeConnectionTestError(
      new Error("invalid key gsk_abcdefghijklmnopqrstuvwx"),
    );
    expect(message).not.toContain("gsk_abcdefghijklmnopqrstuvwx");
  });

  it("truncates very long messages", () => {
    const message = describeConnectionTestError(new Error("x".repeat(1000)));
    expect(message.length).toBeLessThanOrEqual(304);
  });

  it("handles a non-Error thrown value", () => {
    expect(describeConnectionTestError("plain string failure")).toBe(
      "plain string failure",
    );
  });
});

describe("anthropicBaseUrl", () => {
  it("adds /v1 to a bare Anthropic origin and leaves a path alone", () => {
    expect(anthropicBaseUrl("https://api.anthropic.com")).toBe(
      "https://api.anthropic.com/v1",
    );
    expect(anthropicBaseUrl("https://api.anthropic.com/v1")).toBe(
      "https://api.anthropic.com/v1",
    );
    expect(anthropicBaseUrl("https://proxy.example.com/anthropic")).toBe(
      "https://proxy.example.com/anthropic",
    );
    expect(anthropicBaseUrl(undefined)).toBeUndefined();
  });
});
