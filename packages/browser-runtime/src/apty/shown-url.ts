/**
 * URLs and resource names as the model or the user sees them, under the
 * current redaction mode. `applyResultPrivacy` rewrites only absolute
 * http(s) URLs, so a relative URL the Apty Client reports would pass through
 * unmasked: these resolve it against a placeholder origin, apply the mode's
 * policy, and give back the path and query. Anything that can't be parsed
 * comes back empty, never as its raw text.
 *
 * They read the cached mode: call `getRedactionMode()` first so it is the
 * stored one. Stored records keep their raw URL, so what is shown always
 * follows the current mode.
 */
import { applyUrlPolicy } from "@apty/dom-snapshot";
import { currentValuePolicy } from "../runtime/value-policy.js";
import { resourceNameFor } from "./resource-body-utils.js";
import type { DiagnosticEvidence } from "./types.js";

const PLACEHOLDER_ORIGIN = "https://relative.invalid";
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function shownUrl(url: string): string {
  const policy = currentValuePolicy();
  if (HAS_SCHEME.test(url)) {
    try {
      new URL(url);
    } catch {
      return "";
    }
    return applyUrlPolicy(url, policy) ?? "";
  }
  let resolved: URL;
  try {
    resolved = new URL(url, PLACEHOLDER_ORIGIN);
  } catch {
    return "";
  }
  const shown = applyUrlPolicy(resolved.href, policy);
  if (shown === undefined) return "";
  const { pathname, search, hash } = new URL(shown);
  return `${pathname}${search}${hash}`;
}

export function shownResourceName(url: string): string {
  return resourceNameFor(shownUrl(url));
}

/** An evidence record with its URL and its data's resource name as they may be shown now. */
export function shownEvidence(record: DiagnosticEvidence): DiagnosticEvidence {
  const data = record.data as { resourceName?: unknown } | undefined;
  const name =
    data && typeof data.resourceName === "string"
      ? shownResourceName(record.url ?? data.resourceName)
      : undefined;
  return {
    ...record,
    ...(record.url !== undefined ? { url: shownUrl(record.url) } : {}),
    ...(name !== undefined ? { data: { ...data, resourceName: name } } : {}),
  };
}
