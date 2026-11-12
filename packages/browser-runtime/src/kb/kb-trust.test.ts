/**
 * KB-RAG K23 P4: a pack is used only when it is signed by a trusted key and
 * within its dates, judged at import and again at every use. Keys are made
 * in the test; WebCrypto (Node's) checks what node:crypto signed.
 */
import type { OrgPolicy, OrgPolicyState } from "@apty/agent-core";
import { describe, expect, it } from "vitest";
import { createKbPackStore } from "../storage/kb-store.js";
import { createKbIndexSource, kbToolResult } from "./kb-index.js";
import { localKbMatches } from "./kb-matches.js";
import {
  fixtureV2PackText,
  memoryRecords,
  signedPackText,
  testSigningKey,
  unsignedAllowed,
} from "./kb-test-utils.js";
import { createKbPackAssessor, webCryptoSignature } from "./kb-trust.js";

const owner = testSigningKey("FIXTURE KB owner");
const NOW = new Date("2026-11-12T00:00:00.000Z");

/** A store whose trust is the policy `policy()` returns now, with the test key trusted through it. */
function storeWith(policy: () => OrgPolicy, now = () => NOW) {
  const assess = createKbPackAssessor({
    policy: async (): Promise<OrgPolicyState> => ({
      kind: "active",
      policy: policy(),
    }),
    now,
  });
  const store = createKbPackStore({ records: memoryRecords(), assess });
  return { store, source: createKbIndexSource(store) };
}

const trusting = (extra: OrgPolicy = {}): OrgPolicy => ({
  trustedPackKeys: [owner.key],
  ...extra,
});

describe("WebCrypto checks a node:crypto signature", () => {
  it("verifies the signature over the pack's checksum, and refuses one changed byte", async () => {
    const pack = JSON.parse(signedPackText(owner));
    const message = new TextEncoder().encode(
      `apty-kb-pack-signature/1\n${pack.sha256}\n${owner.key.keyId}`,
    );
    expect(
      await webCryptoSignature.verify(
        owner.key.spki,
        message,
        pack.signature.value,
      ),
    ).toBe(true);
    message[message.length - 1] ^= 1;
    expect(
      await webCryptoSignature.verify(
        owner.key.spki,
        message,
        pack.signature.value,
      ),
    ).toBe(false);
  });
});

describe("import (K23 P4)", () => {
  it("a pack signed by a trusted key imports and answers", async () => {
    const { store, source } = storeWith(trusting);
    expect(await store.replace(signedPackText(owner))).toMatchObject({
      ok: true,
      info: {
        signature: { keyId: owner.key.keyId },
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    });
    const result = kbToolResult(
      await source.current("5.x"),
      "the tooltip opens twice",
    );
    expect(result.status).toBe("ok");
  });

  it.each([
    ["unsigned", () => signedPackText(null), "unsigned"],
    ["an unknown key", () => signedPackText(testSigningKey()), "untrusted_key"],
    [
      "an expired pack",
      () => signedPackText(owner, { expiresAt: "2026-11-01T00:00:00.000Z" }),
      "expired",
    ],
    [
      "a pack built more than a day in the future",
      () => signedPackText(owner, { builtAt: "2026-11-14T00:00:00.000Z" }),
      "not_yet_valid",
    ],
  ])("refuses %s, and keeps the loaded pack", async (_label, text, code) => {
    const { store } = storeWith(trusting);
    await store.replace(signedPackText(owner));
    expect(await store.replace(text())).toMatchObject({ ok: false, code });
    expect((await store.info())[0]?.signature?.keyId).toBe(owner.key.keyId);
  });

  it("refuses a pack signed by a key the policy revokes", async () => {
    const { store } = storeWith(() =>
      trusting({ revokedPackKeyIds: [owner.key.keyId] }),
    );
    expect(await store.replace(signedPackText(owner))).toEqual({
      ok: false,
      code: "revoked_key",
    });
  });

  it("refuses a pack whose card text changed after signing, even with its checksum recomputed", async () => {
    const { store } = storeWith(trusting);
    const pack = JSON.parse(signedPackText(owner));
    pack.chunks[0].text = "- FIXTURE edited after signing.";
    const { sha256: _old, signature, ...rest } = pack;
    const { canonicalJson } = await import("@apty/agent-core");
    const { createHash } = await import("node:crypto");
    const resummed = {
      ...rest,
      sha256: createHash("sha256").update(canonicalJson(rest)).digest("hex"),
      signature,
    };
    expect(await store.replace(JSON.stringify(resummed))).toEqual({
      ok: false,
      code: "bad_signature",
    });
  });

  it("an unsigned schema 2 pack is used only under allowUnsignedPacks", async () => {
    const strict = storeWith(() => ({}));
    expect(await strict.store.replace(fixtureV2PackText())).toEqual({
      ok: false,
      code: "unsigned",
    });
    const transition = createKbPackStore({
      records: memoryRecords(),
      assess: unsignedAllowed,
    });
    expect((await transition.replace(fixtureV2PackText())).ok).toBe(true);
  });
});

describe("at every use, with no re-import (K23 P4, acceptance 3, 6, 10)", () => {
  it("revoking the loaded pack's key stops it at the next search, and the KB says why", async () => {
    let policy = trusting();
    const { store, source } = storeWith(() => policy);
    await store.replace(signedPackText(owner));
    expect(await source.current("5.x")).not.toBeNull();

    policy = trusting({ revokedPackKeyIds: [owner.key.keyId] });
    expect(await source.current("5.x")).toBeNull();
    expect(
      await localKbMatches("the tooltip opens twice", source, {
        version: "5.x",
      }),
    ).toEqual({
      kind: "pack_unusable",
      reason: "revoked",
      version: "5.x",
      date: "2099-01-01T00:00:00.000Z",
    });
  });

  it("a pack that expires stops answering, as pack_unusable with expired, from search_kb's result and the KB matches", async () => {
    let now = NOW;
    const { store, source } = storeWith(trusting, () => now);
    await store.replace(
      signedPackText(owner, { expiresAt: "2026-12-01T00:00:00.000Z" }),
    );
    expect(await source.current("5.x")).not.toBeNull();
    now = new Date("2026-12-02T00:00:00.000Z");
    expect(await source.current("5.x")).toBeNull();
    const [blocked] = (await source.unusable?.("5.x")) ?? [];
    expect(blocked?.usability).toMatchObject({
      usable: false,
      reason: "expired",
    });
    expect(
      await localKbMatches("the tooltip opens twice", source, {
        version: "5.x",
      }),
    ).toEqual({
      kind: "pack_unusable",
      reason: "expired",
      version: "5.x",
      date: "2026-12-01T00:00:00.000Z",
    });
  });

  it("maxPackAgeDays expires a pack earlier than its expiresAt", async () => {
    const { store, source } = storeWith(() => trusting({ maxPackAgeDays: 30 }));
    await store.replace(
      signedPackText(owner, { builtAt: "2026-11-01T00:00:00.000Z" }),
    );
    expect(await source.current("5.x")).not.toBeNull();
    const later = storeWith(() => trusting({ maxPackAgeDays: 5 }));
    expect(
      await later.store.replace(
        signedPackText(owner, { builtAt: "2026-11-01T00:00:00.000Z" }),
      ),
    ).toEqual({
      ok: false,
      code: "expired",
      date: "2026-11-06T00:00:00.000Z",
    });
  });

  it("a .invalid site signed by a non-demo key is used but is not a demo pack", async () => {
    const { store } = storeWith(trusting);
    await store.replace(
      signedPackText(owner, { site: "fixture.atlassian.invalid" }),
    );
    const [state] = await store.info();
    expect(state?.usability.trust).toMatchObject({
      status: "trusted",
      demo: false,
    });
  });
});
