/**
 * Compact, persistent investigation summary (product spec sections 6/12/
 * 13/14/15) — rendered above the chat input via the `promptExtras` slot so
 * it's always visible. Collapsed it is one 44 px row: the status, the real
 * plan count and the diagnosis confidence. Expanded it stacks the plan,
 * the components, the timeline and the diagnosis in a panel capped so the
 * composer and some of the chat stay in view.
 *
 * Renders nothing until there's something real to show (an investigation
 * has started, or evidence exists) — no placeholder/empty investigation
 * chrome for a casual one-off question.
 */
import { useChatContext } from "@apty/ui/components/chatbot";
import { StatusBadge } from "@apty/ui/components/ui/badge";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { cn } from "@apty/ui/lib/utils";
import { ChevronDownIcon, Loader2Icon } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ComponentHealthPanel } from "./component-health-panel";
import { ConfidenceBadge, DiagnosisCard } from "./diagnosis-card";
import { EvidenceTimeline } from "./evidence-timeline";
import { PlanChecklist, planCounts } from "./plan-checklist";
import { describeInvestigationStatus } from "./status-meta";
import { toneDotClass } from "./tone-classes";
import { useInvestigationData } from "./use-investigation-data";

/** The chat keeps at least this much height while the summary is expanded. */
const CHAT_KEEPS_PX = 96;

/**
 * The expanded panel's height cap: 60% of the panel at most, and never so
 * tall that the chat above it keeps less than 96 px. It is measured, as
 * what sits above the chat (the context bar or the taller live banner)
 * changes, and again whenever the panel or the chat resizes, so it settles
 * after a resize that left the composer overflowing; the CSS value holds
 * until the first measure.
 */
function useExpandedCap(open: boolean, panel: RefObject<HTMLElement | null>) {
  const [cap, setCap] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setCap(null);
      return undefined;
    }
    const chat = () => document.querySelector('[role="log"]');
    const measure = () => {
      const own = panel.current?.getBoundingClientRect().height ?? 0;
      const above = chat()?.getBoundingClientRect().height ?? 0;
      setCap(
        Math.max(
          0,
          Math.min(window.innerHeight * 0.6, own + above - CHAT_KEEPS_PX),
        ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [panel.current, chat()]) {
      if (element) observer.observe(element);
    }
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, panel]);
  return cap === null ? "max(0px, min(60vh, calc(100vh - 424px)))" : `${cap}px`;
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function InvestigationSummaryBar() {
  const { sessionId, status, sendMessage } = useChatContext();
  const { t } = useTranslation();
  const isActive =
    status === "streaming" ||
    status === "submitted" ||
    status === "executing_tools";
  const { investigation, evidence, clusters, componentHealth } =
    useInvestigationData(sessionId, isActive);
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const panelId = useId();
  const maxHeight = useExpandedCap(open, panel);

  const hasContent = Boolean(investigation) || evidence.length > 0;
  if (!hasContent) {
    return null;
  }

  const meta = describeInvestigationStatus(investigation?.status ?? "idle", t);
  const plan = investigation?.plan;
  const counts = plan ? planCounts(plan) : undefined;
  const warningCount = componentHealth.filter(
    (c) => c.state === "warning" || c.state === "error",
  ).length;

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !open) return;
    event.stopPropagation();
    setOpen(false);
    toggle.current?.focus();
  };

  return (
    <section
      aria-label={t("investigation.summary.title")}
      onKeyDown={handleKeyDown}
      className="mb-2 overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="flex min-h-11 items-center gap-2 pl-3 pr-1">
        {meta.inProgress ? (
          <Loader2Icon
            aria-hidden="true"
            className="size-4 shrink-0 animate-spin text-info motion-reduce:animate-none"
          />
        ) : (
          <span
            aria-hidden="true"
            className={cn(
              "size-2 shrink-0 rounded-full",
              toneDotClass(meta.tone),
            )}
          />
        )}
        <p className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium text-foreground">{meta.label}</span>
          {counts && (
            <span className="text-xs text-muted-foreground">
              {` · ${t("investigation.summary.steps", counts)}`}
            </span>
          )}
        </p>
        {warningCount > 0 && (
          <StatusBadge tone="warning">
            {t(
              warningCount === 1
                ? "investigation.summary.needsAttentionOne"
                : "investigation.summary.needsAttentionMany",
              { count: warningCount },
            )}
          </StatusBadge>
        )}
        {investigation?.diagnosis && (
          <ConfidenceBadge confidence={investigation.confidence ?? "unknown"} />
        )}
        <Button
          ref={toggle}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={t(
            open
              ? "investigation.summary.collapse"
              : "investigation.summary.expand",
          )}
          onClick={() => setOpen(!open)}
        >
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              "transition-transform duration-200 motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </Button>
      </div>
      {open && (
        <section
          ref={panel}
          id={panelId}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take focus to scroll by keyboard.
          tabIndex={0}
          aria-label={t("investigation.summary.details")}
          style={{ maxHeight }}
          className="space-y-4 overflow-y-auto border-t border-border p-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
        >
          {investigation?.userProblem && (
            <p className="text-xs text-muted-foreground">
              {`${t("investigation.summary.investigating")} `}
              <span className="text-foreground">
                {investigation.userProblem}
              </span>
            </p>
          )}
          <Section title={t("investigation.summary.plan")}>
            <PlanChecklist plan={plan} />
          </Section>
          <Section title={t("investigation.summary.components")}>
            <ComponentHealthPanel components={componentHealth} />
          </Section>
          <Section
            title={t("investigation.summary.timeline")}
            aside={
              <span className="text-xs text-muted-foreground">
                {t("investigation.summary.evidence", {
                  count: evidence.length,
                })}
              </span>
            }
          >
            <EvidenceTimeline clusters={clusters} />
          </Section>
          <Section title={t("investigation.summary.diagnosis")}>
            <DiagnosisCard
              investigation={investigation}
              onVerify={() =>
                void sendMessage(
                  "Please verify the current diagnosis by re-checking the relevant evidence.",
                )
              }
            />
          </Section>
        </section>
      )}
    </section>
  );
}
