/**
 * The first-run checklist (KB-RAG K27, R3): while the Agent is not ready,
 * one card above the chat with a row per thing it needs and a button to the
 * Options section that fixes it. It reads what Preflight reads and is gone
 * once every row is ready, or once the chat has a message, so it never moves
 * a conversation the reader is in.
 */
import type { KbPackState, OrgPolicyState } from "@apty/agent-core";
import { loadOrgPolicy } from "@apty/browser-runtime/runtime/org-policy";
import { useChatContext } from "@apty/ui/components/chatbot";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { cn } from "@apty/ui/lib/utils";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { openOptions } from "../../lib/open-options";
import { kbPackStore } from "../../services/kb-pack";
import {
  type FirstRunFacts,
  type FirstRunRow,
  firstRunNeeded,
  firstRunRows,
} from "./first-run";
import { useReadiness } from "./use-readiness";

/** The SE chose to work with the KB and checks only, no AI model. */
const NO_KEY_MODE_KEY = "apty_no_key_mode";

function useNoKeyMode(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const local = globalThis.chrome?.storage?.local;
    if (!local) return;
    Promise.resolve(local.get(NO_KEY_MODE_KEY))
      .then((items) => setOn(items?.[NO_KEY_MODE_KEY] === true))
      .catch(() => undefined);
  }, []);
  const choose = useCallback(() => {
    setOn(true);
    void globalThis.chrome?.storage?.local?.set({ [NO_KEY_MODE_KEY]: true });
  }, []);
  return [on, choose];
}

function useFacts(): Omit<
  FirstRunFacts,
  "providerConfigured" | "client" | "noKeyMode"
> {
  const [packs, setPacks] = useState<KbPackState[] | undefined>();
  const [policy, setPolicy] = useState<OrgPolicyState | undefined>();
  useEffect(() => {
    let live = true;
    kbPackStore()
      .info()
      .then((list) => live && setPacks(list))
      .catch(() => live && setPacks([]));
    loadOrgPolicy()
      .then((state) => live && setPolicy(state))
      .catch(
        () =>
          live && setPolicy({ kind: "invalid", reason: "unreadable" } as never),
      );
    return () => {
      live = false;
    };
  }, []);
  return { packs, policy };
}

const TONE: Record<FirstRunRow["state"], string> = {
  ok: "text-success",
  todo: "text-muted-foreground",
  problem: "text-destructive",
  checking: "text-muted-foreground",
};

const ICON = {
  ok: CircleCheckIcon,
  todo: CircleDashedIcon,
  problem: CircleAlertIcon,
  checking: CircleDashedIcon,
} as const;

function Row({ row, onNoKey }: { row: FirstRunRow; onNoKey: () => void }) {
  const { t } = useTranslation();
  const Icon = ICON[row.state];
  const label = t(`firstRun.label.${row.id}`);
  return (
    <li
      className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5"
      data-testid={`first-run-${row.id}`}
      data-state={row.state}
    >
      <Icon
        aria-hidden="true"
        className={cn("size-4 shrink-0", TONE[row.state])}
      />
      <span className="min-w-0 flex-1 text-sm text-foreground">
        <span className="font-medium">{label}</span>
        <span className="sr-only">{` ${t(`firstRun.state.${row.state}`)}`}</span>
        <span className="block text-small text-muted-foreground">
          {t(`firstRun.rows.${row.detail}`, row.values)}
        </span>
      </span>
      {row.state !== "ok" && row.state !== "checking" && (
        <span className="flex gap-1">
          <Button
            size="sm"
            variant="secondary"
            aria-label={t("firstRun.fixLabel", { item: label })}
            onClick={() => void openOptions({ section: row.section })}
          >
            {t(row.id === "ai" ? "firstRun.setKey" : "firstRun.fix")}
          </Button>
          {row.id === "ai" && (
            <Button size="sm" variant="ghost" onClick={onNoKey}>
              {t("firstRun.noKey")}
            </Button>
          )}
        </span>
      )}
    </li>
  );
}

export function FirstRunChecklist() {
  const { messages } = useChatContext();
  return messages.length === 0 ? <Checklist /> : null;
}

function Checklist() {
  const { t } = useTranslation();
  const readiness = useReadiness();
  const [noKeyMode, chooseNoKey] = useNoKeyMode();
  const { packs, policy } = useFacts();
  const rows = firstRunRows({
    packs,
    policy,
    noKeyMode,
    providerConfigured: readiness.states.provider === "ok",
    client: readiness.peers.client,
  });
  if (!firstRunNeeded(rows)) return null;
  return (
    <section
      aria-labelledby="first-run-title"
      className="rounded-lg border border-border bg-card p-3"
      data-testid="first-run"
    >
      <h2 id="first-run-title" className="text-sm font-medium text-foreground">
        {t("firstRun.title")}
      </h2>
      <p className="text-small text-muted-foreground">
        {t("firstRun.description")}
      </p>
      <ul className="mt-1 divide-y divide-border">
        {rows.map((row) => (
          <Row key={row.id} row={row} onNoKey={chooseNoKey} />
        ))}
      </ul>
    </section>
  );
}
