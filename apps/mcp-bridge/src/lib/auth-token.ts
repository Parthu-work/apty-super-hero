/**
 * Per-install daemon auth: a secret token every WebSocket client (the
 * extension, `bridge.ts`, `cli.ts`, `browser-cli.ts`) must present, plus
 * the one extension origin the daemon is pinned to.
 *
 * Both live in `~/.apty/mcp-daemon/` (overridable via
 * `APTY_MCP_CONFIG_DIR`, used by this package's own tests so they never
 * touch a real user's home directory): `token` is a plain-text file
 * created `0600` on first use; `config.json` holds the pinned extension
 * id, also `0600` since config-file permissions are cheap and this file
 * may later grow other non-public fields.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function getConfigDir(): string {
  return (
    process.env.APTY_MCP_CONFIG_DIR ?? join(homedir(), ".apty", "mcp-daemon")
  );
}

function ensureConfigDir(): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function getTokenPath(): string {
  return join(getConfigDir(), "token");
}

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/** Writes 0600 regardless of whether the file previously existed — `writeFileSync`'s `mode` option only applies on creation, so an explicit `chmodSync` is required to re-tighten an existing file's permissions (e.g. on rotate). */
function writeTokenFile(token: string): void {
  ensureConfigDir();
  const path = getTokenPath();
  writeFileSync(path, token, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best-effort on platforms without POSIX permission bits (e.g. some
    // Windows filesystems) — the file still exists and still works as a
    // shared secret, just without the OS-level permission guarantee.
  }
}

/** Reads the existing token, generating and persisting a new one on first run. */
export function getOrCreateToken(): string {
  const path = getTokenPath();
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8").trim();
    if (existing) return existing;
  }
  const token = generateToken();
  writeTokenFile(token);
  return token;
}

/** Generates and persists a brand-new token, invalidating the old one. Every already-configured client (extension Options, any other machine-local client reading the file) must be updated with the returned value. */
export function rotateToken(): string {
  const token = generateToken();
  writeTokenFile(token);
  return token;
}

/**
 * Constant-time token comparison that never throws on mismatched
 * lengths. `crypto.timingSafeEqual` requires equal-length buffers and
 * throws otherwise — hashing both sides to a fixed-length digest first
 * means the comparison always runs on two 32-byte buffers regardless of
 * the candidate token's actual length, so a length mismatch can never
 * crash the auth check, and the digest step itself keeps the whole
 * comparison constant-time (no early-exit on the raw token's length).
 */
export function tokensMatch(
  candidate: string | undefined,
  expected: string,
): boolean {
  if (candidate === undefined) return false;
  const a = createHash("sha256").update(candidate, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

interface DaemonConfig {
  allowedExtensionId?: string;
}

function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

function readConfig(): DaemonConfig {
  try {
    const raw = readFileSync(getConfigPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as DaemonConfig;
    }
    return {};
  } catch {
    return {};
  }
}

function writeConfig(config: DaemonConfig): void {
  ensureConfigDir();
  const path = getConfigPath();
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // See writeTokenFile's comment above.
  }
}

/** The one extension id the daemon accepts `/extension` connections from, or `undefined` if never configured — callers must fail closed (reject every extension origin) in that case, never fall back to accepting any. */
export function getAllowedExtensionId(): string | undefined {
  return readConfig().allowedExtensionId;
}

export function setAllowedExtensionId(id: string): void {
  writeConfig({ ...readConfig(), allowedExtensionId: id });
}

/**
 * The token travels in the WebSocket handshake's `Sec-WebSocket-Protocol`
 * header, never in the URL, so it can't leak through logs or URL history.
 * A subprotocol is the one handshake header the browser's native
 * `WebSocket` can set. Keep in step with
 * packages/browser-runtime/src/ws-bridge/ws-mcp-server.ts.
 */
export const WS_PROTOCOL = "apty-mcp.v1";
const TOKEN_PROTOCOL_PREFIX = "apty-token.";

export function authProtocols(token: string): string[] {
  return [WS_PROTOCOL, `${TOKEN_PROTOCOL_PREFIX}${token}`];
}

export function tokenFromProtocols(
  header: string | string[] | undefined,
): string | undefined {
  const values = (Array.isArray(header) ? header.join(",") : (header ?? ""))
    .split(",")
    .map((value) => value.trim());
  const entry = values.find((value) => value.startsWith(TOKEN_PROTOCOL_PREFIX));
  return entry?.slice(TOKEN_PROTOCOL_PREFIX.length);
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** `0.0.0.0`/`::` (any interface) and any real hostname/IP are non-loopback — reachable from other machines on the network, which is a meaningfully different trust boundary for a daemon whose only auth is a locally-stored token. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}
