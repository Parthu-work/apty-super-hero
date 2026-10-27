import { describe, expect, it } from "vitest";
import {
  allowListFix,
  isValidExtensionId,
  peerExtensionId,
  peerExtensionIdPatch,
  peerFailureMessage,
} from "./peers";

const ID = "a".repeat(32);

describe("peer extension IDs", () => {
  it("keeps the Client on clientExtensionId and Studio under peers.studio", () => {
    expect(peerExtensionId({ clientExtensionId: ID }, "client")).toBe(ID);
    expect(
      peerExtensionId({ clientExtensionId: ID }, "studio"),
    ).toBeUndefined();
    expect(
      peerExtensionId({ peers: { studio: { extensionId: ID } } }, "studio"),
    ).toBe(ID);
    expect(
      peerExtensionId({ studioExtensionId: "b".repeat(32) }, "studio"),
    ).toBe("b".repeat(32));
  });

  it("writes and clears each peer without touching the other", () => {
    expect(peerExtensionIdPatch({}, "client", ID)).toEqual({
      clientExtensionId: ID,
    });
    const config = {
      clientExtensionId: "c".repeat(32),
      studioExtensionId: "old",
    };
    const saved = { ...config, ...peerExtensionIdPatch(config, "studio", ID) };
    expect(saved).toEqual({
      clientExtensionId: "c".repeat(32),
      studioExtensionId: undefined,
      peers: { studio: { extensionId: ID } },
    });
    expect(peerExtensionId(saved, "studio")).toBe(ID);
    const cleared = {
      ...saved,
      ...peerExtensionIdPatch(saved, "studio", undefined),
    };
    expect(peerExtensionId(cleared, "studio")).toBeUndefined();
    expect(peerExtensionId(cleared, "client")).toBe("c".repeat(32));
  });
});

describe("peer failure messages", () => {
  it("keeps the Client's wording and names Studio in Studio's", () => {
    expect(peerFailureMessage("client", "no_receiver")).toBe(
      "Chrome found nothing listening in the Apty Client for this extension. The Client must list this extension's ID under externally_connectable.ids in its manifest and register a chrome.runtime.onMessageExternal handler at the top level of its service worker.",
    );
    for (const failure of [
      "no_receiver",
      "no_response",
      "timeout",
      "send_failed",
    ] as const) {
      const studio = peerFailureMessage("studio", failure);
      expect(studio).toContain("Apty Studio");
      expect(studio).not.toContain("Client");
    }
  });

  it("fills this Agent's ID into the allow-list fix", () => {
    expect(allowListFix("studio", "agent-id")).toBe(
      'Apty Studio\'s manifest must list this Agent ID in externally_connectable.ids: "agent-id"',
    );
  });
});

describe("isValidExtensionId", () => {
  it("accepts a well-formed 32-char a-p extension id", () => {
    expect(isValidExtensionId("abcdefghijklmnopabcdefghijklmnop")).toBe(true);
  });

  it.each([
    "short",
    "ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP",
    "abcdefghijklmnopabcdefghijklmno1",
    "",
  ])("rejects %s", (id) => {
    expect(isValidExtensionId(id)).toBe(false);
  });
});
