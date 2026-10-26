import type {
  DomConfigRule,
  DomConfigSetting,
} from "@apty/browser-runtime/apty/dom-config/index";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import type { TranslationKey } from "@apty/ui/i18n/types";
import { cn } from "@apty/ui/lib/utils";
import {
  AsteriskIcon,
  CalculatorIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  FilterIcon,
  HashIcon,
  LightbulbIcon,
  RulerIcon,
  Settings2Icon,
  ShieldAlertIcon,
} from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";
import { toneBadgeClass } from "../tone-classes";

const AnnounceContext = createContext<(text: string) => void>(() => {});

/** One polite live region for the card: copy feedback and progress are read out from here. */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const announce = useCallback((text: string) => {
    setMessage("");
    queueMicrotask(() => setMessage(text));
  }, []);
  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <p className="sr-only" aria-live="polite" role="status">
        {message}
      </p>
    </AnnounceContext.Provider>
  );
}

function useAnnounce() {
  return useContext(AnnounceContext);
}

export function CopyButton({
  text,
  what,
  label,
  ariaLabel,
}: {
  text: string;
  /** Names the copied thing for the accessible name and the announcement. */
  what: string;
  /** Visible label; icon only when absent. */
  label?: string;
  /** Replaces "Copy {what}" as the accessible name; it must contain `label`. */
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  const announce = useAnnounce();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-6 shrink-0 gap-1 px-1.5 text-xs"
      aria-label={ariaLabel ?? t("domConfig.copyAria", { what })}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            announce(t("domConfig.copied", { what }));
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {});
      }}
    >
      {copied ? (
        <CheckIcon className="size-3" aria-hidden="true" />
      ) : (
        <CopyIcon className="size-3" aria-hidden="true" />
      )}
      {label && <span>{label}</span>}
    </Button>
  );
}

const BASIS: Record<
  DomConfigSetting<unknown>["basis"],
  {
    label: TranslationKey;
    icon: typeof RulerIcon;
    tone: "success" | "active" | "neutral";
  }
> = {
  measured: {
    label: "domConfig.basis.measured",
    icon: RulerIcon,
    tone: "success",
  },
  derived: {
    label: "domConfig.basis.derived",
    icon: CalculatorIcon,
    tone: "active",
  },
  default: {
    label: "domConfig.basis.default",
    icon: Settings2Icon,
    tone: "neutral",
  },
};

export function BasisBadge({
  basis,
}: {
  basis: DomConfigSetting<unknown>["basis"];
}) {
  const { t } = useTranslation();
  const meta = BASIS[basis];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-medium",
        toneBadgeClass(meta.tone),
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {t(meta.label)}
    </span>
  );
}

const EVIDENCE: Record<
  DomConfigRule["evidence"],
  {
    label: TranslationKey;
    icon: typeof EyeIcon;
    tone: "success" | "warning" | "neutral";
  }
> = {
  observed_change: {
    label: "domConfig.rules.evidence.observedChange",
    icon: EyeIcon,
    tone: "success",
  },
  pattern: {
    label: "domConfig.rules.evidence.pattern",
    icon: AsteriskIcon,
    tone: "success",
  },
  record_specific: {
    label: "domConfig.rules.evidence.recordSpecific",
    icon: HashIcon,
    tone: "neutral",
  },
  noise: {
    label: "domConfig.rules.evidence.noise",
    icon: FilterIcon,
    tone: "neutral",
  },
  heuristic: {
    label: "domConfig.rules.evidence.heuristic",
    icon: LightbulbIcon,
    tone: "warning",
  },
  pii: {
    label: "domConfig.rules.evidence.pii",
    icon: ShieldAlertIcon,
    tone: "warning",
  },
};

export function evidenceLabel(
  t: (key: TranslationKey) => string,
  evidence: DomConfigRule["evidence"],
): string {
  return t(EVIDENCE[evidence].label);
}

export function EvidenceBadge({
  evidence,
}: {
  evidence: DomConfigRule["evidence"];
}) {
  const { t } = useTranslation();
  const meta = EVIDENCE[evidence];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-medium",
        toneBadgeClass(meta.tone),
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {t(meta.label)}
    </span>
  );
}

/** A long value that wraps instead of widening the panel; the full text stays readable. */
export function Wrapped({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <span className={cn("min-w-0 [overflow-wrap:anywhere]", className)}>
      {children}
    </span>
  );
}
