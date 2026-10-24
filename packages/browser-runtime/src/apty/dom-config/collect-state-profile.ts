/**
 * One state of a tab as one DOM profile (R2.2): every frame is profiled by
 * its own content-script responder, by frameId, cross-origin frames
 * included (D15), and the frame profiles are nested the way the console
 * script nests readable frames. A frame that could not be read keeps the
 * script's `Cross Origin N (src: …)` key with no content, and the
 * inventory says why. Extension and overlay frames are listed, never
 * read.
 */
import {
  type BehaviorProbe,
  DEFAULT_PROBE_WINDOW_MS,
  type DomProfileFrame,
  type DomProfileNode,
  type DomProfileV2,
  type ExcludedRootSummary,
  type FrameRecord,
  mergeExcludedRoots,
  profileEntry,
  profileMap,
  toUrlShape,
} from "@apty/dom-snapshot";
import { collectFrameOwnersByFrameId } from "../frame-audit.js";
import {
  type FrameOwnerAttributes,
  type FrameRoleDecision,
  frameRole,
} from "../frame-identity.js";
import {
  type AuditFrame,
  getFrameTree,
  sendFrameMessage,
} from "../frame-tree.js";

export interface DomConfigFrameInventoryEntry {
  frameId: number;
  parentFrameId: number;
  urlShape: string;
  role: FrameRoleDecision["role"];
  roleReason: string;
  analyzed: boolean;
  /** `analyzed`, or why the frame was not read. */
  reason: string;
  elementCount: number | null;
  partial: boolean;
}

export interface StateProfileResult {
  profile: DomProfileV2;
  inventory: DomConfigFrameInventoryEntry[];
}

export type StateProfileOutcome =
  | { available: true; result: StateProfileResult }
  | { available: false; error: string };

export interface CollectStateProfileOptions {
  ignoredRoots?: readonly string[];
  /** Per-frame collector time budget; the collector's own default otherwise. */
  timeBudgetMs?: number;
}

export interface CollectedFrame {
  frame: AuditFrame;
  owner: FrameOwnerAttributes | null;
  profile: DomProfileV2 | null;
  /** Why `profile` is null. */
  failure: FrameRecord["reason"] | null;
  error?: string;
}

const PROFILE_TIMEOUT_MS = 8_000;
const PROBE_MESSAGE_TIMEOUT_MS = 2_000;

/** A frame showing another extension's page, or one inside an overlay vendor's content: listed, never read. */
function noiseFrame(
  frame: AuditFrame,
  owner: FrameOwnerAttributes | null,
): boolean {
  return /^chrome-extension:/i.test(frame.url) || Boolean(owner?.ignoredBy);
}

/** Elements a frame's body holds, which is what `frameRole` judges a placeholder by. */
function contentElements(profile: DomProfileV2 | null): number | null {
  if (!profile) return null;
  const tags = profile.tags;
  return (
    (profile.meta?.elementCount ?? 0) -
    (tags.html ?? 0) -
    (tags.head ?? 0) -
    (tags.body ?? 0)
  );
}

function addCounts(
  target: Record<string, number>,
  source: Record<string, number>,
) {
  for (const [key, count] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + count;
  }
}

function childMap<K extends "tags" | "attributes" | "shadowRoots" | "iframes">(
  node: DomProfileNode,
  key: K,
): NonNullable<DomProfileNode[K]> {
  if (!node[key]) node[key] = profileMap() as DomProfileNode[K];
  return node[key] as NonNullable<DomProfileNode[K]>;
}

/** The child frame entry `key` of `node`, created on first use. */
function frameEntry(node: DomProfileNode, key: string): DomProfileFrame {
  return profileEntry(childMap(node, "iframes"), key, () => ({}));
}

/** `source` added into `target`, as if their elements had been one scope. */
function mergeNode(target: DomProfileNode, source: DomProfileNode): void {
  if (source.tags) addCounts(childMap(target, "tags"), source.tags);
  for (const [name, values] of Object.entries(source.attributes ?? {})) {
    addCounts(
      profileEntry(childMap(target, "attributes"), name, () =>
        profileMap<number>(),
      ),
      values,
    );
  }
  if (source.maxZIndex !== undefined) {
    target.maxZIndex = Math.max(target.maxZIndex ?? 0, source.maxZIndex);
  }
  for (const [tag, root] of Object.entries(source.shadowRoots ?? {})) {
    mergeNode(
      profileEntry(childMap(target, "shadowRoots"), tag, () => ({})),
      root,
    );
  }
  for (const [key, frame] of Object.entries(source.iframes ?? {})) {
    const entry = frameEntry(target, key);
    entry.isCrossOrigin = Boolean(entry.isCrossOrigin || frame.isCrossOrigin);
    mergeNode(entry, frame);
  }
}

/** The fields the console script writes, deep-copied into fresh maps. */
function scriptFields(profile: DomProfileV2): DomProfileNode {
  const node: DomProfileNode = {};
  mergeNode(node, {
    tags: profile.tags,
    attributes: profile.attributes,
    ...(profile.maxZIndex !== undefined
      ? { maxZIndex: profile.maxZIndex }
      : {}),
    ...(profile.shadowRoots ? { shadowRoots: profile.shadowRoots } : {}),
  });
  return node;
}

function specialDocument(url: string): FrameRecord["reason"] | undefined {
  if (url === "about:blank") return "about:blank";
  if (url === "about:srcdoc") return "srcdoc";
  return undefined;
}

/**
 * The frames of one state as one profile, the top frame's at the root and
 * each child under its parent's `iframes`, keyed by its URL shape; an
 * unread child keeps the script's `Cross Origin N (src: …)` key.
 */
function mergeStateProfile(frames: CollectedFrame[]): StateProfileResult {
  const sorted = [...frames].sort(
    (a, b) =>
      a.frame.depth - b.frame.depth || a.frame.frameId - b.frame.frameId,
  );
  const top = sorted.find((f) => f.frame.parentFrameId < 0) ?? sorted[0];
  const root: DomProfileNode = top?.profile
    ? scriptFields(top.profile)
    : { tags: profileMap(), attributes: profileMap() };
  const nodes = new Map<number, DomProfileNode>();
  if (top) nodes.set(top.frame.frameId, root);
  const crossOriginCounts = new Map<number, number>();
  const records: FrameRecord[] = [];
  const read = sorted.filter((f) => f.profile);
  const topOrigin = top?.frame.origin ?? null;

  for (const entry of sorted) {
    if (entry === top) continue;
    const { frame, owner, profile } = entry;
    const parent = nodes.get(frame.parentFrameId);
    const crossOrigin = frame.origin === null || frame.origin !== topOrigin;
    const src = toUrlShape(owner?.srcAttribute ?? frame.url);
    records.push({
      src,
      resolvedSrc: toUrlShape(frame.url),
      crossOrigin,
      readable: Boolean(profile),
      ...(profile
        ? specialDocument(frame.url)
          ? { reason: specialDocument(frame.url) }
          : {}
        : { reason: entry.failure ?? "unreachable" }),
      frameId: frame.frameId,
    });
    if (!parent) continue;
    let key = toUrlShape(frame.url);
    if (!profile && crossOrigin) {
      const n = (crossOriginCounts.get(frame.parentFrameId) ?? 0) + 1;
      crossOriginCounts.set(frame.parentFrameId, n);
      key = `Cross Origin ${n} (src: ${src})`;
    }
    const node = frameEntry(parent, key);
    node.isCrossOrigin = Boolean(node.isCrossOrigin || crossOrigin);
    if (profile) mergeNode(node, scriptFields(profile));
    nodes.set(frame.frameId, node);
  }

  const metas = read.map((f) => f.profile!.meta ?? {});
  const unreadApplicationFrames = sorted.filter(
    (f) => !f.profile && f.failure === "unreachable",
  );
  const partialReasons = [
    ...new Set([
      ...metas.flatMap((m) => m.partialReasons ?? []),
      ...unreadApplicationFrames.map(
        (f) =>
          `Frame ${f.frame.frameId} did not answer: ${f.error ?? "no reason given"}`,
      ),
    ]),
  ];
  const topMeta = top?.profile?.meta ?? {};
  const profile: DomProfileV2 = {
    schema: 2,
    tags: root.tags ?? profileMap(),
    attributes: root.attributes ?? profileMap(),
    ...(root.maxZIndex !== undefined ? { maxZIndex: root.maxZIndex } : {}),
    ...(root.shadowRoots ? { shadowRoots: root.shadowRoots } : {}),
    ...(root.iframes ? { iframes: root.iframes } : {}),
    zIndexSources: read.flatMap((f) => f.profile!.zIndexSources ?? []),
    frames: records,
    shadow: read.flatMap((f) => f.profile!.shadow ?? []),
    meta: {
      ...(topMeta.urlShape !== undefined ? { urlShape: topMeta.urlShape } : {}),
      ...(topMeta.viewport ? { viewport: topMeta.viewport } : {}),
      aptyPresent: metas.some((m) => m.aptyPresent),
      extensionNoisePresent:
        metas.some((m) => m.extensionNoisePresent) ||
        sorted.some(
          (f) =>
            f.failure === "noise" && /^chrome-extension:/i.test(f.frame.url),
        ),
      elementCount: metas.reduce((sum, m) => sum + (m.elementCount ?? 0), 0),
      durationMs: Math.max(0, ...metas.map((m) => m.durationMs ?? 0)),
      partial: partialReasons.length > 0 || metas.some((m) => m.partial),
      ...(partialReasons.length ? { partialReasons } : {}),
      truncatedAttributes: [
        ...new Set(metas.flatMap((m) => m.truncatedAttributes ?? [])),
      ].sort(),
      cutValues: metas.reduce((sum, m) => sum + (m.cutValues ?? 0), 0),
      closedShadowRootsVisible:
        metas.length > 0 && metas.every((m) => m.closedShadowRootsVisible),
      excludedRoots: mergeExcludedRoots(
        metas.map((m) => m.excludedRoots ?? ([] as ExcludedRootSummary[])),
      ),
    },
  };

  const inventory = sorted.map(
    ({ frame, owner, profile: p, failure, error }) => {
      const role = frameRole({
        frameId: frame.frameId,
        url: frame.url,
        owner,
        elementCount: contentElements(p),
      });
      return {
        frameId: frame.frameId,
        parentFrameId: frame.parentFrameId,
        urlShape: toUrlShape(frame.url),
        role: role.role,
        roleReason: role.reason,
        analyzed: Boolean(p),
        reason: p
          ? "analyzed"
          : failure === "noise"
            ? "Extension or overlay content, left out on purpose."
            : failure === "navigation-error"
              ? "The browser reported that this frame failed to load."
              : `Its content script did not answer: ${error ?? "no reason given"}`,
        elementCount: p?.meta?.elementCount ?? null,
        partial: Boolean(p?.meta?.partial),
      };
    },
  );
  return { profile, inventory };
}

/** Profile every frame of the tab as it is now. Reads only: nothing is clicked, scrolled or navigated. */
export async function collectStateProfile(
  tabId: number,
  options: CollectStateProfileOptions = {},
): Promise<StateProfileOutcome> {
  const frameTree = await getFrameTree(tabId);
  if (!frameTree || frameTree.length === 0) {
    return { available: false, error: "The tab's frames could not be listed." };
  }
  const ignoredRoots = [...(options.ignoredRoots ?? [])];
  const owners = await collectFrameOwnersByFrameId(
    tabId,
    frameTree,
    ignoredRoots,
  );
  const frames = await Promise.all(
    frameTree.map(async (frame): Promise<CollectedFrame> => {
      const owner = owners.get(frame.frameId) ?? null;
      if (frame.errorOccurred) {
        return { frame, owner, profile: null, failure: "navigation-error" };
      }
      if (noiseFrame(frame, owner)) {
        return { frame, owner, profile: null, failure: "noise" };
      }
      const response = await sendFrameMessage<DomProfileV2>(
        tabId,
        frame.frameId,
        {
          request: "collect-dom-profile",
          ignoredRoots,
          ...(options.timeBudgetMs
            ? { timeBudgetMs: options.timeBudgetMs }
            : {}),
        },
        PROFILE_TIMEOUT_MS,
      );
      return response.success && response.data
        ? { frame, owner, profile: response.data, failure: null }
        : {
            frame,
            owner,
            profile: null,
            failure: "unreachable",
            ...(response.error ? { error: response.error } : {}),
          };
    }),
  );
  if (!frames.some((f) => f.frame.parentFrameId < 0 && f.profile)) {
    const top = frames.find((f) => f.frame.parentFrameId < 0);
    return {
      available: false,
      error: `The page itself could not be read: ${top?.error ?? "no reason given"}`,
    };
  }
  return { available: true, result: mergeStateProfile(frames) };
}

export interface BehaviorProbeRunOptions {
  windowMs?: number;
  ignoredRoots?: readonly string[];
  /** How the window is waited out; tests pass their own. */
  wait?: (ms: number) => Promise<void>;
}

const NOT_RUN = (windowMs: number): BehaviorProbe => ({
  ran: false,
  windowMs,
  mutationBursts: [],
  burstGapsMs: [],
  eventRates: {},
  ranToCompletion: false,
});

/**
 * Watch every frame of the tab for `windowMs` (R2.3): arm, wait, capture,
 * disarm. Call it once the page has settled (`waitForDomStable`). Bursts of
 * all frames are listed together; event rates are summed.
 */
export async function captureBehaviorProbe(
  tabId: number,
  options: BehaviorProbeRunOptions = {},
): Promise<BehaviorProbe> {
  const windowMs = options.windowMs ?? DEFAULT_PROBE_WINDOW_MS;
  const wait =
    options.wait ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const frameTree = await getFrameTree(tabId);
  const frames = (frameTree ?? []).filter(
    (f) => !f.errorOccurred && !/^chrome-extension:/i.test(f.url),
  );
  const send = (
    frameId: number,
    request: string,
    extra: Record<string, unknown> = {},
  ) =>
    sendFrameMessage<BehaviorProbe>(
      tabId,
      frameId,
      { request, ...extra },
      PROBE_MESSAGE_TIMEOUT_MS,
    );

  const armed = (
    await Promise.all(
      frames.map(async (f) => ({
        frameId: f.frameId,
        ok: (
          await send(f.frameId, "dom-config-probe-arm", {
            windowMs,
            ignoredRoots: [...(options.ignoredRoots ?? [])],
          })
        ).success,
      })),
    )
  ).filter((f) => f.ok);
  if (armed.length === 0) return NOT_RUN(windowMs);
  try {
    await wait(windowMs);
    const captured = (
      await Promise.all(
        armed.map((f) => send(f.frameId, "dom-config-probe-capture")),
      )
    )
      .filter((r) => r.success && r.data)
      .map((r) => r.data!);
    if (captured.length === 0) return NOT_RUN(windowMs);
    const eventRates: Record<string, number> = {};
    for (const probe of captured) {
      for (const [event, rate] of Object.entries(probe.eventRates)) {
        eventRates[event] = (eventRates[event] ?? 0) + rate;
      }
    }
    return {
      ran: true,
      windowMs,
      mutationBursts: captured.flatMap((p) => p.mutationBursts),
      burstGapsMs: captured.flatMap((p) => p.burstGapsMs),
      eventRates: Object.fromEntries(
        Object.entries(eventRates).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      ),
      ranToCompletion:
        captured.length === armed.length &&
        captured.every((p) => p.ranToCompletion),
    };
  } finally {
    await Promise.all(
      armed.map((f) => send(f.frameId, "dom-config-probe-disarm")),
    );
  }
}
