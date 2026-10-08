export { collectDomSnapshot, collectDomSnapshotInPage } from "./collector.js";
export type { ElementPath } from "./des-engine.js";
export {
  __resetDomHealthRegistryForTests,
  collectDomHealthSnapshot,
} from "./health-collector.js";
export { extractStablePrefix, looksDynamic } from "./health-dynamic.js";
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
  type CrossStateVerdict,
  type CrossStateVerification,
  computeElementFingerprint,
  type ElementPathReplayResult,
  type ElementResolution,
  extractElementAttributes,
  hasAccessibleName,
  type ResolveElementOptions,
  replayElementPathSamples,
  resolveElement,
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
