/**
 * The keys a KB pack may be signed with (KB-RAG K23, D-SEC9, D-SEC10): the
 * published demo key, trusted only for `.invalid` sites, and the Apty KB
 * owner's key(s), plus any a policy adds; a policy can revoke any of them.
 */
import { type OrgPolicyState, policyOf } from "../config/org-policy.js";
import type { TrustedPackKey } from "./pack-signature.js";

/** The demo key (tooling/scripts/kb/demo-signing-key.pem, public on purpose). */
export const DEMO_PACK_KEY: TrustedPackKey = Object.freeze({
  keyId: "8db33081c3ea74eb",
  spki: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEHBwOeyZu0yluxkZg5U2pwvFhCdoC354HQpxyEYHwLYYrKnTlX4N1NS5x9MNEoSMTRJ26NcGyZgat2qVfPlnCfw==",
  name: "Apty demo key",
  demoOnly: true,
});

/**
 * The Apty KB owner's public keys. Empty until the KB owner runs
 * `pnpm kb:keygen` and sends the public key: until then only demo packs, or
 * packs a policy's `trustedPackKeys` covers, are used.
 */
export const KB_OWNER_PACK_KEYS: readonly TrustedPackKey[] = [];

export const BUILT_IN_PACK_KEYS: readonly TrustedPackKey[] = [
  DEMO_PACK_KEY,
  ...KB_OWNER_PACK_KEYS,
];

/** What decides whether a loaded pack is used, from the built-in keys and the policy. */
export interface KbTrustPolicy {
  trustedKeys: readonly TrustedPackKey[];
  revokedKeyIds: readonly string[];
  allowUnsigned: boolean;
  maxPackAgeDays?: number;
}

/**
 * The trust the policy gives: the built-in keys and `trustedPackKeys`, less
 * `revokedPackKeyIds`. An invalid policy trusts the demo key only, allows
 * no unsigned pack, and so uses no pack but demo packs (K23 P3).
 */
export function kbTrustPolicyOf(
  state: OrgPolicyState,
  builtIn: readonly TrustedPackKey[] = BUILT_IN_PACK_KEYS,
): KbTrustPolicy {
  if (state.kind === "invalid") {
    return {
      trustedKeys: builtIn.filter((key) => key.demoOnly),
      revokedKeyIds: [],
      allowUnsigned: false,
    };
  }
  const policy = policyOf(state);
  const revokedKeyIds = policy?.revokedPackKeyIds ?? [];
  return {
    trustedKeys: [
      ...builtIn,
      ...(policy?.trustedPackKeys ?? []).map((key) => ({
        ...key,
        demoOnly: false,
      })),
    ].filter((key) => !revokedKeyIds.includes(key.keyId)),
    revokedKeyIds,
    allowUnsigned: policy?.allowUnsignedPacks === true,
    ...(policy?.maxPackAgeDays !== undefined
      ? { maxPackAgeDays: policy.maxPackAgeDays }
      : {}),
  };
}
