import { describe, expect, it } from "vitest";
import {
  callMac,
  daemonProof,
  extensionProof,
  isNonce,
  newNonce,
  proofsMatch,
  sessionKey,
} from "./handshake.js";

// The same vectors are asserted by the extension's handshake test
// (packages/browser-runtime/src/ws-bridge/handshake.test.ts); the daemon
// proof was checked with `openssl dgst -sha256 -hmac`.
const TOKEN = "correct-token-0123456789abcdef";
const EXT = "a".repeat(64);
const DAEMON = "b".repeat(64);

describe("handshake", () => {
  it("matches the shared test vectors", () => {
    const key = sessionKey(TOKEN, EXT, DAEMON);
    expect(daemonProof(TOKEN, EXT, DAEMON)).toBe(
      "f3900de523f774522aa9debd5f5eabc688a3f2aa20bd642ed004d077e8d6221c",
    );
    expect(extensionProof(TOKEN, EXT, DAEMON)).toBe(
      "61431823e851237d161ab1fd84151e1f9f67526255c120b2e5a469cd374ee8ba",
    );
    expect(key).toBe(
      "5b40ce022a6b466e83de7b42203df71515ba0d2c613b45bb700df5d437c3002d",
    );
    expect(callMac(key, 1, "get_current_tab", { verbose: true })).toBe(
      "e22f6a8bac993c3bd48d88319ac079338532929cf22932523c1ccd750b63b254",
    );
  });

  it("makes fresh 32-byte hex nonces", () => {
    const a = newNonce();
    expect(isNonce(a)).toBe(true);
    expect(a).not.toBe(newNonce());
    expect(isNonce("A".repeat(64))).toBe(false);
    expect(isNonce(42)).toBe(false);
  });

  it("compares proofs safely", () => {
    const proof = daemonProof(TOKEN, EXT, DAEMON);
    expect(proofsMatch(proof, proof)).toBe(true);
    expect(proofsMatch(`${proof.slice(0, -1)}0`, proof)).toBe(false);
    expect(proofsMatch("short", proof)).toBe(false);
    expect(proofsMatch(undefined, proof)).toBe(false);
  });
});
