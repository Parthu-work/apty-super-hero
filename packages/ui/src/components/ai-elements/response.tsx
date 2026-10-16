"use client";

import { type ComponentProps, memo } from "react";
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

export const Response = memo(
  ({ className, ...props }: ResponseProps) => (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      {...props}
      rehypePlugins={rehypePlugins}
      urlTransform={urlTransform}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);

Response.displayName = "Response";
