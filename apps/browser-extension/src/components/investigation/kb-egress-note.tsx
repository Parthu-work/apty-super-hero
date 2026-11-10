/**
 * The line under KB card text in the panel (KB-RAG K22, S4): whether the
 * text also goes to the AI model, and where. Card text stays in the panel
 * unless the organization policy approves the destination, or only demo
 * packs are loaded (D-SEC1).
 */
import { decideKbEgress } from "@apty/browser-runtime/runtime/kb-egress";
import { useTranslation } from "@apty/ui/i18n/context";
import { useEffect, useState } from "react";

/** The destination KB text goes to, or undefined when it is withheld. */
function useKbDestination(): string | undefined {
  const [destination, setDestination] = useState<string>();
  useEffect(() => {
    let live = true;
    void decideKbEgress("chat").then(({ decision, destination: to }) => {
      if (!live || !decision.allowed || !to) return;
      setDestination(
        [to.origin ?? to.provider, to.model].filter(Boolean).join(", "),
      );
    });
    return () => {
      live = false;
    };
  }, []);
  return destination;
}

/** For text the session never holds, such as a verdict card's KB excerpt. */
export function KbShownHereOnly() {
  const { t } = useTranslation();
  return (
    <p className="text-xs text-muted-foreground" data-testid="kb-egress-note">
      {t("kbMatches.notSent")}
    </p>
  );
}

/** For KB matches, which the session holds and the next request may carry. */
export function KbEgressNote() {
  const { t } = useTranslation();
  const destination = useKbDestination();
  return (
    <p className="text-xs text-muted-foreground" data-testid="kb-egress-note">
      {destination
        ? t("kbMatches.sentTo", { destination })
        : t("kbMatches.notSent")}
    </p>
  );
}
