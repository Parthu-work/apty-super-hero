/**
 * Stable identity for frames and URLs.
 *
 * A `frameId` is assigned per page load, a frame `name` can carry a counter
 * and a GUID, and URLs carry tenants, sessions and record ids. None of them
 * survives a reload, a second tenant or a second session, so none can be
 * identity (DOM Health brief, sections 2 and 4.4). Measured:
 *
 * - Infor OS Portal loads LN in an iframe with `title="LN"`,
 *   `name="LN_44_<GUID>"`, `data-osp-id="LN"` and
 *   `src=…?inforTenantId=<tenant>&inforSessionId=<tenant>~<GUID>&inforThemeName=Light&inforCurrentLocale=en-GB&inforTimeZone=…&inforWorkspaceVersion=2026.09.00`.
 *   The brief's Factory Track frame has the same shape (`ft_45_<GUID>`,
 *   `data-osp-id="ft"`, `tenant=`).
 * - athenaOne's frameset frames are `<iframe id="GlobalNav">`,
 *   `id="GlobalWrapper"`, `id="Status"`, with no `src` attribute (the page
 *   navigates them from script), hidden `class="shimiframe"` menu shims,
 *   and the 7-digit practice id as the first path segment (`/<id>/2/…`).
 *
 * Pure functions: the owner attributes are read by the frame responder in
 * the parent document and joined to `frameId`s with
 * `chrome.runtime.getFrameId`.
 */

/** Attributes of the element hosting a frame, as its parent document reports them. */
export interface FrameOwnerAttributes {
  tagName: "iframe" | "frame";
  name: string | null;
  id: string | null;
  title: string | null;
  ospId: string | null;
  srcAttribute: string | null;
  className: string | null;
  rendered: boolean;
}

export const PLACEHOLDER_ID = ":id";
export const PLACEHOLDER_TENANT = ":tenant";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GUID_ANYWHERE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ALL_DIGITS = /^\d+$/;
/** Hex-looking, 8+ characters, with at least one digit (so an 8-letter word made of a-f is not an id). */
const HEX_TOKEN = /^(?=[0-9a-f]*\d)[0-9a-f]{8,}$/i;
/**
 * Infor tenant ids: 16 characters and an environment suffix. Measured as
 * the `inforTenantId` value and, lower-cased, in the LN export's CloudFront
 * tenant-asset path (`/tenants/<n>/<tenant>/logo/…`).
 */
const INFOR_TENANT = /^[a-z0-9]{16}_(?:trn|prd|tst|dev|dem|stg)$/i;

function templateSegment(segment: string): string {
  if (!segment) return segment;
  const decoded = safeDecode(segment);
  if (INFOR_TENANT.test(decoded)) return PLACEHOLDER_TENANT;
  if (
    ALL_DIGITS.test(decoded) ||
    GUID.test(decoded) ||
    HEX_TOKEN.test(decoded)
  ) {
    return PLACEHOLDER_ID;
  }
  return segment;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Query parameters that carry a tenant, session or credential. The exact
 * names are the brief's list (section 4.4); the `…tenantId` / `…sessionId`
 * suffix form is measured (`inforTenantId`, `inforSessionId`).
 */
const IDENTITY_FREE_PARAM_NAMES = new Set([
  "tenant",
  "session",
  "sessionid",
  "token",
  "auth",
  "jwt",
  "ticket",
  "nonce",
]);
const TENANT_OR_SESSION_PARAM = /(?:tenant|session)(?:id)?$/i;
/**
 * Per-user or per-release parameters, measured on the LN frame:
 * `inforThemeName`, `inforThemeColor`, `inforCurrentLocale`,
 * `inforCurrentLanguage`, `inforTimeZone`, `inforStdTimeZone`,
 * `inforWorkspaceVersion`, `inforOSPortalVersion`.
 */
const ENVIRONMENT_PARAM = /(?:theme|locale|language|timezone|version)/i;

export interface UrlTemplateOptions {
  /** Keep the fragment as part of identity. Defaults to detecting `#/` or `#!/` routes. */
  hashRouted?: boolean;
  /** Further parameter names to drop (lower-case), for an application with its own tenant parameter. */
  dropParams?: readonly string[];
}

export interface UrlTemplate {
  /** The URL with identifiers replaced by placeholders and identity-free parameters dropped. */
  template: string;
  /**
   * Which real value each placeholder replaced, in order. Local only: never
   * stored, exported or sent, so a report can show the real URL without the
   * template carrying tenant data into stored identity.
   */
  replacements: Array<{ placeholder: string; value: string }>;
}

function isHashRoute(hash: string): boolean {
  return /^#!?\//.test(hash);
}

/**
 * The URL as identity (brief section 4.4). Not a URL to navigate to, and
 * not a privacy measure on its own: `redactAuditUrl` decides what leaves
 * the device.
 */
export function urlTemplate(
  url: string,
  options: UrlTemplateOptions = {},
): UrlTemplate {
  const replacements: UrlTemplate["replacements"] = [];
  const replace = (value: string): string => {
    const templated = templateSegment(value);
    if (templated !== value)
      replacements.push({ placeholder: templated, value });
    return templated;
  };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { template: url, replacements };
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return { template: `${parsed.protocol}`, replacements };
  }

  const path = parsed.pathname.split("/").map(replace).join("/");

  const drop = new Set([
    ...IDENTITY_FREE_PARAM_NAMES,
    ...(options.dropParams ?? []),
  ]);
  const kept: Array<[string, string]> = [];
  for (const [name, value] of parsed.searchParams) {
    const lower = name.toLowerCase();
    if (drop.has(lower) || TENANT_OR_SESSION_PARAM.test(name)) {
      replacements.push({ placeholder: `${name}=`, value });
      continue;
    }
    if (ENVIRONMENT_PARAM.test(name)) continue;
    kept.push([name, replace(value)]);
  }
  kept.sort(([a], [b]) => a.localeCompare(b));
  const query = kept.length
    ? `?${kept.map(([name, value]) => `${name}=${value}`).join("&")}`
    : "";

  const hashRouted = options.hashRouted ?? isHashRoute(parsed.hash);
  let fragment = "";
  if (hashRouted && parsed.hash) {
    const [routePath, routeQuery] = parsed.hash.slice(1).split("?", 2);
    fragment = `#${routePath!.split("/").map(replace).join("/")}`;
    if (routeQuery) {
      const routeParams = new URLSearchParams(routeQuery);
      const routeKept = [...routeParams]
        .filter(([name]) => !drop.has(name.toLowerCase()))
        .map(([name, value]) => [name, replace(value)] as const)
        .sort(([a], [b]) => a.localeCompare(b));
      if (routeKept.length) {
        fragment += `?${routeKept.map(([n, v]) => `${n}=${v}`).join("&")}`;
      }
    }
  }

  return {
    template: `${parsed.protocol}//${parsed.host}${path}${query}${fragment}`,
    replacements,
  };
}

export type FrameKeySource =
  | "top"
  | "osp-id"
  | "title"
  | "name"
  | "id"
  | "url-template"
  | "position";

export interface FrameKey {
  key: string;
  source: FrameKeySource;
  /** False only for the positional last resort. */
  stable: boolean;
}

/**
 * A frame `name` without its per-open counter and GUID:
 * `LN_44_<GUID>` → `LN`, `ft_45_<GUID>` → `ft` (Infor OS Portal). Null when
 * nothing stable is left.
 */
export function stableFrameName(name: string): string | null {
  const parts = name
    .replace(GUID_ANYWHERE, " ")
    .split(/[\s_-]+/)
    .filter((part) => part && !ALL_DIGITS.test(part) && !HEX_TOKEN.test(part));
  return parts.length ? parts.join("_") : null;
}

export interface FrameKeyInput {
  frameId: number;
  url: string;
  owner: FrameOwnerAttributes | null;
  /** Child index path from the top frame (`"0/2/1"`), for the last resort. */
  position: string;
}

/**
 * The first available of: `data-osp-id`, the frame element's `title`, its
 * `name` without counters and GUIDs, its `id`, origin + `urlTemplate`, and
 * finally its position, which is reported as unstable. Brief section 4.4.
 */
export function frameKey(input: FrameKeyInput): FrameKey {
  if (input.frameId === 0) return { key: "top", source: "top", stable: true };
  const owner = input.owner;
  const ospId = owner?.ospId?.trim();
  if (ospId) return { key: ospId, source: "osp-id", stable: true };
  const title = owner?.title?.trim();
  if (title) return { key: title, source: "title", stable: true };
  const name = owner?.name ? stableFrameName(owner.name) : null;
  if (name) return { key: name, source: "name", stable: true };
  const id = owner?.id?.trim();
  if (id) return { key: id, source: "id", stable: true };
  if (/^https?:/.test(input.url)) {
    return {
      key: urlTemplate(input.url).template,
      source: "url-template",
      stable: true,
    };
  }
  return {
    key: `position:${input.position}`,
    source: "position",
    stable: false,
  };
}

export type FrameRole =
  | "application"
  | "chrome"
  | "shim"
  | "placeholder"
  | "overlay";

export interface FrameRoleDecision {
  role: FrameRole;
  reason: string;
}

/** athenaOne's hidden menu shims carry `class="shimiframe"` (`searchmenuiframe`, `patientsmenuiframe`). */
const SHIM_PATTERN = /shim/i;

/** Frames that hold navigation or status, not the application: athenaOne's `GlobalNav` and `Status`. */
const CHROME_FRAME_NAMES = new Set(["globalnav", "status"]);

/** Third-party digital-adoption overlays, as frame names, ids or classes. Pendo is measured in athenaOne (as badges, not frames); a Pendo frame is assumed from that, not observed. */
const OVERLAY_PATTERN = /^_?pendo|walkme|whatfix|appcues|userguiding/i;

export interface FrameRoleInput {
  frameId: number;
  url: string;
  owner: FrameOwnerAttributes | null;
  /** Elements in the frame's own document, when it was read; null when it could not be. */
  elementCount: number | null;
  /** Interactive elements in it, when it was read. */
  interactiveCount?: number | null;
}

/**
 * Brief section 4.4. Decided from what the parent says about the frame
 * element and from the frame's URL; whether a document with frames of its
 * own is only a shell is decided after capture (`classifyShellFrames`).
 */
export function frameRole(input: FrameRoleInput): FrameRoleDecision {
  const owner = input.owner;
  const labels = [owner?.id, owner?.name, owner?.className]
    .filter((v): v is string => Boolean(v))
    .join(" ");
  if (labels.split(/\s+/).some((label) => OVERLAY_PATTERN.test(label))) {
    return {
      role: "overlay",
      reason: "The frame element belongs to a digital-adoption overlay.",
    };
  }
  if (input.url.startsWith("javascript:")) {
    return {
      role: "shim",
      reason: "The frame was loaded from a javascript: URL.",
    };
  }
  // athenaOne first points `GlobalWrapper` at a `javascript:` URL that only
  // sets `document.domain`, then navigates it to the application. The src
  // attribute keeps the `javascript:` value after that navigation, so it
  // only marks a shim while the frame is still showing that stub document
  // (about:blank with nothing interactive). How Chrome reports a
  // javascript: frame's URL was not verified on a live tenant.
  if (
    input.url === "about:blank" &&
    owner?.srcAttribute?.trim().toLowerCase().startsWith("javascript:") &&
    (input.interactiveCount ?? 0) === 0
  ) {
    return {
      role: "shim",
      reason: "A javascript: stub document (src is a javascript: URL).",
    };
  }
  if (owner && !owner.rendered) {
    return {
      role: "shim",
      reason: "The frame element is not rendered (hidden or zero-size).",
    };
  }
  if (SHIM_PATTERN.test(labels)) {
    return {
      role: "shim",
      reason: `The frame element is marked as a shim (${labels}).`,
    };
  }
  if (input.url === "about:blank" && (input.elementCount ?? 0) === 0) {
    return {
      role: "placeholder",
      reason: owner?.srcAttribute
        ? "about:blank with a src assigned but not loaded yet."
        : "about:blank with no content and no src yet.",
    };
  }
  const chromeName = [owner?.id, owner?.name]
    .filter((v): v is string => Boolean(v))
    .find((v) => CHROME_FRAME_NAMES.has(v.toLowerCase()));
  if (chromeName) {
    return {
      role: "chrome",
      reason: `Navigation or status frame (${chromeName}).`,
    };
  }
  return { role: "application", reason: "Holds application content." };
}
