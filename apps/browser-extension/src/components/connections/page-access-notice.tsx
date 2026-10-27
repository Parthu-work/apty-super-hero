import { Notice } from "@apty/ui/components/ui/notice";
import type { ReactNode } from "react";

/**
 * Why a tool can't run on the page in front: a warning at the top of its
 * page, which the disabled primary button points at with
 * `aria-describedby`. The chat stays usable.
 */
export function PageAccessNotice({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  /** The reason and, when there is one, the fix. */
  children: ReactNode;
}) {
  return (
    <Notice id={id} tone="warning" title={title} className="mb-4">
      {children}
    </Notice>
  );
}
