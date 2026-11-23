/**
 * A KB card's four layers, one at a time (KB-RAG K27, F6), as tabs named
 * Settings, Console, Network and Support (K29, D1; "L1" to "L4" stay as
 * their accessible descriptions). The shown layer reads as numbered steps;
 * Not verified shows once on the card and marks each statement that
 * carries it. Other layers are read from the pack loaded in Options; the
 * text is rendered as text.
 */
import type { KbChunk, KbLayer } from "@apty/agent-core";
import { sharedKbIndexSource } from "@apty/browser-runtime/kb/kb-index";
import { StatusBadge } from "@apty/ui/components/ui/badge";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { cn } from "@apty/ui/lib/utils";
import { TriangleAlertIcon } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

const LAYERS: KbLayer[] = [1, 2, 3, 4];
const STEP_MARKER = /^(?:[-*•]|\d+[.)])\s+/;
const NOT_VERIFIED = /\bNOT VERIFIED\b/;

/** A layer's lines as steps, without their list markers. */
export function layerSteps(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim().replace(STEP_MARKER, ""))
    .filter(Boolean);
}

function KbSteps({ text }: { text: string }) {
  const { t } = useTranslation();
  const steps = layerSteps(text);
  if (steps.length < 2) {
    return (
      <p className="whitespace-pre-line text-sm text-foreground">
        {steps[0] ?? ""}
        {steps[0] && NOT_VERIFIED.test(steps[0]) && <StepMark t={t} />}
      </p>
    );
  }
  return (
    <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground">
      {steps.map((step, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: steps may repeat; their order is fixed
        <li key={i}>
          {step}
          {NOT_VERIFIED.test(step) && <StepMark t={t} />}
        </li>
      ))}
    </ol>
  );
}

function StepMark({ t }: { t: ReturnType<typeof useTranslation>["t"] }) {
  const label = t("kbMatches.notVerifiedStatement");
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="ml-1 inline-flex align-middle text-warning"
      data-testid="kb-step-not-verified"
    >
      <TriangleAlertIcon aria-hidden="true" className="size-3.5" />
    </span>
  );
}

export function KbLayerSwitcher({
  pageId,
  layer,
  text,
  notVerified,
}: {
  pageId: string;
  layer: KbLayer;
  text: string;
  notVerified: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
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

  const select = (next: KbLayer, focus = false) => {
    setShown(next);
    if (focus) tabs.current[next - 1]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const keys: Record<string, KbLayer> = {
      ArrowRight: ((shown % 4) + 1) as KbLayer,
      ArrowLeft: (((shown + 2) % 4) + 1) as KbLayer,
      Home: 1,
      End: 4,
    };
    const next = keys[event.key];
    if (!next) return;
    event.preventDefault();
    select(next, true);
  };

  return (
    <div className="space-y-1.5" data-testid="kb-layer-switcher">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label={t("kbMatches.layers")}
          className="flex flex-wrap items-center gap-1"
          onKeyDown={onKeyDown}
        >
          {LAYERS.map((n) => (
            <button
              key={n}
              ref={(node) => {
                tabs.current[n - 1] = node;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${n}`}
              aria-selected={n === shown}
              aria-controls={`${id}-panel`}
              aria-describedby={`${id}-desc-${n}`}
              tabIndex={n === shown ? 0 : -1}
              className={cn(
                "h-6 rounded-md px-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                n === shown
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              onClick={() => select(n)}
            >
              {t(`kbMatches.layerTab.${n}`)}
            </button>
          ))}
        </div>
        {LAYERS.map((n) => (
          <span key={n} id={`${id}-desc-${n}`} hidden>
            {t("kbMatches.layerDescription", {
              layer: n,
              name: t(`kbMatches.layerName.${n}`),
            })}
          </span>
        ))}
        {current?.notVerified && (
          <StatusBadge tone="warning">
            {t("checkPack.kbCard.notVerified")}
          </StatusBadge>
        )}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${shown}`}
        data-testid="kb-layer-text"
      >
        {current ? (
          <KbSteps text={current.text} />
        ) : chunks ? (
          <p className="text-sm text-foreground">
            {t("kbMatches.layerMissing")}
          </p>
        ) : null}
      </div>
      {shown < 4 && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => setShown((shown + 1) as KbLayer)}
        >
          {t("kbMatches.nextLayer", {
            name: t(`kbMatches.layerTab.${(shown + 1) as KbLayer}`),
          })}
        </Button>
      )}
    </div>
  );
}
