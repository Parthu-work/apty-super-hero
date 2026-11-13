/**
 * Who built a KB pack and whether it is still current (KB-RAG K23, D-SEC8
 * to D-SEC11). A schema 3 pack carries an ECDSA P-256 / SHA-256 signature
 * over its checksum, by a key named by `keyId`, and an `expiresAt`. The
 * crypto is injected (WebCrypto in the browser, node:crypto in tooling), so
 * this module stays platform-free. Fail closed: a check that throws is a
 * failure.
 */

/** The prefix of what is signed: a pack signature is never valid for anything else. */
export const KB_SIGNATURE_CONTEXT = "apty-kb-pack-signature/1";
export const KB_SIGNATURE_ALG = "ES256";

/** A public key the extension trusts for packs. */
export interface TrustedPackKey {
  /** The first 16 hex characters of the SHA-256 of the key's SPKI DER. */
  keyId: string;
  /** The key's SPKI DER, base64. */
  spki: string;
  name: string;
  /** Trusted only for packs whose `source.site` ends in `.invalid` (the demo key, D-SEC10). */
  demoOnly?: boolean;
}

export interface KbPackSignature {
  alg: typeof KB_SIGNATURE_ALG;
  keyId: string;
  /** Base64 of the raw (IEEE P1363, 64-byte) signature. */
  value: string;
}

/** The crypto a signature check needs. */
export interface KbSignatureCrypto {
  /** Whether `signature` (base64, P1363) is `spki`'s (base64) ECDSA P-256 SHA-256 signature of `message`. */
  verify(
    spki: string,
    message: Uint8Array<ArrayBuffer>,
    signature: string,
  ): Promise<boolean>;
  /** SHA-256 of bytes, lower-case hex. */
  sha256Bytes(bytes: Uint8Array<ArrayBuffer>): Promise<string>;
}

export type KbTrustResult =
  | { status: "trusted"; keyId: string; name: string; demo: boolean }
  | {
      status: "unsigned" | "untrusted_key" | "revoked_key" | "bad_signature";
      keyId?: string;
    };

/** The bytes a pack's signature covers. */
export function kbSignedMessage(
  sha256: string,
  keyId: string,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    `${KB_SIGNATURE_CONTEXT}\n${sha256}\n${keyId}`,
  );
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A key's id: the first 16 hex characters of the SHA-256 of its SPKI DER. */
export async function kbKeyIdOf(
  spki: string,
  sha256Bytes: KbSignatureCrypto["sha256Bytes"],
): Promise<string> {
  return (await sha256Bytes(base64ToBytes(spki))).slice(0, 16);
}

/** Whether a Confluence site is a demo site (D-SEC10). */
export function isInvalidSite(site: string): boolean {
  return /\.invalid\.?$/i.test(site.trim());
}

/** What a trust check reads of a pack: its checksum, signature and site. */
export interface KbSignedFields {
  sha256: string;
  signature?: KbPackSignature | null;
  site: string;
}

/**
 * Whether a pack is signed by a trusted key: `trusted` with the key's id and
 * name, or why not. A demo-key signature on a pack whose site is not
 * `.invalid` is `untrusted_key` (D-SEC10).
 */
export async function verifyKbPackSignature(
  pack: KbSignedFields,
  {
    trustedKeys,
    revokedKeyIds = [],
    crypto,
  }: {
    trustedKeys: readonly TrustedPackKey[];
    revokedKeyIds?: readonly string[];
    crypto: KbSignatureCrypto;
  },
): Promise<KbTrustResult> {
  const signature = pack.signature;
  if (!signature) return { status: "unsigned" };
  const { keyId } = signature;
  if (revokedKeyIds.includes(keyId)) return { status: "revoked_key", keyId };
  try {
    let key: TrustedPackKey | undefined;
    for (const candidate of trustedKeys) {
      if (
        candidate.keyId === keyId &&
        (await kbKeyIdOf(candidate.spki, crypto.sha256Bytes)) === keyId
      ) {
        key = candidate;
        break;
      }
    }
    if (!key || (key.demoOnly && !isInvalidSite(pack.site))) {
      return { status: "untrusted_key", keyId };
    }
    if (signature.alg !== KB_SIGNATURE_ALG) {
      return { status: "bad_signature", keyId };
    }
    const valid = await crypto.verify(
      key.spki,
      kbSignedMessage(pack.sha256, keyId),
      signature.value,
    );
    return valid
      ? {
          status: "trusted",
          keyId,
          name: key.name,
          demo: key.demoOnly === true,
        }
      : { status: "bad_signature", keyId };
  } catch {
    return { status: "bad_signature", keyId };
  }
}

export const KB_PACK_EXPIRING_DAYS = 7;
const DAY_MS = 86_400_000;

export type KbPackValidityState =
  | "current"
  | "expiring"
  | "expired"
  | "not_yet_valid";

export interface KbPackValidity {
  state: KbPackValidityState;
  /** When it expires (or expired), or for `not_yet_valid` when it was built; null when it never expires. */
  date: string | null;
  /** Whole days left, for `current` and `expiring` with a date. */
  daysLeft?: number;
}

/**
 * Whether a pack is within its life (D-SEC11): the earliest of `expiresAt`
 * and `builtAt + maxPackAgeDays` ends it, `expiring` within 7 days of that,
 * and a pack built more than a day in the future is not yet valid. A date
 * that does not parse counts as expired.
 */
export function kbPackValidity(
  info: { builtAt: string; expiresAt?: string | null },
  { now, maxPackAgeDays }: { now: Date; maxPackAgeDays?: number },
): KbPackValidity {
  const built = Date.parse(info.builtAt);
  if (Number.isNaN(built)) return { state: "expired", date: null };
  if (built > now.getTime() + DAY_MS) {
    return { state: "not_yet_valid", date: new Date(built).toISOString() };
  }
  const ends: number[] = [];
  if (info.expiresAt) {
    const expires = Date.parse(info.expiresAt);
    if (Number.isNaN(expires)) return { state: "expired", date: null };
    ends.push(expires);
  }
  if (maxPackAgeDays !== undefined) ends.push(built + maxPackAgeDays * DAY_MS);
  if (ends.length === 0) return { state: "current", date: null };
  const end = Math.min(...ends);
  const date = new Date(end).toISOString();
  if (now.getTime() >= end) return { state: "expired", date };
  const daysLeft = Math.ceil((end - now.getTime()) / DAY_MS);
  return {
    state: daysLeft <= KB_PACK_EXPIRING_DAYS ? "expiring" : "current",
    date,
    daysLeft,
  };
}

/** Why a loaded pack is not used. */
export type KbPackUnusableReason =
  | "expired"
  | "not_yet_valid"
  | "unsigned"
  | "untrusted"
  | "revoked";

export interface KbPackUsability {
  trust: KbTrustResult;
  validity: KbPackValidity;
  usable: boolean;
  reason?: KbPackUnusableReason;
}

/** Whether a pack is used: trusted (or unsigned under `allowUnsigned`), and current or expiring. */
export function kbPackUsability(
  trust: KbTrustResult,
  validity: KbPackValidity,
  allowUnsigned: boolean,
): KbPackUsability {
  const reason: KbPackUnusableReason | undefined =
    trust.status === "unsigned" && !allowUnsigned
      ? "unsigned"
      : trust.status === "revoked_key"
        ? "revoked"
        : trust.status === "untrusted_key" || trust.status === "bad_signature"
          ? "untrusted"
          : validity.state === "expired"
            ? "expired"
            : validity.state === "not_yet_valid"
              ? "not_yet_valid"
              : undefined;
  return {
    trust,
    validity,
    usable: reason === undefined,
    ...(reason ? { reason } : {}),
  };
}
