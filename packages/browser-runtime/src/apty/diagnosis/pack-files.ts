import { filesFor } from "./content-not-visible.js";
import { CONTENT_FILES_4X } from "./content-not-visible-4x.js";
import { type ContentKind, KINDS } from "./types.js";
import { WIDGET_FILES } from "./widget-not-visible.js";
import { WIDGET_FILES_4X } from "./widget-not-visible-4x.js";

/** Every file a check pack reads, so a setting that hides them can be named before a check runs. */
export const CHECK_PACK_FILES: readonly string[] = [
  ...new Set([
    ...(Object.keys(KINDS) as ContentKind[]).flatMap(filesFor),
    ...WIDGET_FILES,
    ...WIDGET_FILES_4X,
    ...CONTENT_FILES_4X,
  ]),
];
