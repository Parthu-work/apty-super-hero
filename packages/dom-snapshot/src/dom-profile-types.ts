/**
 * The DOM profile: what the console script SEs run today prints (schema
 * 1), plus what the extension's own collector adds (schema 2). Nested
 * nodes (a shadow root, a frame) carry only the sections their content
 * produced: the script writes a key the first time it has something to put
 * in it. Produced by `collectDomProfile`, read by the DOM Config engine.
 */
import type { ExcludedRootSummary } from "./ignored-roots.js";

export interface DomProfileNode {
  tags?: Record<string, number>;
  attributes?: Record<string, Record<string, number>>;
  maxZIndex?: number;
  shadowRoots?: Record<string, DomProfileNode>;
  iframes?: Record<string, DomProfileFrame>;
}

export interface DomProfileFrame extends DomProfileNode {
  isCrossOrigin?: boolean;
}

export interface DomProfile extends DomProfileNode {
  tags: Record<string, number>;
  attributes: Record<string, Record<string, number>>;
}

export interface ZIndexSource {
  value: number;
  tag: string;
  id?: string;
  class?: string;
  /** The z-index came from the element's own `style` attribute. */
  inline?: boolean;
}

export type FrameUnreadableReason =
  | "blocked-cross-origin"
  | "about:blank"
  | "srcdoc"
  | "not-loaded"
  /** Its own content script did not answer. */
  | "unreachable"
  /** The browser reported that the frame failed to load. */
  | "navigation-error"
  /** An extension's or an overlay vendor's frame, left out on purpose. */
  | "noise";

export interface FrameRecord {
  /** The `src` attribute as written, as a URL shape. */
  src: string;
  resolvedSrc?: string;
  crossOrigin: boolean;
  readable: boolean;
  reason?: FrameUnreadableReason;
  /** The browser's id for the frame, when known. */
  frameId?: number;
}

export interface ShadowHostRecord {
  hostTag: string;
  /** `closed` only when the root was actually read through the extension API; the collector never guesses one. */
  mode: "open" | "closed" | "unknown";
}

export interface MutationBurst {
  durationMs: number;
  mutationCount: number;
}

export interface BehaviorProbe {
  ran: boolean;
  windowMs: number;
  mutationBursts: MutationBurst[];
  burstGapsMs: number[];
  /** Events per second, only for events that actually fired. */
  eventRates: Record<string, number>;
  ranToCompletion: boolean;
}

export interface ProfileMeta {
  urlShape?: string;
  viewport?: { width: number; height: number };
  aptyPresent?: boolean;
  extensionNoisePresent?: boolean;
  elementCount?: number;
  durationMs?: number;
  partial?: boolean;
  /** Why the collection is partial: a ceiling, the time budget, an unanswered frame. */
  partialReasons?: string[];
  /** Attribute names whose values the collector cut to its caps. */
  truncatedAttributes?: string[];
  /** How many values were longer than the collector keeps. */
  cutValues?: number;
  /** Closed shadow roots can be read here (`chrome.dom.openOrClosedShadowRoot`); without it a closed root is invisible. */
  closedShadowRootsVisible?: boolean;
  /** Noise subtrees left out of the profile, per matcher. */
  excludedRoots?: ExcludedRootSummary[];
}

/** One element identified without its attribute values: a structural fingerprint and, per attribute name, a hash of the value. */
export interface ElementFingerprintRecord {
  fingerprint: string;
  attributeHashes: Record<string, string>;
}

export interface DomProfileV2 extends DomProfile {
  schema?: 2;
  zIndexSources?: ZIndexSource[];
  frames?: FrameRecord[];
  shadow?: ShadowHostRecord[];
  probe?: BehaviorProbe;
  meta?: ProfileMeta;
  elementFingerprints?: ElementFingerprintRecord[];
}
