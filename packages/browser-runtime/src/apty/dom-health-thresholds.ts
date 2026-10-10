/**
 * DOM Health's tunable thresholds in one place (WP B2). Several were set
 * from the redacted Infor LN and athenaOne exports and general knowledge,
 * never on a live tenant; they are flagged `unverified`. Developer tools can
 * override any of them through `AppSettings.domHealthThresholdOverrides`
 * while real-tenant bundles are collected. Defaults are unchanged, an
 * override outside its bounds is rejected, and every active override is
 * listed in the audit result and the validation bundle: nothing applies
 * silently. Tuning the defaults waits for real-tenant evidence.
 */
import {
  DEFAULT_COLLECTOR_BUDGET,
  DEFAULT_VIRTUALIZATION_THRESHOLDS,
} from "@apty/dom-snapshot";

export interface ThresholdDefinition {
  default: number;
  min: number;
  max: number;
  unverified: boolean;
  description: string;
}

export const DOM_HEALTH_THRESHOLDS = {
  minSeedLinksForUrlFirst: {
    default: 2,
    min: 0,
    max: 1_000,
    unverified: true,
    description:
      "Below this many distinct link targets at the seed, the application audit traverses by click.",
  },
  minEdgesForSameUrlRatio: {
    default: 3,
    min: 1,
    max: 1_000,
    unverified: false,
    description:
      "Transitions needed before the same-URL share may switch traversal to click-first.",
  },
  sameUrlRatioForClickFirst: {
    default: 0.5,
    min: 0,
    max: 1,
    unverified: true,
    description:
      "At or above this share of same-URL transitions, traversal switches to click-first.",
  },
  maxUnreadableFrameShare: {
    default: 0.5,
    min: 0,
    max: 1,
    unverified: true,
    description:
      "Above this share of frames that could not be read, confidence is capped at LOW.",
  },
  maxUnseenVirtualizedShare: {
    default: 0.5,
    min: 0,
    max: 1,
    unverified: true,
    description:
      "Above this share of a virtualized list's declared rows left unrendered, confidence is LOW.",
  },
  collectorTimeBudgetMs: {
    default: DEFAULT_COLLECTOR_BUDGET.timeBudgetMs,
    min: 500,
    max: 60_000,
    unverified: true,
    description:
      "Per-frame collection budget; past it the frame's result is partial.",
  },
  virtualizedSpacerMinPx: {
    default: DEFAULT_VIRTUALIZATION_THRESHOLDS.spacerMinPx,
    min: 1,
    max: 1_000_000,
    unverified: true,
    description:
      "An empty child at least this tall is taken for a virtualized list's spacer.",
  },
  virtualizedScrollHeightRatio: {
    default: DEFAULT_VIRTUALIZATION_THRESHOLDS.scrollHeightRatio,
    min: 1,
    max: 1_000,
    unverified: true,
    description:
      "A list scrolling at least this many times its rendered rows' height is virtualized.",
  },
  virtualizedScrollHeightExcessPx: {
    default: DEFAULT_VIRTUALIZATION_THRESHOLDS.scrollHeightExcessPx,
    min: 0,
    max: 10_000_000,
    unverified: true,
    description: "... and scrolling at least this many pixels beyond them.",
  },
} as const satisfies Record<string, ThresholdDefinition>;

export type ThresholdName = keyof typeof DOM_HEALTH_THRESHOLDS;
export type ThresholdOverrides = Partial<Record<ThresholdName, number>>;

export interface ActiveOverride {
  name: ThresholdName;
  value: number;
  default: number;
}

export interface ResolvedThresholds {
  values: Record<ThresholdName, number>;
  active: ActiveOverride[];
  rejected: Array<{ name: string; value: unknown; reason: string }>;
}

const NAMES = Object.keys(DOM_HEALTH_THRESHOLDS) as ThresholdName[];

function isName(name: string): name is ThresholdName {
  return (NAMES as string[]).includes(name);
}

/** Validate overrides against the registry: unknown names and out-of-range or non-numeric values are rejected with a reason. */
export function resolveThresholds(overrides: unknown): ResolvedThresholds {
  const values = Object.fromEntries(
    NAMES.map((name) => [name, DOM_HEALTH_THRESHOLDS[name].default]),
  ) as Record<ThresholdName, number>;
  const active: ActiveOverride[] = [];
  const rejected: ResolvedThresholds["rejected"] = [];
  if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
    for (const [name, value] of Object.entries(overrides)) {
      if (!isName(name)) {
        rejected.push({ name, value, reason: "unknown threshold" });
        continue;
      }
      const def = DOM_HEALTH_THRESHOLDS[name];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        rejected.push({ name, value, reason: "not a number" });
      } else if (value < def.min || value > def.max) {
        rejected.push({
          name,
          value,
          reason: `outside ${def.min}–${def.max}`,
        });
      } else if (value !== def.default) {
        values[name] = value;
        active.push({ name, value, default: def.default });
      }
    }
  }
  return { values, active, rejected };
}

let current: ResolvedThresholds = resolveThresholds({});

/** Apply the overrides for the audit about to run; returns what is in effect. */
export function useThresholdOverrides(overrides: unknown): ResolvedThresholds {
  current = resolveThresholds(overrides);
  return current;
}

export function threshold(name: ThresholdName): number {
  return current.values[name];
}

export function currentThresholds(): ResolvedThresholds {
  return current;
}

/** Every threshold with its value in effect, default and whether it is unverified, for the validation bundle. */
export function thresholdReport(resolved: ResolvedThresholds = current): Array<{
  name: ThresholdName;
  value: number;
  default: number;
  unverified: boolean;
  overridden: boolean;
  description: string;
}> {
  return NAMES.map((name) => ({
    name,
    value: resolved.values[name],
    default: DOM_HEALTH_THRESHOLDS[name].default,
    unverified: DOM_HEALTH_THRESHOLDS[name].unverified,
    overridden: resolved.active.some((a) => a.name === name),
    description: DOM_HEALTH_THRESHOLDS[name].description,
  }));
}

/** The collector options the content side needs from the thresholds in effect. */
export function collectorThresholdOptions(
  resolved: ResolvedThresholds = current,
) {
  return {
    timeBudgetMs: resolved.values.collectorTimeBudgetMs,
    virtualizationThresholds: {
      spacerMinPx: resolved.values.virtualizedSpacerMinPx,
      scrollHeightRatio: resolved.values.virtualizedScrollHeightRatio,
      scrollHeightExcessPx: resolved.values.virtualizedScrollHeightExcessPx,
    },
  };
}
