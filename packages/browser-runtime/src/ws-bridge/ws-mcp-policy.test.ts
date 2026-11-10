/** KB-RAG K22 S6 (D-SEC5): the MCP bridge under the organization policy. */
import { kbSourceTag, type OrgPolicyState } from "@apty/agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../tools/index.js", () => ({ allBrowserTools: [] }));
vi.mock("../apty/evidence-store.js", () => ({
  evidenceRestored: Promise.resolve(),
}));
vi.mock("../apty/investigation-session.js", () => ({
  investigationsRestored: Promise.resolve(),
}));

import {
  resetOrgPolicyForTests,
  setOrgPolicySource,
} from "../runtime/org-policy";
import {
  MCP_BRIDGE_NOT_ALLOWED,
  resultForMcp,
  WsMcpServer,
} from "./ws-mcp-server";

const UNIQUE = "Quillfeather";
const SEARCH_KB_RESULT = {
  status: "ok",
  ...kbSourceTag([{ pageId: "101", layer: 1 }]),
  results: [{ cite: "kb://101#L1", text: `Turn on the FIXTURE ${UNIQUE}.` }],
};
const NONE: OrgPolicyState = { kind: "none" };

describe("a KB result on its way to an MCP client", () => {
  it("carries no card text by default, only the card ids", () => {
    const sent = JSON.stringify(resultForMcp(SEARCH_KB_RESULT, NONE));
    expect(sent).not.toContain(UNIQUE);
    expect(sent).toContain("KB result withheld by policy. Cards: 101.");
  });

  it("carries the card text when the policy sets kbToMcp", () => {
    const sent = JSON.stringify(
      resultForMcp(SEARCH_KB_RESULT, {
        kind: "active",
        policy: { kbToMcp: true },
      }),
    );
    expect(sent).toContain(UNIQUE);
  });

  it("is withheld under an invalid policy, and other results pass as before", () => {
    expect(
      JSON.stringify(
        resultForMcp(SEARCH_KB_RESULT, { kind: "invalid", reason: "x" }),
      ),
    ).not.toContain(UNIQUE);
    expect(resultForMcp({ title: "Orders" }, NONE)).toEqual({
      title: "Orders",
    });
  });
});

describe("allowMcpBridge: false", () => {
  const sockets = vi.fn();

  beforeEach(() => {
    sockets.mockReset();
    vi.stubGlobal("WebSocket", sockets);
    vi.stubGlobal("chrome", {
      storage: { local: { set: vi.fn(), remove: vi.fn() } },
    });
    setOrgPolicySource({
      read: async () => ({ allowMcpBridge: false }),
      watch: () => () => {},
    });
  });

  afterEach(() => {
    resetOrgPolicyForTests();
    vi.unstubAllGlobals();
  });

  it("opens no connection, and says why", async () => {
    const server = new WsMcpServer();
    await expect(
      server.connect("ws://localhost:9223/", "a".repeat(43)),
    ).rejects.toThrow(MCP_BRIDGE_NOT_ALLOWED);
    expect(sockets).not.toHaveBeenCalled();
    expect(server.getStatus()).toMatchObject({
      status: "disconnected",
      error: MCP_BRIDGE_NOT_ALLOWED,
    });
  });
});
