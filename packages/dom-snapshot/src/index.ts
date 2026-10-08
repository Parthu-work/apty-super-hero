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
  type CollectDiscoverableLinksOptions,
  collectDiscoverableLinks,
  collectSafeNavigationCandidates,
  type DiscoverableLink,
  isSafeNavigationCandidate,
  isSafeToDiscover,
  type SafeNavigationCandidate,
} from "./health-links.js";
export {
  collectFrameOwners,
  collectRouteProbeFrameSignals,
  findActiveNavItemDeep,
  findFirstHeadingDeep,
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
  computeFrameStateSignature,
  type FrameStateSignature,
} from "./health-state-signature.js";
export * from "./health-types.js";
export { buildTextSnapshot, formatSnapshot } from "./manager.js";
export { searchAndFormat, searchSnapshotText } from "./query.js";
export { AGENT_UI_ROOT_IDS, shadowRootOf } from "./shadow-roots.js";
export * from "./types.js";
