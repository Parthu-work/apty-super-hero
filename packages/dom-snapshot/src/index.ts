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
export { hitTestElement } from "./health-hit-test.js";
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
  DEFAULT_IGNORED_ROOTS,
  describeMatcher,
  type ExcludedRootSummary,
  findIgnoredRoots,
  type IgnoredRootMatcher,
  ignoredRootPolicy,
  matchIgnoredRoot,
  mergeExcludedRoots,
  parseIgnoredRootMatcher,
} from "./ignored-roots.js";
export { buildTextSnapshot, formatSnapshot } from "./manager.js";
export { searchAndFormat, searchSnapshotText } from "./query.js";
export { shadowRootOf } from "./shadow-roots.js";
export * from "./types.js";
