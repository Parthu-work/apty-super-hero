/**
 * Model and page text is untrusted: a remote image, stylesheet or frame in
 * it would make the extension page fetch an attacker URL with no click,
 * carrying whatever the model put in the query string. Only data: and blob:
 * sources may load; everything else is removed or shown as text.
 */

const LOCAL_IMAGE = /^(data:image\/[a-z0-9.+-]+[;,]|blob:)/i;

export function isLocalImageUrl(url: unknown): url is string {
  return typeof url === "string" && LOCAL_IMAGE.test(url.trim());
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const DROPPED_ELEMENTS = new Set([
  "applet",
  "audio",
  "base",
  "embed",
  "feimage",
  "frame",
  "frameset",
  "iframe",
  "image",
  "link",
  "meta",
  "object",
  "portal",
  "script",
  "source",
  "style",
  "track",
  "use",
  "video",
]);

const UNWRAPPED_ELEMENTS = new Set(["picture"]);

const ALWAYS_REMOVED_PROPERTIES = [
  "srcSet",
  "imageSrcSet",
  "poster",
  "background",
  "dynsrc",
  "lowsrc",
  "longDesc",
  "ping",
  "data",
  "xLinkHref",
];

const STYLE_FETCH = /url\s*\(|image-set|@import/i;

function blockedImageText(node: HastNode, label: string): HastNode {
  const alt = node.properties?.alt;
  const name = typeof alt === "string" && alt.trim() ? alt.trim() : label;
  return {
    type: "element",
    tagName: "span",
    properties: { dataBlockedImage: "true" },
    children: [{ type: "text", value: `[${name}]` }],
  };
}

function sanitizeChildren(children: HastNode[], label: string): HastNode[] {
  const out: HastNode[] = [];
  for (const child of children) {
    out.push(...sanitizeNode(child, label));
  }
  return out;
}

function sanitizeNode(node: HastNode, label: string): HastNode[] {
  if (node.type === "element" && node.tagName) {
    const tag = node.tagName.toLowerCase();
    if (DROPPED_ELEMENTS.has(tag)) return [];
    if (UNWRAPPED_ELEMENTS.has(tag)) {
      return sanitizeChildren(node.children ?? [], label);
    }
    const props = node.properties ?? {};
    for (const key of ALWAYS_REMOVED_PROPERTIES) delete props[key];
    if (typeof props.style === "string" && STYLE_FETCH.test(props.style)) {
      delete props.style;
    }
    if ("src" in props && !isLocalImageUrl(props.src)) {
      if (tag === "img") return [blockedImageText(node, label)];
      delete props.src;
    }
    node.properties = props;
  }
  if (node.children) {
    node.children = sanitizeChildren(node.children, label);
  }
  return [node];
}

/** A rehype plugin; run it after every other rehype plugin. */
export function rehypeBlockRemoteMedia(options?: {
  blockedImageLabel?: string;
}) {
  const label = options?.blockedImageLabel ?? "image";
  return (tree: HastNode) => {
    if (tree.children) tree.children = sanitizeChildren(tree.children, label);
  };
}
