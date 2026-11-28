/**
 * The one gate every Apty content host passes before the Agent requests a
 * file from it, however the host arrives: named by the page's Apty config,
 * given by the SE or a tool call, or taken from the organization policy
 * (AUDIT-CORRECTIONS A1, "every path, one gate").
 *
 * A page can set any content URL (`window.__APTY_PLAYER_CONFIG__`), so a host
 * the page names is trusted only where the real player could reach it:
 * - 5.x `https://*.apty.ai/*` (apty-dap:packages/apps/player/wxt.config.ts:86@3f3adba);
 * - 4.x `https://*.apty.io/*` (apty-assist:player3.0/src/manifests/manifest.json:11@bbb4cbc).
 * Anything else, loopback and plain http included, needs the organization
 * policy's `aptyContentOrigins` (decision D-HTTP-ONPREM: no plain-http host
 * outside the policy, whose parser accepts http only on loopback).
 */
import type { AptyVersion } from "./content-source.js";

export const APTY_CONTENT_DOMAIN: Readonly<Record<AptyVersion, string>> = {
  "5.x": "apty.ai",
  "4.x": "apty.io",
};

export type ContentHostVerdict =
  | { ok: true; base: string }
  | { ok: false; detail: string };

const originOf = (url: string): string | undefined => {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
};

const isIpLiteral = (hostname: string) =>
  hostname.startsWith("[") || /^[\d.]+$/.test(hostname);

/**
 * `url` as a content base (origin and path, no trailing slash) if the Agent
 * may request files under it for `version`, or why not, naming what IT adds
 * to the policy to allow it.
 */
export function checkContentHost(
  url: string,
  version: AptyVersion,
  policyOrigins: readonly string[],
): ContentHostVerdict {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, detail: "The content URL is not a URL." };
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    return {
      ok: false,
      detail:
        "The content URL carries user info, a query or a fragment, which an Apty content URL never has.",
    };
  }
  const base = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  const allowed = new Set(
    policyOrigins.flatMap((o) => {
      const origin = originOf(o);
      return origin ? [origin] : [];
    }),
  );
  if (allowed.has(parsed.origin)) return { ok: true, base };

  const domain = APTY_CONTENT_DOMAIN[version];
  const host = parsed.hostname.toLowerCase();
  const onAptyDomain =
    !isIpLiteral(host) && (host === domain || host.endsWith(`.${domain}`));
  if (parsed.protocol === "https:" && parsed.port === "" && onAptyDomain) {
    return { ok: true, base };
  }
  return {
    ok: false,
    detail: `${parsed.origin} is not an Apty ${version} content host (https://*.${domain}). If it is one, add it to the organization policy's aptyContentOrigins.`,
  };
}
