import { describe, expect, it, vi } from "vitest";
import { type PreflightDeps, preflightJson, runPreflight } from "./preflight";

const AGENT_ID = "bpiondflhhdplemamgggcdajclmoeple";
const CLIENT_ID = "abcdefghijklmnopabcdefghijklmnop";

function deps(overrides: Partial<PreflightDeps> = {}): PreflightDeps {
  return {
    loadSettings: async () => ({
      aiProvider: "openai",
      aiToken: "sk-test",
      aiModel: "model-x",
      redactionMode: "strict",
      networkBodyCaptureDenyList: ["/users/"],
    }),
    testConnection: async () => ({ latencyMs: 120, toolCalling: "yes" }),
    clientId: async () => CLIENT_ID,
    clientInstalled: async () => true,
    clientStatus: async () => ({ status: "ok", running: true }),
    clientResources: async () => ({ ok: true, count: 3 }),
    agentId: () => AGENT_ID,
    pageTab: async () => ({
      id: 7,
      url: "https://app.example.com/orders?id=4",
    }),
    frames: async () => [
      {
        frameId: 0,
        url: "https://app.example.com/",
        answered: true,
        bridgeSeen: true,
      },
      {
        frameId: 3,
        url: "https://cdn.example.net/x",
        answered: true,
        bridgeSeen: true,
      },
    ],
    bridgeRegistered: async () => true,
    bridgeAllowedOn: () => true,
    clipboardPermission: async () => "granted",
    contentScriptStorage: async () => "blocked",
    ...overrides,
  };
}

async function check(id: string, overrides: Partial<PreflightDeps> = {}) {
  const checks = await runPreflight(deps(overrides));
  const found = checks.find((c) => c.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
}

describe("runPreflight", () => {
  it("passes everything when every dependency is healthy", async () => {
    const checks = await runPreflight(deps());
    expect(checks.map((c) => [c.id, c.status])).toEqual([
      ["ai-provider", "pass"],
      ["apty-client", "pass"],
      ["agent-id", "pass"],
      ["bound-tab", "pass"],
      ["console-bridge", "pass"],
      ["clipboard", "pass"],
      ["storage-access", "pass"],
      ["data-handling", "pass"],
    ]);
    expect(checks[0]?.detail).toBe(
      "model-x answered in 120 ms and calls tools.",
    );
    expect(checks[2]?.fix).toBe(AGENT_ID);
  });

  it("fails without an API key, before calling the provider", async () => {
    const testConnection = vi.fn();
    const result = await check("ai-provider", {
      loadSettings: async () => ({ aiModel: "m" }),
      testConnection,
    });
    expect(result).toMatchObject({ status: "fail", section: "ai-provider" });
    expect(result.fix).toMatch(/enter the API key and a model/);
    expect(testConnection).not.toHaveBeenCalled();
  });

  it.each([
    ["no", "fail", /supports function \(tool\) calling/],
    ["unknown", "warn", /Run Test Connection/],
  ] as const)("reports tool calling %s as %s", async (toolCalling, status, fix) => {
    const result = await check("ai-provider", {
      testConnection: async () => ({ latencyMs: 5, toolCalling }),
    });
    expect(result.status).toBe(status);
    expect(result.fix).toMatch(fix);
  });

  it("names a provider that does not answer", async () => {
    const result = await check("ai-provider", {
      testConnection: async () => {
        throw new Error("401: Incorrect API key provided");
      },
    });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("401: Incorrect API key provided");
  });

  it.each([
    [
      "no_receiver",
      new RegExp(`Add "${AGENT_ID}" to externally_connectable.ids`),
    ],
    ["no_response", /Install the Agent bridge module/],
    ["timeout", /never answered/],
  ] as const)("gives the specific fix for a Client failure: %s", async (peerFailure, fix) => {
    const result = await check("apty-client", {
      clientStatus: async () => ({
        status: "unavailable",
        peerFailure,
        error: "Chrome said no.",
      }),
    });
    expect(result).toMatchObject({ status: "fail", detail: "Chrome said no." });
    expect(result.fix).toMatch(fix);
  });

  it("fails without a Client ID and with an uninstalled Client", async () => {
    expect(
      (await check("apty-client", { clientId: async () => undefined })).fix,
    ).toMatch(/click Detect/);
    const missing = await check("apty-client", {
      clientInstalled: async () => false,
    });
    expect(missing.detail).toBe(
      `No enabled extension has the ID ${CLIENT_ID}.`,
    );
  });

  it("warns when the Client answers but cannot list requests", async () => {
    expect(
      (
        await check("apty-client", {
          clientResources: async () => ({ ok: false, count: 0 }),
        })
      ).status,
    ).toBe("warn");
  });

  it("fails without an open web page, and skips the per-frame checks", async () => {
    const frames = vi.fn();
    const checks = await runPreflight(
      deps({ pageTab: async () => null, frames }),
    );
    expect(checks.find((c) => c.id === "bound-tab")).toMatchObject({
      status: "fail",
      detail: "No web page is open.",
    });
    expect(checks.find((c) => c.id === "storage-access")?.status).toBe("warn");
    expect(frames).not.toHaveBeenCalled();
  });

  it("names the frames that do not answer or lack the page script", async () => {
    const overrides: Partial<PreflightDeps> = {
      frames: async () => [
        {
          frameId: 0,
          url: "https://app.example.com/",
          answered: true,
          bridgeSeen: true,
        },
        {
          frameId: 4,
          url: "https://pay.example.org/f",
          answered: false,
          bridgeSeen: false,
        },
      ],
    };
    expect(await check("bound-tab", overrides)).toMatchObject({
      status: "warn",
      detail:
        "app.example.com: 1 of 2 frame(s) answer; not answering: frame 4 (pay.example.org).",
    });
    expect((await check("console-bridge", overrides)).detail).toBe(
      "Running in 1 of 2 frame(s); missing in frame 4 (pay.example.org).",
    );
  });

  it("explains a page script that is off, unregistered or excluded", async () => {
    expect(
      (
        await check("console-bridge", {
          loadSettings: async () => ({ pageHooksEnabled: false }),
        })
      ).status,
    ).toBe("warn");
    expect(
      (await check("console-bridge", { bridgeRegistered: async () => false }))
        .status,
    ).toBe("fail");
    expect(
      (await check("console-bridge", { bridgeAllowedOn: () => false })).fix,
    ).toMatch(/Remove app.example.com/);
  });

  it("fails when a content script can read the extension's storage", async () => {
    expect(
      await check("storage-access", {
        contentScriptStorage: async () => "readable",
      }),
    ).toMatchObject({ status: "fail" });
  });

  it("maps clipboard permission states", async () => {
    expect(
      (await check("clipboard", { clipboardPermission: async () => "prompt" }))
        .status,
    ).toBe("warn");
    expect(
      (await check("clipboard", { clipboardPermission: async () => "denied" }))
        .status,
    ).toBe("fail");
  });

  it("warns when redaction is off and describes data handling", async () => {
    const result = await check("data-handling", {
      loadSettings: async () => ({
        redactionMode: "off",
        networkBodyCaptureEnabled: true,
      }),
    });
    expect(result).toMatchObject({
      status: "warn",
      detail:
        "Response bodies: captured · deny list: 0 entries · redaction: off.",
    });
  });
});

describe("preflightJson", () => {
  describe("files the visibility checks read (C5)", () => {
    const CONTENT = "https://client.apty.example/tenant-1/app-2/env-3";
    const resources = async () => ({
      ok: true,
      count: 4,
      urls: [
        `${CONTENT}/workflow.json?timestamp=1`,
        `${CONTENT}/segment.json?timestamp=1`,
        "https://client.apty.example/tenant-1/app-urls.json",
        "https://cdn.example.net/theme.css",
      ],
    });
    const withDenyList = (networkBodyCaptureDenyList: string[]) => ({
      clientResources: resources,
      loadSettings: async () => ({
        aiProvider: "openai" as const,
        aiToken: "sk-test",
        aiModel: "model-x",
        networkBodyCaptureDenyList,
      }),
    });

    it("names a host entry that hides every content file", async () => {
      const result = await check(
        "check-files",
        withDenyList(["apty.example", "/users/"]),
      );

      expect(result).toMatchObject({
        status: "warn",
        section: "data-handling",
        detail:
          "The body deny list entry “apty.example” hides app-urls.json, segment.json, workflow.json, so the visibility checks cannot read them.",
        fix: "In Settings → Data handling, remove “apty.example” from the body deny list, or narrow it to the paths you mean.",
      });
    });

    it("passes when no entry covers a content file", async () => {
      const result = await check(
        "check-files",
        withDenyList(["/users/", "theme.css"]),
      );

      expect(result.status).toBe("pass");
    });

    it("is left out when the Client gave no list of calls", async () => {
      const checks = await runPreflight(
        deps({
          clientResources: async () => ({ ok: false, count: 0 }),
        }),
      );

      expect(checks.some((c) => c.id === "check-files")).toBe(false);
    });
  });

  it("redacts every free-text field and keeps ids and statuses", async () => {
    const checks = await runPreflight(deps());
    const json = JSON.parse(
      preflightJson(
        checks,
        (text) => text.replaceAll("example.com", "<host>"),
        new Date(0),
      ),
    );
    expect(json.schema).toBe("apty-preflight/1");
    expect(json.generatedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(JSON.stringify(json)).not.toContain("example.com");
    expect(json.checks[0]).toMatchObject({ id: "ai-provider", status: "pass" });
  });
});
