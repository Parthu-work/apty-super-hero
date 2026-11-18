/**
 * A KB card's four layers, one at a time (KB-RAG K27, F6): the shown
 * layer first, and a button per layer so the SE can read settings, Console
 * and Elements, network data or support without leaving the card. Other
 * layers are read from the pack loaded in Options; the text is rendered as
 * text.
 */
import type { KbChunk, KbLayer } from "@apty/agent-core";
import { sharedKbIndexSource } from "@apty/browser-runtime/kb/kb-index";
import { StatusBadge } from "@apty/ui/components/ui/badge";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { useEffect, useState } from "react";

const LAYERS: KbLayer[] = [1, 2, 3, 4];

export function KbLayerSwitcher({
  pageId,
  layer,
  text,
  notVerified,
  render = (value) => value,
}: {
  pageId: string;
  layer: KbLayer;
  text: string;
  notVerified: boolean;
  /** How the shown text is cut, e.g. to an excerpt. */
  render?: (text: string) => string;
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState<KbLayer>(layer);
  const [chunks, setChunks] = useState<KbChunk[] | undefined>();
  useEffect(() => {
    if (shown === layer || chunks) return undefined;
    let live = true;
    sharedKbIndexSource()
      .current()
      .then((index) => live && setChunks(index?.cardChunks(pageId) ?? []))
      .catch(() => live && setChunks([]));
    return () => {
      live = false;
    };
  }, [shown, layer, chunks, pageId]);
  const other = chunks?.find((chunk) => chunk.layer === shown);
  const current =
    shown === layer ? { text, notVerified } : other ? other : undefined;
  return (
    <div className="space-y-1" data-testid="kb-layer-switcher">
      <div
        role="group"
        aria-label={t("kbMatches.layers")}
        className="flex flex-wrap items-center gap-1"
      >
        {LAYERS.map((n) => (
          <Button
            key={n}
            type="button"
            size="sm"
            variant={n === shown ? "secondary" : "ghost"}
            aria-pressed={n === shown}
            aria-label={t("kbMatches.layerButtonName", {
              layer: n,
              name: t(`kbMatches.layerName.${n}`),
            })}
            className="h-6 px-2 text-xs"
            onClick={() => setShown(n)}
          >
            {t("kbMatches.layerButton", { layer: n })}
          </Button>
        ))}
        {current?.notVerified && (
          <StatusBadge tone="warning">
            {t("checkPack.kbCard.notVerified")}
          </StatusBadge>
        )}
      </div>
      <p className="text-xs text-muted-foreground" data-testid="kb-layer-name">
        {t("kbMatches.layerTitled", {
          layer: shown,
          name: t(`kbMatches.layerName.${shown}`),
        })}
      </p>
      <p
        className="whitespace-pre-line text-sm text-foreground"
        data-testid="kb-layer-text"
      >
        {current
          ? shown === layer
            ? render(current.text)
            : current.text
          : chunks
            ? t("kbMatches.layerMissing")
            : ""}
      </p>
      {shown < 4 && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => setShown((shown + 1) as KbLayer)}
        >
          {t("kbMatches.nextLayer", {
            name: t(`kbMatches.layerName.${(shown + 1) as KbLayer}`),
          })}
        </Button>
      )}
    </div>
  );
}
