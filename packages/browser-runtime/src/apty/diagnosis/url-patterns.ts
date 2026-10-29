/**
 * How the 5.x player picks the environment for a page, as the KB cards
 * describe it (JA 1496253321, 1496842241): environments are tried by order,
 * lowest first, and the first whose `urls` pattern matches wins; a star
 * matches anything, and a pattern can match anywhere inside the URL. From
 * 5.x code at 4c406d5, not runtime-verified. Matching is case-sensitive, as
 * the cards say nothing else.
 */
import { type Rec, records, text, texts } from "./pack-kit.js";

const escapeRegExp = (s: string) => s.replace(/[.+?^${}()|[\]\\/]/g, "\\$&");

const wildcard = (pattern: string) =>
  pattern.split("*").map(escapeRegExp).join(".*");

/** @internal */
export function patternMatches(pattern: string, url: string): boolean {
  return new RegExp(wildcard(pattern)).test(url);
}

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
      return {
        env,
        name: text(env.name) ?? "(unnamed)",
        order: typeof env.order === "number" ? env.order : Number.MAX_VALUE,
        matches: patterns.some((p) => patternMatches(p, pageUrl)),
        sameHost: patterns.some((p) => {
          const h = patternHost(p);
          return h !== undefined && new RegExp(`^${wildcard(h)}$`).test(host);
        }),
      };
    })
    .sort((a, b) => a.order - b.order);
}
