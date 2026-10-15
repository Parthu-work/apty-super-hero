/**
 * The extension's half of the mutual authentication with apty-mcp-bridge
 * (apps/mcp-bridge/src/lib/handshake.ts; keep the two in step). The token
 * never leaves the extension: the daemon proves it holds the token first,
 * then the extension proves the same, and every tools/call that follows
 * carries a MAC under a key derived from both nonces.
 */

/** Offered next to `apty-mcp.v1` instead of the token. */
export const AUTH_PROTOCOL = "apty-auth.hmac-v1";

const LABEL = "apty-mcp-auth/v1";
const NONCE = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function hmacHex(
  key: Uint8Array<ArrayBuffer>,
  message: string,
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(
    await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message)),
  );
}

export function newNonce(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function isNonce(value: unknown): value is string {
  return typeof value === "string" && NONCE.test(value);
}

export function daemonProof(
  token: string,
  extNonce: string,
  daemonNonce: string,
): Promise<string> {
  return hmacHex(
    encoder.encode(token),
    `${LABEL}|daemon|${extNonce}|${daemonNonce}`,
  );
}

export function extensionProof(
  token: string,
  extNonce: string,
  daemonNonce: string,
): Promise<string> {
  return hmacHex(
    encoder.encode(token),
    `${LABEL}|extension|${extNonce}|${daemonNonce}`,
  );
}

export function sessionKey(
  token: string,
  extNonce: string,
  daemonNonce: string,
): Promise<string> {
  return hmacHex(
    encoder.encode(token),
    `${LABEL}|session|${extNonce}|${daemonNonce}`,
  );
}

export function callMac(
  key: string,
  seq: number,
  name: string,
  args: unknown,
): Promise<string> {
  return hmacHex(fromHex(key), `${seq}|${name}|${JSON.stringify(args ?? {})}`);
}

/** Compares two hex strings without stopping at the first difference. */
export function proofsMatch(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== "string" || candidate.length !== expected.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
