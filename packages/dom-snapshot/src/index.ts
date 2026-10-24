export { collectDomSnapshot, collectDomSnapshotInPage } from "./collector.js";
export {
  closestComposed,
  composedParentElement,
  composedText,
  isRenderedInComposedTree,
  querySelectorAllDeep,
  querySelectorDeep,
  walkComposedTree,
} from "./composed-tree.js";
export type { ElementPath } from "./des-engine.js";
export {
  armBehaviorProbe,
  type BehaviorProbeHandle,
  type BehaviorProbeOptions,
  DEFAULT_PROBE_WINDOW_MS,
  PROBE_BURST_GAP_MS,
} from "./dom-config-probe.js";
export {
  collectDomProfile,
  DOM_PROFILE_LIMITS,
  type DomProfileCollectorOptions,
  EXTENSION_ICON_Z_INDEX,
  profileEntry,
  profileMap,
} from "./dom-profile-collector.js";
export type {
  BehaviorProbe,
  DomProfile,
  DomProfileFrame,
  DomProfileNode,
  DomProfileV2,
  ElementFingerprintRecord,
  FrameRecord,
  FrameUnreadableReason,
  MutationBurst,
  ProfileMeta,
  ShadowHostRecord,
  ZIndexSource,
} from "./dom-profile-types.js";
export {
  buildElementRef,
  describeElementRef,
  ELEMENT_REF_VERSION,
  type ElementRef,
  type ElementRefHop,
  type ElementRefResolution,
  resolveElementRef,
  resolveHostChain,
  SHADOW_BOUNDARY,
  shadowHostChain,
  toElementRef,
} from "./element-ref.js";
export {
  DEFAULT_DES_CONFIG,
  DEFAULT_IGNORE,
  DEFAULT_PRIORITY,
} from "./health-attribute-classification.js";
export {
  AUDIT_DES_CONFIG,
  AUDIT_PROFILE_NAME,
  isUnstableAttributeName,
  normalizeAttributeName,
  stableClassTokens,
} from "./health-audit-profile.js";
export {
  __resetDomHealthRegistryForTests,
  collectDomHealthSnapshot,
  DEFAULT_COLLECTOR_BUDGET,
} from "./health-collector.js";
export {
  classifyUnstableClass,
  extractStablePrefix,
  extractStableSuffix,
  looksDynamic,
  type UnstableClassKind,
} from "./health-dynamic.js";
export { hitTestElement } from "./health-hit-testing.js";
export {
  buildComposedDomPath,
  type CollectDiscoverableLinksOptions,
  collectDiscoverableLinks,
  collectSafeNavigationCandidates,
  type DiscoverableLink,
  isSafeNavigationCandidate,
  isSafeToDiscover,
  resolveDomPath,
  type SafeNavigationCandidate,
} from "./health-links.js";
export { isIdReferenceAttribute, maskIdReference } from "./health-privacy.js";
export {
  collectFrameOwners,
  collectRouteProbeFrameSignals,
  findActiveNavItemDeep,
  findFirstHeadingDeep,
  frameOwnerOf,
  type RouteProbeFrameOwner,
  type RouteProbeFrameSignals,
} from "./health-route-probe.js";
export {
  type ComposedElementResolution,
  type CrossStateVerdict,
  type CrossStateVerification,
  computeComposedFingerprint,
  computeElementFingerprint,
  type ElementPathReplayResult,
  type ElementResolution,
  extractElementAttributes,
  hasAccessibleName,
  type ResolveElementOptions,
  replayElementRefs,
  resolveElement,
  resolveInComposedTree,
  testSelector,
  verifyStoredElementPath,
} from "./health-selector-engine.js";
export {
  collectNavTrailDeep,
  computeFrameStateSignature,
  computeStructureHash,
  type FrameStateSignature,
  findPrimaryHeadingDeep,
  fnv1a,
} from "./health-state-signature.js";
export * from "./health-types.js";
export {
  DEFAULT_VIRTUALIZATION_THRESHOLDS,
  detectVirtualizedLists,
  mergeVirtualizedLists,
  NO_VIRTUALIZED_LISTS,
  SCROLL_HEIGHT_EXCESS_PX,
  SCROLL_HEIGHT_RATIO,
  SPACER_MIN_PX,
  type VirtualizationSignal,
  type VirtualizationThresholds,
  type VirtualizedContainer,
  type VirtualizedListSummary,
} from "./health-virtualized.js";
export {
  BROWSER_EXTENSION,
  DEFAULT_IGNORED_ROOTS,
  describeMatcher,
  type ExcludedRootSummary,
  findIgnoredRoots,
  type IgnoredRootMatcher,
  type IgnoredRootTarget,
  ignoredRootPolicy,
  matchIgnoredRoot,
  matchIgnoredRootTarget,
  mergeExcludedRoots,
  type NoiseSource,
  noiseSourceOf,
  PASSWORD_MANAGER,
  parseIgnoredRootMatcher,
} from "./ignored-roots.js";
export { buildTextSnapshot, formatSnapshot } from "./manager.js";
export { searchAndFormat, searchSnapshotText } from "./query.js";
export { shadowRootOf } from "./shadow-roots.js";
export * from "./types.js";
export {
  applyUrlPolicy,
  applyValuePolicy,
  isEditableRole,
  MASKED_VALUE,
  type PolicyNode,
  prepareNodeForPolicy,
  urlOrigin,
  type ValuePolicy,
} from "./value-policy.js";
export {
  isSafeLiteral,
  type PiiShape,
  piiShapeOf,
  queryParams,
  toUrlShape,
} from "./value-shapes.js";
