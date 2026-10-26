import { type ReactNode, useEffect, useRef } from "react";
import { type ToolPage, useNavigation } from "../../state/navigation-store";

/**
 * The tool pages, over the whole panel. Every page stays mounted, hidden
 * and inert while another is shown or none is, so leaving a page keeps
 * its state and never stops its job. While a page is open the chat under
 * it is inert and hidden from assistive technology, and keeps streaming.
 */
export function PageLayer({
  pages,
}: {
  pages: ReadonlyArray<{ id: ToolPage; label: string; content: ReactNode }>;
}) {
  const { page } = useNavigation();
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = layerRef.current;
    const siblings = [...(layer?.parentElement?.children ?? [])].filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== layer,
    );
    for (const sibling of siblings) {
      sibling.inert = page !== null;
      if (page !== null) sibling.setAttribute("aria-hidden", "true");
      else sibling.removeAttribute("aria-hidden");
    }
  }, [page]);

  return (
    <div
      ref={layerRef}
      hidden={page === null}
      data-testid="page-layer"
      className="absolute inset-0 z-30 bg-background"
    >
      {pages.map(({ id, label, content }) => (
        <section
          key={id}
          aria-label={label}
          hidden={page !== id}
          inert={page !== id}
          className="flex h-full flex-col"
        >
          {content}
        </section>
      ))}
    </div>
  );
}
