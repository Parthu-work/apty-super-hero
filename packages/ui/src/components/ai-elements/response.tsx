"use client";

import { type ComponentProps, memo, useEffect, useRef } from "react";
import {
  defaultRehypePlugins,
  defaultUrlTransform,
  Streamdown,
  type UrlTransform,
} from "streamdown";
import { isLocalImageUrl, rehypeBlockRemoteMedia } from "../../lib/safe-media";
import { cn } from "../../lib/utils";

type ResponseProps = ComponentProps<typeof Streamdown>;

type PluginEntry = (typeof defaultRehypePlugins)[string];

/**
 * Streamdown's sanitize schema allows only http(s) image sources, which
 * drops the chat's own data: screenshots. It may keep data: and blob: here
 * because rehypeBlockRemoteMedia, which runs last, removes every image that
 * isn't a local data:image or blob: URL.
 */
function withLocalImageSources(entry: PluginEntry): PluginEntry {
  if (!Array.isArray(entry)) return entry;
  const [plugin, schema] = entry as [unknown, Record<string, unknown>];
  const protocols = (schema?.protocols ?? {}) as Record<string, string[]>;
  return [
    plugin,
    {
      ...schema,
      protocols: {
        ...protocols,
        src: [...(protocols.src ?? []), "data", "blob"],
      },
    },
  ] as unknown as PluginEntry;
}

const rehypePlugins = [
  ...Object.entries(defaultRehypePlugins).map(([name, entry]) =>
    name === "sanitize" ? withLocalImageSources(entry) : entry,
  ),
  rehypeBlockRemoteMedia,
];

const urlTransform: UrlTransform = (url, key, node) => {
  if (key === "src") return isLocalImageUrl(url) ? url : "";
  return defaultUrlTransform(url, key, node);
};

/**
 * 6A's Markdown: Body paragraphs 8 px apart; headings at Title (h1, h2)
 * or Label size, never larger; lists indented 20 px; inline code and code
 * blocks in mono on surface2; tables and code blocks scroll sideways inside
 * the message; links in the accent colour, underlined on hover and focus.
 * Tailwind does not scan Streamdown's package, so some of its own layout
 * classes are missing: the code block's actions are pinned top right and
 * the table's scroller gets its overflow here.
 */
const MARKDOWN = [
  "space-y-2 text-sm text-foreground",
  "[&_[data-streamdown^=heading-]]:mt-4 [&_[data-streamdown^=heading-]]:mb-1 [&_[data-streamdown^=heading-]]:font-semibold",
  "[&_[data-streamdown=heading-1]]:text-title [&_[data-streamdown=heading-2]]:text-title",
  "[&_[data-streamdown=heading-3]]:text-sm [&_[data-streamdown=heading-4]]:text-sm [&_[data-streamdown=heading-5]]:text-sm [&_[data-streamdown=heading-6]]:text-sm",
  "[&_[data-streamdown=ordered-list]]:list-outside [&_[data-streamdown=ordered-list]]:pl-5 [&_[data-streamdown=unordered-list]]:list-outside [&_[data-streamdown=unordered-list]]:pl-5",
  "[&_[data-streamdown=list-item]]:py-0.5",
  "[&_[data-streamdown=inline-code]]:rounded-[4px] [&_[data-streamdown=inline-code]]:bg-muted [&_[data-streamdown=inline-code]]:px-1 [&_[data-streamdown=inline-code]]:py-0 [&_[data-streamdown=inline-code]]:text-small",
  "[&_[data-streamdown=link]]:font-normal [&_[data-streamdown=link]]:text-info [&_[data-streamdown=link]]:no-underline [&_[data-streamdown=link]]:underline-offset-4 [&_[data-streamdown=link]:hover]:underline [&_[data-streamdown=link]:focus-visible]:underline",
  "[&_[data-streamdown=code-block]]:relative [&_[data-streamdown=code-block]]:my-2 [&_[data-streamdown=code-block]]:rounded-md [&_[data-streamdown=code-block]]:border-border [&_[data-streamdown=code-block]]:bg-muted",
  "[&_[data-streamdown=code-block]>:has(>[data-streamdown=code-block-actions])]:absolute [&_[data-streamdown=code-block]>:has(>[data-streamdown=code-block-actions])]:top-1 [&_[data-streamdown=code-block]>:has(>[data-streamdown=code-block-actions])]:right-1",
  "[&_[data-streamdown=code-block-body]]:overflow-x-auto [&_[data-streamdown=code-block-body]]:border-0 [&_[data-streamdown=code-block-body]]:bg-transparent [&_[data-streamdown=code-block-body]]:px-2 [&_[data-streamdown=code-block-body]]:pt-0 [&_[data-streamdown=code-block-body]]:pb-1 [&_[data-streamdown=code-block-body]]:font-mono [&_[data-streamdown=code-block-body]]:text-small",
  "[&_[data-streamdown=table-wrapper]]:my-2 [&_[data-streamdown=table-wrapper]]:bg-card [&_[data-streamdown=table-wrapper]>div:last-child]:overflow-x-auto",
  "[&_[data-streamdown=table-wrapper]>div:last-child]:outline-none [&_[data-streamdown=table-wrapper]>div:last-child:focus-visible]:outline-2 [&_[data-streamdown=table-wrapper]>div:last-child:focus-visible]:outline-offset-2 [&_[data-streamdown=table-wrapper]>div:last-child:focus-visible]:outline-ring",
  "[&_[data-streamdown=code-block-body]]:outline-none [&_[data-streamdown=code-block-body]:focus-visible]:outline-2 [&_[data-streamdown=code-block-body]:focus-visible]:outline-offset-2 [&_[data-streamdown=code-block-body]:focus-visible]:outline-ring",
].join(" ");

/** The boxes that scroll sideways: a table's scroller and a code block's body. */
const SCROLLERS =
  '[data-streamdown="table-wrapper"] > div:last-child, [data-streamdown="code-block-body"]';

/**
 * A box that scrolls must be reachable by keyboard, and these hold only
 * text. Streamdown renders them, and code bodies late (after highlighting),
 * so each one gets a tab stop as it appears.
 */
function useFocusableScrollers() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const apply = () => {
      for (const box of root.querySelectorAll<HTMLElement>(SCROLLERS)) {
        if (!box.hasAttribute("tabindex")) box.tabIndex = 0;
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return ref;
}

export const Response = memo(
  ({ className, ...props }: ResponseProps) => {
    const ref = useFocusableScrollers();
    return (
      <div ref={ref} className="contents">
        <Streamdown
          className={cn(
            "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
            MARKDOWN,
            className,
          )}
          {...props}
          rehypePlugins={rehypePlugins}
          urlTransform={urlTransform}
        />
      </div>
    );
  },
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);

Response.displayName = "Response";
