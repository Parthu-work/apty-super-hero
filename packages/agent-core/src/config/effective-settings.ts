/**
 * The settings the extension acts on (KB-RAG K22, S2 and S5): the SE's own
 * settings with the organization policy applied over them. Pure; the
 * browser helper `loadEffectiveSettings()` feeds it what is stored.
 */
import {
  customModelsAllowed,
  type OrgPolicyPreset,
  type OrgPolicyState,
  policyOf,
} from "./org-policy.js";
import type { AppSettings, RedactionModeSetting } from "./settings.js";

/** Why the SE cannot choose a weaker redaction mode. */
export type RedactionFloorReason = "policy" | "kb-pack";

export interface RedactionFloor {
  mode: Exclude<RedactionModeSetting, "off">;
  reason: RedactionFloorReason;
}

export interface EffectiveSettings {
  settings: AppSettings;
  /** Fields the policy sets: read-only in Options, and a write to one is ignored. */
  locked: ReadonlySet<keyof AppSettings>;
  /** The weakest redaction mode allowed, when anything forbids "off". */
  redactionFloor?: RedactionFloor;
  /** Whether the SE may add BYOK custom models. */
  customModelsAllowed: boolean;
  policy: OrgPolicyState;
}

export interface EffectiveSettingsInputs {
  /** A KB pack whose `source.site` does not end in `.invalid` is loaded (D-SEC3). */
  nonDemoPackLoaded?: boolean;
}

const STRENGTH: Record<RedactionModeSetting, number> = {
  off: 0,
  standard: 1,
  strict: 2,
};

/** "strict" when unset or unknown, as the redaction code reads it. */
function storedRedaction(value: unknown): RedactionModeSetting {
  return value === "standard" || value === "off" ? value : "strict";
}

/** The stronger of two modes: strict, then standard, then off. */
export function strongerRedaction(
  a: RedactionModeSetting,
  b: RedactionModeSetting,
): RedactionModeSetting {
  return STRENGTH[a] >= STRENGTH[b] ? a : b;
}

/** Whether a pack is a demo pack: its Confluence site is under `.invalid` (D-SEC1). */
export function isDemoKbPack(pack: { site: string }): boolean {
  return /\.invalid\.?$/i.test(pack.site.trim());
}

/** Whether a model config is one the SE added, not a built-in provider entry. */
export function isUserCustomModel(model: { id: string }): boolean {
  return !model.id.startsWith("builtin-");
}

function floorOf(
  state: OrgPolicyState,
  nonDemoPackLoaded: boolean,
): RedactionFloor | undefined {
  const policyFloor = policyOf(state)?.redactionFloor;
  if (policyFloor === "strict") return { mode: "strict", reason: "policy" };
  if (policyFloor === "standard") return { mode: "standard", reason: "policy" };
  return nonDemoPackLoaded
    ? { mode: "standard", reason: "kb-pack" }
    : undefined;
}

/**
 * `local` with the policy applied: the preset written in and locked, the
 * redaction mode raised to the floor (locked when the floor is strict, the
 * only mode left), and the SE's own custom models dropped when the policy
 * does not allow them. With no policy and no non-demo pack, `local` as it is.
 */
export function effectiveSettings(
  local: AppSettings,
  state: OrgPolicyState,
  { nonDemoPackLoaded = false }: EffectiveSettingsInputs = {},
): EffectiveSettings {
  const settings: AppSettings = { ...local };
  const locked = new Set<keyof AppSettings>();
  const preset: OrgPolicyPreset = policyOf(state)?.preset ?? {};
  for (const [key, value] of Object.entries(preset) as [
    keyof OrgPolicyPreset,
    string,
  ][]) {
    (settings as Record<string, unknown>)[key] = value;
    locked.add(key);
  }

  const redactionFloor = floorOf(state, nonDemoPackLoaded);
  if (redactionFloor) {
    settings.redactionMode = strongerRedaction(
      storedRedaction(local.redactionMode),
      redactionFloor.mode,
    );
    if (redactionFloor.mode === "strict") locked.add("redactionMode");
  }

  const allowCustom = customModelsAllowed(state);
  if (!allowCustom && settings.customModels) {
    settings.customModels = settings.customModels.filter(
      (model) => !isUserCustomModel(model),
    );
  }

  return {
    settings,
    locked,
    ...(redactionFloor ? { redactionFloor } : {}),
    customModelsAllowed: allowCustom,
    policy: state,
  };
}

/**
 * What to store when Options (or any writer) saves `next`: a locked field
 * keeps its stored value, and custom models the policy forbids are not
 * kept. `ignored` names the locked fields the write tried to change to
 * something other than their stored or effective value (writing back the
 * settings as read is not an attempt).
 */
export function settingsForWrite(
  stored: AppSettings,
  next: AppSettings,
  effective: Pick<
    EffectiveSettings,
    "settings" | "locked" | "customModelsAllowed"
  >,
): { settings: AppSettings; ignored: (keyof AppSettings)[] } {
  const settings: AppSettings = { ...next };
  const kept = settings as Record<string, unknown>;
  const ignored: (keyof AppSettings)[] = [];
  for (const key of effective.locked) {
    if (next[key] !== stored[key] && next[key] !== effective.settings[key]) {
      ignored.push(key);
    }
    if (stored[key] === undefined) delete kept[key];
    else kept[key] = stored[key];
  }
  if (!effective.customModelsAllowed && settings.customModels) {
    settings.customModels = settings.customModels.filter(
      (model) => !isUserCustomModel(model),
    );
  }
  return { settings, ignored };
}
