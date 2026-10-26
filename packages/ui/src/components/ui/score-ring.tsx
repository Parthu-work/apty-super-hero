import type * as React from "react";

import { cn } from "../../lib/utils";

type ScoreTone = "neutral" | "info" | "success" | "warning" | "danger";

const STROKE: Record<ScoreTone, string> = {
  neutral: "stroke-muted-foreground",
  info: "stroke-info",
  success: "stroke-success",
  warning: "stroke-warning",
  danger: "stroke-destructive",
};

const SIZE = 100;
const WIDTH = 8;
const RADIUS = (SIZE - WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The score of a check: "empty" before the first one (a dashed ring with a
 * dash), "running" while one runs, "value" with the score out of 100.
 * `label` names it for screen readers ("Score 61 out of 100").
 */
function ScoreRing({
  state,
  value = 0,
  tone = "neutral",
  label,
  caption,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  state: "empty" | "running" | "value";
  value?: number;
  tone?: ScoreTone;
  label: string;
  /** Shown under the score, e.g. "out of 100". */
  caption?: React.ReactNode;
}) {
  const score = Math.min(Math.max(Math.round(value), 0), 100);
  const arc =
    state === "value"
      ? (score / 100) * CIRCUMFERENCE
      : state === "running"
        ? CIRCUMFERENCE / 4
        : 0;
  return (
    <div
      role="img"
      aria-label={label}
      data-slot="score-ring"
      data-state={state}
      className={cn("relative size-24 shrink-0", className)}
      {...props}
    >
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden="true"
        className={cn(
          "size-full -rotate-90",
          state === "running" &&
            "animate-spin [animation-duration:1.2s] motion-reduce:animate-none",
        )}
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={state === "empty" ? 2 : WIDTH}
          strokeDasharray={state === "empty" ? "4 4" : undefined}
          className={
            state === "empty" ? "stroke-muted-foreground" : "stroke-muted"
          }
        />
        {arc > 0 ? (
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={WIDTH}
            strokeLinecap="round"
            strokeDasharray={`${arc} ${CIRCUMFERENCE}`}
            className={state === "running" ? STROKE.info : STROKE[tone]}
          />
        ) : null}
      </svg>
      <div
        aria-hidden="true"
        className="absolute inset-0 flex flex-col items-center justify-center"
      >
        {state === "value" ? (
          <>
            <span className="text-score font-semibold text-foreground">
              {score}
            </span>
            {caption ? (
              <span className="text-xs text-muted-foreground">{caption}</span>
            ) : null}
          </>
        ) : state === "empty" ? (
          <span className="h-0.5 w-5 rounded-full bg-muted-foreground" />
        ) : null}
      </div>
    </div>
  );
}

export { ScoreRing, type ScoreTone };
