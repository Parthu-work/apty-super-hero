export { collectDomSnapshot, collectDomSnapshotInPage } from "./collector.js";
export {
  __resetDomHealthRegistryForTests,
  collectDomHealthSnapshot,
} from "./health-collector.js";
export { extractStablePrefix, looksDynamic } from "./health-dynamic.js";
export { hitTestElement } from "./health-hit-test.js";
export {
  type CollectDiscoverableLinksOptions,
  collectDiscoverableLinks,
  type DiscoverableLink,
  isSafeToDiscover,
} from "./health-links.js";
export {
  type ElementResolution,
  extractElementAttributes,
  hasAccessibleName,
  type ResolveElementOptions,
  resolveElement,
  testSelector,
} from "./health-selector-engine.js";
export * from "./health-types.js";
export { buildTextSnapshot, formatSnapshot } from "./manager.js";
export { searchAndFormat, searchSnapshotText } from "./query.js";
export * from "./types.js";
