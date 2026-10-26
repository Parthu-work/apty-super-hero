import type {
  ApplicationDiscoveryMode,
  DomHealthConfidence,
  DomHealthGrade,
} from "@apty/browser-runtime";
import type { StatusTone } from "@apty/ui/components/ui/badge";
import type { TranslationKey } from "@apty/ui/i18n/types";

/** The six grades (correction 8) and their tones; "Not assessed" is deliberately neutral. */
export const GRADE: Record<
  DomHealthGrade,
  { label: TranslationKey; tone: StatusTone }
> = {
  EXCELLENT: { label: "domHealth.grade.excellent", tone: "success" },
  GOOD: { label: "domHealth.grade.good", tone: "success" },
  FAIR: { label: "domHealth.grade.fair", tone: "warning" },
  NEEDS_ATTENTION: { label: "domHealth.grade.needsAttention", tone: "warning" },
  HIGH_RISK: { label: "domHealth.grade.highRisk", tone: "danger" },
  NOT_ASSESSED: { label: "domHealth.grade.notAssessed", tone: "neutral" },
};

export const CONFIDENCE_LABEL: Record<DomHealthConfidence, TranslationKey> = {
  HIGH: "domHealth.confidence.high",
  MEDIUM: "domHealth.confidence.medium",
  LOW: "domHealth.confidence.low",
};

export const DISCOVERY_MODE_LABEL: Record<
  ApplicationDiscoveryMode,
  TranslationKey
> = {
  page: "domHealth.discoveryMode.page",
  "application-safe": "domHealth.discoveryMode.applicationSafe",
  "application-deep": "domHealth.discoveryMode.applicationDeep",
};

export const DISCOVERY_MODE_DESCRIPTION: Record<
  ApplicationDiscoveryMode,
  TranslationKey
> = {
  page: "domHealth.discoveryModeDescription.page",
  "application-safe": "domHealth.discoveryModeDescription.applicationSafe",
  "application-deep": "domHealth.discoveryModeDescription.applicationDeep",
};

export const LOADING_STAGES: TranslationKey[] = [
  "domHealth.loadingStages.scanning",
  "domHealth.loadingStages.generating",
  "domHealth.loadingStages.uniqueness",
  "domHealth.loadingStages.stability",
  "domHealth.loadingStages.hitTests",
  "domHealth.loadingStages.building",
];
