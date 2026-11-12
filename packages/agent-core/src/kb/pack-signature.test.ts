import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
  verify,
} from "node:crypto";
import { describe, expect, it } from "vitest";
import { syntheticPack } from "./kb-test-utils.js";
import { canonicalJson, type KbPack, parseKbPack } from "./pack.js";
import {
  type KbSignatureCrypto,
  kbKeyIdOf,
  kbPackUsability,
  kbPackValidity,
  kbSignedMessage,
  type TrustedPackKey,
  verifyKbPackSignature,
} from "./pack-signature.js";
import { DEMO_PACK_KEY, kbTrustPolicyOf } from "./trusted-keys.js";

const nodeCrypto: KbSignatureCrypto = {
  async verify(spki, message, signature) {
    const key = createPublicKey({
      key: Buffer.from(spki, "base64"),
      format: "der",
      type: "spki",
    });
    return verify(
      "sha256",
      message,
      { key, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64"),
    );
  },
  sha256Bytes: async (bytes) =>
    createHash("sha256").update(bytes).digest("hex"),
};
const sha256 = async (text: string) =>
  createHash("sha256").update(text).digest("hex");

function newKey(name: string): { key: TrustedPackKey; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const der = publicKey.export({ type: "spki", format: "der" });
  return {
    key: {
      keyId: createHash("sha256").update(der).digest("hex").slice(0, 16),
      spki: der.toString("base64"),
      name,
    },
    privateKey,
  };
}

/** A schema 3 pack, checksummed without its signature, then signed by `signer`. */
function signedPack(
  signer: { key: TrustedPackKey; privateKey: KeyObject } | null,
  {
    site = "synthetic.atlassian.example",
    expiresAt = "2027-01-10T00:00:00.000Z",
  } = {},
): KbPack {
  const base = syntheticPack(
    [
      {
        pageId: "101",
        title: "FIXTURE banner never glows",
        layers: [
          "- FIXTURE one.",
          "- FIXTURE two.",
          "- FIXTURE three.",
          "- FIXTURE four.",
        ],
      },
    ],
    {},
    { schemaVersion: 3, expiresAt } as Partial<KbPack>,
  );
  const { sha256: _old, ...rest } = {
    ...base,
    source: { ...base.source, site },
  };
  const checksum = createHash("sha256")
    .update(canonicalJson(rest))
    .digest("hex");
  const pack = { ...rest, sha256: checksum } as KbPack;
  if (!signer) return pack;
  const value = sign("sha256", kbSignedMessage(checksum, signer.key.keyId), {
    key: signer.privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64");
  return {
    ...pack,
    signature: { alg: "ES256", keyId: signer.key.keyId, value },
  };
}

const fields = (pack: KbPack) => ({
  sha256: pack.sha256,
  signature: pack.signature ?? null,
  site: pack.source.site,
});

describe("pack signatures (KB-RAG K23 P1, D-SEC8)", () => {
  const owner = newKey("FIXTURE KB owner");
  const trust = { trustedKeys: [owner.key], crypto: nodeCrypto };

  it("a signed pack parses, and its signature verifies against the trusted key", async () => {
    const pack = signedPack(owner);
    const parsed = await parseKbPack(JSON.stringify(pack), { sha256 });
    expect(parsed.ok).toBe(true);
    expect(await verifyKbPackSignature(fields(pack), trust)).toEqual({
      status: "trusted",
      keyId: owner.key.keyId,
      name: "FIXTURE KB owner",
      demo: false,
    });
  });

  it("the key id is the first 16 hex of the SHA-256 of the SPKI DER", async () => {
    expect(await kbKeyIdOf(owner.key.spki, nodeCrypto.sha256Bytes)).toBe(
      owner.key.keyId,
    );
  });

  it("changing one character of a card, of expiresAt or of source.site fails the checksum or the signature", async () => {
    const pack = signedPack(owner);
    const card = structuredClone(pack);
    card.chunks[0] = { ...card.chunks[0], text: "- FIXTURE onE." } as never;
    expect(await parseKbPack(JSON.stringify(card), { sha256 })).toMatchObject({
      ok: false,
      code: "checksum_mismatch",
    });
    const later = { ...pack, expiresAt: "2027-01-11T00:00:00.000Z" };
    expect(await parseKbPack(JSON.stringify(later), { sha256 })).toMatchObject({
      code: "checksum_mismatch",
    });
    const site = { ...pack, source: { ...pack.source, site: "other.example" } };
    expect(await parseKbPack(JSON.stringify(site), { sha256 })).toMatchObject({
      code: "checksum_mismatch",
    });
    // Recomputing the checksum after an edit leaves the signature wrong.
    const { sha256: _s, signature, ...rest } = card;
    const resummed = {
      ...rest,
      sha256: createHash("sha256").update(canonicalJson(rest)).digest("hex"),
      signature,
    } as KbPack;
    expect((await parseKbPack(JSON.stringify(resummed), { sha256 })).ok).toBe(
      true,
    );
    expect(await verifyKbPackSignature(fields(resummed), trust)).toEqual({
      status: "bad_signature",
      keyId: owner.key.keyId,
    });
  });

  it("a valid signature by an unknown or revoked key is not trusted", async () => {
    const stranger = newKey("FIXTURE stranger");
    expect(
      await verifyKbPackSignature(fields(signedPack(stranger)), trust),
    ).toEqual({ status: "untrusted_key", keyId: stranger.key.keyId });
    expect(
      await verifyKbPackSignature(fields(signedPack(owner)), {
        ...trust,
        revokedKeyIds: [owner.key.keyId],
      }),
    ).toEqual({ status: "revoked_key", keyId: owner.key.keyId });
  });

  it("a trusted entry whose keyId does not match its spki trusts nothing", async () => {
    const other = newKey("FIXTURE other");
    const mismatched = { ...owner.key, spki: other.key.spki };
    expect(
      await verifyKbPackSignature(fields(signedPack(owner)), {
        trustedKeys: [mismatched],
        crypto: nodeCrypto,
      }),
    ).toMatchObject({ status: "untrusted_key" });
  });

  it("the demo key is trusted only for a .invalid site (D-SEC10)", async () => {
    const demoLike = newKey("FIXTURE demo");
    const demoKey = { ...demoLike.key, demoOnly: true };
    const keys = { trustedKeys: [demoKey], crypto: nodeCrypto };
    expect(
      await verifyKbPackSignature(
        fields(signedPack(demoLike, { site: "demo.atlassian.invalid" })),
        keys,
      ),
    ).toMatchObject({ status: "trusted", demo: true });
    expect(
      await verifyKbPackSignature(fields(signedPack(demoLike)), keys),
    ).toEqual({ status: "untrusted_key", keyId: demoKey.keyId });
  });

  it("a crypto check that throws is a bad signature (fail closed)", async () => {
    const broken: KbSignatureCrypto = {
      ...nodeCrypto,
      verify: async () => {
        throw new Error("FIXTURE");
      },
    };
    expect(
      await verifyKbPackSignature(fields(signedPack(owner)), {
        trustedKeys: [owner.key],
        crypto: broken,
      }),
    ).toMatchObject({ status: "bad_signature" });
  });

  it("schema 1 and 2 packs still parse, and come out unsigned", async () => {
    for (const schemaVersion of [1, 2] as const) {
      const pack = syntheticPack(
        [{ pageId: "1", title: "FIXTURE", layers: ["a", "b", "c", "d"] }],
        {},
        { schemaVersion },
      );
      const parsed = await parseKbPack(JSON.stringify(pack), { sha256 });
      expect(parsed.ok).toBe(true);
      expect(
        await verifyKbPackSignature(
          { sha256: pack.sha256, site: pack.source.site },
          trust,
        ),
      ).toEqual({ status: "unsigned" });
    }
  });

  it("a schema 3 pack needs expiresAt; only schema 3 carries a signature", async () => {
    const pack = signedPack(owner);
    const { expiresAt: _e, ...noExpiry } = pack;
    expect(
      await parseKbPack(JSON.stringify(noExpiry), { sha256 }),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(
      await parseKbPack(JSON.stringify({ ...pack, schemaVersion: 2 }), {
        sha256,
      }),
    ).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("kbPackValidity (D-SEC11)", () => {
  const now = new Date("2026-11-12T00:00:00.000Z");
  const builtAt = "2026-11-01T00:00:00.000Z";

  it.each([
    ["2026-11-19T00:00:01.000Z", "current", 8],
    ["2026-11-19T00:00:00.000Z", "expiring", 7],
    ["2026-11-12T00:00:01.000Z", "expiring", 1],
    ["2026-11-12T00:00:00.000Z", "expired", undefined],
  ] as const)("expiresAt %s is %s", (expiresAt, state, daysLeft) => {
    expect(kbPackValidity({ builtAt, expiresAt }, { now })).toEqual({
      state,
      date: expiresAt,
      ...(daysLeft !== undefined ? { daysLeft } : {}),
    });
  });

  it("maxPackAgeDays ends a pack before its expiresAt", () => {
    expect(
      kbPackValidity(
        { builtAt, expiresAt: "2027-01-01T00:00:00.000Z" },
        { now, maxPackAgeDays: 10 },
      ),
    ).toEqual({ state: "expired", date: "2026-11-11T00:00:00.000Z" });
  });

  it("a pack built more than a day in the future is not yet valid; within a day it is", () => {
    expect(
      kbPackValidity(
        { builtAt: "2026-11-13T00:00:01.000Z", expiresAt: null },
        { now },
      ).state,
    ).toBe("not_yet_valid");
    expect(
      kbPackValidity(
        { builtAt: "2026-11-13T00:00:00.000Z", expiresAt: null },
        { now },
      ).state,
    ).toBe("current");
  });

  it("an unsigned pack without expiresAt never expires on its own; a bad date is expired", () => {
    expect(kbPackValidity({ builtAt, expiresAt: null }, { now })).toEqual({
      state: "current",
      date: null,
    });
    expect(
      kbPackValidity({ builtAt, expiresAt: "not a date" }, { now }).state,
    ).toBe("expired");
  });
});

describe("kbPackUsability and the trust a policy gives (K23 P3, P4)", () => {
  const current = { state: "current" as const, date: null };
  const trusted = {
    status: "trusted" as const,
    keyId: "0123456789abcdef",
    name: "x",
    demo: false,
  };

  it("uses a trusted current pack; an unsigned one only under allowUnsigned", () => {
    expect(kbPackUsability(trusted, current, false).usable).toBe(true);
    expect(
      kbPackUsability({ status: "unsigned" }, current, false),
    ).toMatchObject({
      usable: false,
      reason: "unsigned",
    });
    expect(kbPackUsability({ status: "unsigned" }, current, true).usable).toBe(
      true,
    );
  });

  it.each([
    [{ status: "untrusted_key" as const }, current, "untrusted"],
    [{ status: "bad_signature" as const }, current, "untrusted"],
    [{ status: "revoked_key" as const }, current, "revoked"],
    [trusted, { state: "expired" as const, date: "2026-01-01" }, "expired"],
    [
      trusted,
      { state: "not_yet_valid" as const, date: "2027-01-01" },
      "not_yet_valid",
    ],
  ])("%j and %j give %s", (trust, validity, reason) => {
    expect(kbPackUsability(trust, validity, true)).toMatchObject({
      usable: false,
      reason,
    });
  });

  it("built-in keys, policy keys, revocation of a built-in key, and an invalid policy", () => {
    const extra = { keyId: "0123456789abcdef", spki: "QUJD", name: "IT key" };
    const active = kbTrustPolicyOf({
      kind: "active",
      policy: {
        trustedPackKeys: [extra],
        revokedPackKeyIds: [DEMO_PACK_KEY.keyId],
        allowUnsignedPacks: true,
        maxPackAgeDays: 30,
      },
    });
    expect(active.trustedKeys.map((key) => key.keyId)).toEqual([extra.keyId]);
    expect(active).toMatchObject({ allowUnsigned: true, maxPackAgeDays: 30 });
    expect(kbTrustPolicyOf({ kind: "none" }).trustedKeys).toEqual([
      DEMO_PACK_KEY,
    ]);
    expect(kbTrustPolicyOf({ kind: "invalid", reason: "x" })).toEqual({
      trustedKeys: [DEMO_PACK_KEY],
      revokedKeyIds: [],
      allowUnsigned: false,
    });
  });

  it("the built-in demo key's id matches its spki", async () => {
    expect(await kbKeyIdOf(DEMO_PACK_KEY.spki, nodeCrypto.sha256Bytes)).toBe(
      DEMO_PACK_KEY.keyId,
    );
  });
});
