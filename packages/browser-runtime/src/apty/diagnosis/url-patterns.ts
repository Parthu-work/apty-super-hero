/**
 * How the 5.x player picks the environment for a page, as the KB cards
 * describe it (JA 1496253321, 1496842241): environments are tried by order,
 * lowest first, and the first whose `urls` pattern matches wins; a star
 * matches anything, and a pattern can match anywhere inside the URL. From
 * 5.x code at 4c406d5, not runtime-verified. Matching is case-sensitive, as
 * the cards say nothing else, so a pattern whose host has capitals or the
 * default port never matches: a page's URL has neither. Such a pattern
 * still counts as one for the page's host, and is named as the reason.
 */
import { type Rec, records, text, texts } from "./pack-kit.js";

const escapeRegExp = (s: string) => s.replace(/[.+?^${}()|[\]\\/]/g, "\\$&");

const wildcard = (pattern: string) =>
  pattern.split("*").map(escapeRegExp).join(".*");

/** @internal */
export function patternMatches(pattern: string, url: string): boolean {
  return new RegExp(wildcard(pattern)).test(url);
}

export type HostPitfall = "upperCaseHost" | "defaultPort";

const DEFAULT_PORT = /:(?:443|80)$/;

/** The host part of a pattern such as `https://*.example.com/app/*`. */
function patternHost(pattern: string): string | undefined {
  const rest = pattern.replace(/^[a-z*]+:\/\//i, "");
  const host = rest.split("/")[0];
  return host ? host : undefined;
}

export interface EnvironmentMatch {
  env: Rec;
  name: string;
  order: number;
  /** One of its patterns matches the page. */
  matches: boolean;
  /** One of its patterns is for the page's host, whether or not it matches. */
  sameHost: boolean;
  /** Why its patterns for the page's host can never match as written. */
  hostPitfalls: HostPitfall[];
  /** It matches only through an empty pattern, which matches every URL. */
  onlyEmptyPatternMatches: boolean;
}

const hostMatches = (patternHost: string, host: string) =>
  new RegExp(`^${wildcard(patternHost)}$`).test(host);

function pitfallsOf(patternHost: string, host: string): HostPitfall[] {
  const pitfalls: HostPitfall[] = [];
  if (patternHost !== patternHost.toLowerCase()) pitfalls.push("upperCaseHost");
  if (DEFAULT_PORT.test(patternHost)) pitfalls.push("defaultPort");
  const normalized = patternHost.toLowerCase().replace(DEFAULT_PORT, "");
  return pitfalls.length > 0 && hostMatches(normalized, host) ? pitfalls : [];
}

/** Every environment of every application, by order, matched against the page. */
export function matchEnvironments(
  appUrls: unknown,
  pageUrl: string,
): EnvironmentMatch[] {
  const host = new URL(pageUrl).host;
  return records(appUrls)
    .flatMap((app) => records(app.environments))
    .map((env) => {
      const patterns = texts(env.urls);
      const matching = patterns.filter((p) => patternMatches(p, pageUrl));
      const hosts = patterns.flatMap((p) => patternHost(p) ?? []);
      const hostPitfalls = [
        ...new Set(hosts.flatMap((h) => pitfallsOf(h, host))),
      ];
      return {
        env,
        name: text(env.name) ?? "(unnamed)",
        order: typeof env.order === "number" ? env.order : Number.MAX_VALUE,
        matches: matching.length > 0,
        sameHost:
          hostPitfalls.length > 0 || hosts.some((h) => hostMatches(h, host)),
        hostPitfalls,
        onlyEmptyPatternMatches:
          matching.length > 0 && matching.every((p) => p === ""),
      };
    })
    .sort((a, b) => a.order - b.order);
}
