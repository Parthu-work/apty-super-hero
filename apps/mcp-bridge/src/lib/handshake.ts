/**
 * Mutual authentication between the extension and this daemon.
 *
 * The extension never sends the token. After the WebSocket opens it sends
 * a nonce; the daemon answers with its own nonce and an HMAC proving it
 * holds the token; only then does the extension prove the same, and only
 * after that is the socket treated as the extension. Every later
 * tools/call carries a MAC under a key derived from both nonces, so a relay
 * in between cannot inject calls. Keep in step with
 * packages/browser-runtime/src/ws-bridge/handshake.ts.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Offered as a WebSocket subprotocol by an extension that authenticates by challenge. */
export const AUTH_PROTOCOL = "apty-auth.hmac-v1";

const LABEL = "apty-mcp-auth/v1";
const NONCE = /^[0-9a-f]{64}$/;

export function newNonce(): string {
  return randomBytes(32).toString("hex");
}

export function isNonce(value: unknown): value is string {
  return typeof value === "string" && NONCE.test(value);
}

function hmacHex(key: string | Buffer, message: string): string {
  return createHmac("sha256", key).update(message).digest("hex");
}

export function daemonProof(
  token: string,
  extNonce: string,
  daemonNonce: string,
): string {
  return hmacHex(token, `${LABEL}|daemon|${extNonce}|${daemonNonce}`);
}

export function extensionProof(
  token: string,
  extNonce: string,
  daemonNonce: string,
): string {
  return hmacHex(token, `${LABEL}|extension|${extNonce}|${daemonNonce}`);
}

export function sessionKey(
  token: string,
  extNonce: string,
  daemonNonce: string,
): string {
  return hmacHex(token, `${LABEL}|session|${extNonce}|${daemonNonce}`);
}

export function callMac(
  key: string,
  seq: number,
  name: string,
  args: unknown,
): string {
  return hmacHex(
    Buffer.from(key, "hex"),
    `${seq}|${name}|${JSON.stringify(args ?? {})}`,
  );
}

export function proofsMatch(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== "string" || candidate.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}
