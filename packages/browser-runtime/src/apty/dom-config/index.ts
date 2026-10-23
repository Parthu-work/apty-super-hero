export { buildDomConfigReport } from "./build-report.js";
export {
  buildPageCapture,
  type ImportedRunInput as DomConfigImportedRun,
  type PageImportInput as DomConfigPageImportInput,
  type PageImportResult as DomConfigPageImportResult,
  type ProfileImportError as DomProfileImportError,
  type ProfileImportResult as DomProfileImportResult,
  parseDomProfile,
} from "./import-profile.js";
export {
  DOM_CONFIG_RULE_LIST_VERSION,
  DOM_CONFIG_TOOL_VERSION,
} from "./limits.js";
export { renderDomConfigMarkdown } from "./render-markdown.js";
export type {
  ApplicationCapture as DomConfigApplicationCapture,
  DomConfigReport,
  DomConfigReportOptions,
  DomProfile,
  DomProfileV2,
  PageCapture as DomConfigPageCapture,
  ProfileRun as DomConfigRun,
  Rule as DomConfigRule,
  RunLabel as DomConfigRunLabel,
  RunMeta as DomConfigRunMeta,
  Setting as DomConfigSetting,
} from "./types.js";
