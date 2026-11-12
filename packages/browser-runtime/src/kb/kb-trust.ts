/**
 * Whether each loaded KB pack is used (KB-RAG K23 P3, P4): signed by a key
 * the extension and the policy trust, and within its dates. Checked every
 * time a pack is read, not only at import, so a key the policy revokes or a
 * pack that expires stops being used at the next search with no reload.
 */
import {
  base64ToBytes,
  type KbPackInfo,
  type KbPackState,
  type KbPackUsability,
  type KbSignatureCrypto,
  type KbTrustPolicy,
  kbPackUsability,
  kbPackValidity,
  kbTrustPolicyOf,
  type OrgPolicyState,
  verifyKbPackSignature,
} from "@apty/agent-core";
import { loadOrgPolicy } from "../runtime/org-policy.js";

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/** WebCrypto ECDSA P-256 / SHA-256, as every Chrome the manifest allows has it. */
export const webCryptoSignature: KbSignatureCrypto = {
  async verify(spki, message, signature) {
    const key = await crypto.subtle.importKey(
      "spki",
      base64ToBytes(spki),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      base64ToBytes(signature),
      message,
    );
  },
  sha256Bytes: async (bytes) =>
    hex(await crypto.subtle.digest("SHA-256", bytes)),
};

/** A loaded pack, as Options, Preflight and the egress decision see it: its description and whether it is used. */
export type { KbPackState } from "@apty/agent-core";

/** How a pack is judged; injected so tests can trust a key of their own. */
export type KbPackAssessor = (info: KbPackInfo) => Promise<KbPackUsability>;

/** The assessor for a policy, a clock and the crypto; a check that throws makes the pack unusable. */
export function createKbPackAssessor({
  policy = loadOrgPolicy,
  now = () => new Date(),
  crypto = webCryptoSignature,
  trustOf = kbTrustPolicyOf,
}: {
  policy?: () => Promise<OrgPolicyState>;
  now?: () => Date;
  crypto?: KbSignatureCrypto;
  trustOf?: (state: OrgPolicyState) => KbTrustPolicy;
} = {}): KbPackAssessor {
  return async (info) => {
    let trust: KbTrustPolicy;
    try {
      trust = trustOf(await policy());
    } catch {
      trust = trustOf({
        kind: "invalid",
        reason: "the policy could not be read",
      });
    }
    const validity = kbPackValidity(info, {
      now: now(),
      ...(trust.maxPackAgeDays !== undefined
        ? { maxPackAgeDays: trust.maxPackAgeDays }
        : {}),
    });
    const verdict = await verifyKbPackSignature(info, {
      trustedKeys: trust.trustedKeys,
      revokedKeyIds: trust.revokedKeyIds,
      crypto,
    });
    return kbPackUsability(verdict, validity, trust.allowUnsigned);
  };
}

let shared: KbPackAssessor | undefined;

/** The assessor with the managed policy, the device's clock and WebCrypto. */
export function sharedKbPackAssessor(): KbPackAssessor {
  shared ??= createKbPackAssessor();
  return shared;
}

/** Each info with its usability, judged now. */
export async function withUsability(
  infos: readonly KbPackInfo[],
  assess: KbPackAssessor,
): Promise<KbPackState[]> {
  return Promise.all(
    infos.map(async (info) => ({ ...info, usability: await assess(info) })),
  );
}
