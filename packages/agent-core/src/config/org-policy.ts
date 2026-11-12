/**
 * The organization policy (KB-RAG K22, D-SEC2): what Apty IT sets in
 * Chrome's managed storage for this extension, and what it means. Pure
 * logic only; reading `chrome.storage.managed` lives in the browser code.
 *
 * Fail closed (hard rule 1): a policy that cannot be read or does not parse
 * is `invalid`, and an invalid policy acts as `RESTRICTIVE_ORG_POLICY`.
 */
import { AI_PROVIDERS, type AIProviderKey } from "./ai-providers.js";
import type { RedactionModeSetting } from "./settings.js";

export type KbToModel = "off" | "approved";

/** Settings a policy writes into the effective settings and locks. */
export interface OrgPolicyPreset {
  aiProvider?: AIProviderKey;
  aiHost?: string;
  aiModel?: string;
  aiToken?: string;
  aiWorkspaceId?: string;
}

export interface OrgPolicy {
  kbToModel?: KbToModel;
  kbToMcp?: boolean;
  allowedProviders?: AIProviderKey[];
  /** Normalized origins: lower-case host, no default port, no path. */
  allowedOrigins?: string[];
  allowedModels?: string[];
  preset?: OrgPolicyPreset;
  redactionFloor?: Exclude<RedactionModeSetting, "off">;
  allowCustomModels?: boolean;
  allowMcpBridge?: boolean;
  auditRetentionDays?: number;
  /** KB-RAG K23 (D-SEC9): keys trusted for packs besides the built-in ones. An entry whose keyId does not match its spki trusts nothing. */
  trustedPackKeys?: Array<{ keyId: string; spki: string; name: string }>;
  /** Key ids never trusted, built-in ones included. */
  revokedPackKeyIds?: string[];
  /** Use unsigned packs (schema 1 and 2, or built with --unsigned), for a transition. */
  allowUnsignedPacks?: boolean;
  /** No pack is used more than this many days after it was built (D-SEC11). */
  maxPackAgeDays?: number;
  /** KB-RAG K25 (L1, D-CASE1): how many days a case record is kept on the device. */
  caseRetentionDays?: number;
}

/** What the extension knows of the policy: none set, one in force, or one it could not use. */
export type OrgPolicyState =
  | { kind: "none" }
  | { kind: "active"; policy: OrgPolicy }
  | { kind: "invalid"; reason: string };

export const ORG_POLICY_DEFAULTS = {
  kbToModel: "off",
  kbToMcp: false,
  allowMcpBridge: true,
  auditRetentionDays: 30,
} as const satisfies Partial<OrgPolicy>;

export const AUDIT_RETENTION_RANGE = { min: 1, max: 365 } as const;
export const MAX_PACK_AGE_RANGE = { min: 1, max: 365 } as const;
const PACK_KEY_ID = /^[0-9a-f]{16}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** What an invalid or unread policy means: no KB text anywhere, no model destination, the strictest masking. */
export const RESTRICTIVE_ORG_POLICY: Readonly<OrgPolicy> = Object.freeze({
  kbToModel: "off",
  kbToMcp: false,
  allowedProviders: [],
  allowedOrigins: [],
  allowedModels: [],
  redactionFloor: "strict",
  allowCustomModels: false,
  allowMcpBridge: false,
  auditRetentionDays: ORG_POLICY_DEFAULTS.auditRetentionDays,
});

const PRESET_KEYS = [
  "aiProvider",
  "aiHost",
  "aiModel",
  "aiToken",
  "aiWorkspaceId",
] as const satisfies readonly (keyof OrgPolicyPreset)[];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Whether `hostname` (as `URL.hostname` gives it) is this machine. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    LOOPBACK_HOSTS.has(host) ||
    host.endsWith(".localhost") ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

/**
 * A base URL's origin as the allow-list compares it: scheme, lower-case
 * host and a non-default port. Undefined when it is not an http(s) URL.
 */
export function originOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

/** A policy origin entry, normalized, or the reason it is not one. */
function parseOrigin(value: string): { origin: string } | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { error: `"${value}" is not a URL` };
  }
  if (parsed.username || parsed.password) {
    return { error: `"${value}" carries user info` };
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    return { error: `"${value}" has a path; give the origin only` };
  }
  if (parsed.protocol === "https:") return { origin: parsed.origin };
  if (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname)) {
    return { origin: parsed.origin };
  }
  return { error: `"${value}" is not https (only loopback may use http)` };
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isProviderKey = (value: unknown): value is AIProviderKey =>
  typeof value === "string" && Object.hasOwn(AI_PROVIDERS, value);

function parsePreset(
  raw: unknown,
): { preset: OrgPolicyPreset } | { error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: "preset must be an object" };
  }
  const preset: OrgPolicyPreset = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(PRESET_KEYS as readonly string[]).includes(key)) {
      return { error: `preset.${key} is not a known key` };
    }
    if (typeof value !== "string") {
      return { error: `preset.${key} must be a string` };
    }
    if (key === "aiProvider") {
      if (!isProviderKey(value)) {
        return { error: `preset.aiProvider "${value}" is not a provider` };
      }
      preset.aiProvider = value;
    } else if (key === "aiHost") {
      const origin = originOf(value);
      if (!origin) return { error: "preset.aiHost must be an http(s) URL" };
      const host = new URL(value).hostname;
      if (!value.startsWith("https:") && !isLoopbackHost(host)) {
        return { error: "preset.aiHost must be https (or loopback)" };
      }
      preset.aiHost = value;
    } else {
      preset[key as Exclude<keyof OrgPolicyPreset, "aiProvider">] = value;
    }
  }
  return { preset };
}

type Parsed = { ok: true; policy: OrgPolicy } | { ok: false; reason: string };

/**
 * A managed-storage object as an `OrgPolicy`. Strict: an unknown key, a
 * wrong type or a value out of range makes the whole policy invalid.
 */
export function parseOrgPolicy(raw: unknown): Parsed {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "the policy is not an object" };
  }
  const policy: OrgPolicy = {};
  const fail = (reason: string): Parsed => ({ ok: false, reason });
  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      case "kbToModel":
        if (value !== "off" && value !== "approved") {
          return fail('kbToModel must be "off" or "approved"');
        }
        policy.kbToModel = value;
        break;
      case "kbToMcp":
      case "allowCustomModels":
      case "allowMcpBridge":
        if (typeof value !== "boolean") return fail(`${key} must be a boolean`);
        policy[key] = value;
        break;
      case "allowedProviders":
        if (!isStringArray(value)) return fail(`${key} must be a string list`);
        for (const provider of value) {
          if (!isProviderKey(provider)) {
            return fail(`allowedProviders: "${provider}" is not a provider`);
          }
        }
        policy.allowedProviders = value as AIProviderKey[];
        break;
      case "allowedOrigins": {
        if (!isStringArray(value)) return fail(`${key} must be a string list`);
        const origins: string[] = [];
        for (const entry of value) {
          const parsed = parseOrigin(entry);
          if ("error" in parsed) return fail(`allowedOrigins: ${parsed.error}`);
          origins.push(parsed.origin);
        }
        policy.allowedOrigins = origins;
        break;
      }
      case "allowedModels":
        if (!isStringArray(value)) return fail(`${key} must be a string list`);
        policy.allowedModels = value;
        break;
      case "preset": {
        const parsed = parsePreset(value);
        if ("error" in parsed) return fail(parsed.error);
        policy.preset = parsed.preset;
        break;
      }
      case "redactionFloor":
        if (value !== "strict" && value !== "standard") {
          return fail('redactionFloor must be "strict" or "standard"');
        }
        policy.redactionFloor = value;
        break;
      case "auditRetentionDays":
        if (
          typeof value !== "number" ||
          !Number.isInteger(value) ||
          value < AUDIT_RETENTION_RANGE.min ||
          value > AUDIT_RETENTION_RANGE.max
        ) {
          return fail("auditRetentionDays must be a whole number, 1 to 365");
        }
        policy.auditRetentionDays = value;
        break;
      case "trustedPackKeys": {
        if (!Array.isArray(value))
          return fail("trustedPackKeys must be a list");
        const keys: NonNullable<OrgPolicy["trustedPackKeys"]> = [];
        for (const entry of value) {
          if (typeof entry !== "object" || entry === null) {
            return fail("trustedPackKeys entries must be objects");
          }
          const { keyId, spki, name, ...extra } = entry as Record<
            string,
            unknown
          >;
          if (Object.keys(extra).length > 0) {
            return fail(
              `trustedPackKeys: "${Object.keys(extra)[0]}" is not a key field`,
            );
          }
          if (typeof keyId !== "string" || !PACK_KEY_ID.test(keyId)) {
            return fail("trustedPackKeys: keyId must be 16 hex characters");
          }
          if (
            typeof spki !== "string" ||
            spki.length < 40 ||
            spki.length > 400 ||
            !BASE64.test(spki)
          ) {
            return fail("trustedPackKeys: spki must be a base64 public key");
          }
          if (typeof name !== "string" || !name.trim() || name.length > 100) {
            return fail("trustedPackKeys: name must be 1 to 100 characters");
          }
          keys.push({ keyId, spki, name });
        }
        policy.trustedPackKeys = keys;
        break;
      }
      case "revokedPackKeyIds":
        if (
          !isStringArray(value) ||
          !value.every((id) => PACK_KEY_ID.test(id))
        ) {
          return fail("revokedPackKeyIds must be a list of 16-hex key ids");
        }
        policy.revokedPackKeyIds = value;
        break;
      case "allowUnsignedPacks":
        if (typeof value !== "boolean") return fail(`${key} must be a boolean`);
        policy.allowUnsignedPacks = value;
        break;
      case "caseRetentionDays":
        if (
          typeof value !== "number" ||
          !Number.isInteger(value) ||
          value < 1 ||
          value > 365
        ) {
          return fail("caseRetentionDays must be a whole number, 1 to 365");
        }
        policy.caseRetentionDays = value;
        break;
      case "maxPackAgeDays":
        if (
          typeof value !== "number" ||
          !Number.isInteger(value) ||
          value < MAX_PACK_AGE_RANGE.min ||
          value > MAX_PACK_AGE_RANGE.max
        ) {
          return fail("maxPackAgeDays must be a whole number, 1 to 365");
        }
        policy.maxPackAgeDays = value;
        break;
      default:
        return fail(`"${key}" is not a policy key`);
    }
  }
  return { ok: true, policy };
}

/** What managed storage held, as a state: empty is `none`. */
export function orgPolicyStateOf(raw: unknown): OrgPolicyState {
  if (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    Object.keys(raw).length === 0
  ) {
    return { kind: "none" };
  }
  const parsed = parseOrgPolicy(raw);
  return parsed.ok
    ? { kind: "active", policy: parsed.policy }
    : { kind: "invalid", reason: parsed.reason };
}

/** The policy that applies: none for `none`, the restrictive one for `invalid`. */
export function policyOf(state: OrgPolicyState): Readonly<OrgPolicy> | null {
  if (state.kind === "none") return null;
  return state.kind === "active" ? state.policy : RESTRICTIVE_ORG_POLICY;
}

/** Whether the policy sets any allow-list. */
export function hasAllowList(policy: Readonly<OrgPolicy>): boolean {
  return (
    policy.allowedProviders !== undefined ||
    policy.allowedOrigins !== undefined ||
    policy.allowedModels !== undefined
  );
}

/** Whether the SE may add BYOK custom models: absent means no once any allow-list is set. */
export function customModelsAllowed(state: OrgPolicyState): boolean {
  const policy = policyOf(state);
  if (!policy) return true;
  return policy.allowCustomModels ?? !hasAllowList(policy);
}

/** Whether the MCP bridge may connect at all. */
export function mcpBridgeAllowed(state: OrgPolicyState): boolean {
  return policyOf(state)?.allowMcpBridge ?? ORG_POLICY_DEFAULTS.allowMcpBridge;
}

/** Whether KB text may reach the MCP bridge. */
export function kbToMcpAllowed(state: OrgPolicyState): boolean {
  return policyOf(state)?.kbToMcp ?? ORG_POLICY_DEFAULTS.kbToMcp;
}

/** How many days the KB send record is kept. */
export function auditRetentionDays(state: OrgPolicyState): number {
  return (
    policyOf(state)?.auditRetentionDays ??
    ORG_POLICY_DEFAULTS.auditRetentionDays
  );
}

/** How many days a case record is kept (KB-RAG K25, L1): the policy's, or 90. */
export function caseRetentionDays(state: OrgPolicyState): number {
  return policyOf(state)?.caseRetentionDays ?? 90;
}
