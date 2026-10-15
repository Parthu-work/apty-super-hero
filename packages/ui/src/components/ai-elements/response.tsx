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

const rehypePlugins = [
  ...Object.values(defaultRehypePlugins),
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
