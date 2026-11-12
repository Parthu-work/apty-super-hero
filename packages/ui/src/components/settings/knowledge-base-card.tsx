import {
  KB_PACK_LIMITS,
  KB_PACK_STALE_DAYS,
  type KbAptyVersion,
  type KbImportResult,
  type KbPackInfo,
  type KbPackUsability,
  kbPackAgeDays,
} from "@apty/agent-core";
import { BookOpen, Trash2, Upload } from "lucide-react";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "../../i18n/context";
import type { TranslationKey } from "../../i18n/types";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Notice } from "../ui/notice";
import type { KnowledgeBaseAdapter } from "./types";

type ErrorCode = Extract<KbImportResult, { ok: false }>["code"];

const ERROR_KEYS: Record<ErrorCode, TranslationKey> = {
  too_large: "settings.knowledgeBase.errors.tooLarge",
  not_json: "settings.knowledgeBase.errors.notJson",
  wrong_kind: "settings.knowledgeBase.errors.wrongKind",
  wrong_schema_version: "settings.knowledgeBase.errors.wrongSchemaVersion",
  invalid: "settings.knowledgeBase.errors.invalid",
  checksum_mismatch: "settings.knowledgeBase.errors.checksumMismatch",
  read_failed: "settings.knowledgeBase.errors.readFailed",
  unsigned: "settings.knowledgeBase.errors.notTrusted",
  untrusted_key: "settings.knowledgeBase.errors.notTrusted",
  revoked_key: "settings.knowledgeBase.errors.revokedKey",
  bad_signature: "settings.knowledgeBase.errors.badSignature",
  expired: "settings.knowledgeBase.errors.expired",
  not_yet_valid: "settings.knowledgeBase.errors.notYetValid",
};

/** Who signed a pack and whether it is used, in words (K23 P5). */
function trustWords(
  usability: KbPackUsability,
  t: ReturnType<typeof useTranslation>["t"],
): { signer: string; state: string } {
  const { trust, validity } = usability;
  const signer =
    trust.status === "trusted"
      ? t("settings.knowledgeBase.signedBy", {
          name: trust.name,
          keyId: trust.keyId,
        })
      : trust.status === "unsigned"
        ? t("settings.knowledgeBase.notSigned")
        : t("settings.knowledgeBase.signedByUnknown", {
            keyId: trust.keyId ?? "",
          });
  const date = validity.date?.slice(0, 10) ?? "";
  const state =
    usability.reason === "unsigned"
      ? t("settings.knowledgeBase.state.unsigned")
      : usability.reason === "untrusted"
        ? t("settings.knowledgeBase.state.untrusted")
        : usability.reason === "revoked"
          ? t("settings.knowledgeBase.state.revoked")
          : validity.state === "expired"
            ? t("settings.knowledgeBase.state.expired", { date })
            : validity.state === "not_yet_valid"
              ? t("settings.knowledgeBase.state.notYetValid", { date })
              : validity.state === "expiring"
                ? t("settings.knowledgeBase.state.expiring", {
                    days: validity.daysLeft ?? 0,
                  })
                : t("settings.knowledgeBase.state.current");
  return { signer, state };
}

type Status =
  | { kind: "idle" }
  | { kind: "imported"; cardCount: number; space: string; version: string }
  | { kind: "removed"; version: string }
  | { kind: "error"; code: ErrorCode; date?: string };

export interface KnowledgeBaseCardProps {
  adapter: KnowledgeBaseAdapter;
  now?: () => Date;
}

/** One loaded pack: what it is, with its age warning, Replace and Remove. */
function PackRow({
  info,
  now,
  busy,
  onReplace,
  onRemove,
}: {
  info: KbPackInfo & { usability?: KbPackUsability };
  now: Date;
  busy: boolean;
  onReplace: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const version = info.aptyVersion;
  const age = kbPackAgeDays(info, now);
  // The 30-day warning is for packs with no expiry date; K23's dates replace it.
  const stale =
    !info.expiresAt && age !== undefined && age > KB_PACK_STALE_DAYS;
  const trust = info.usability ? trustWords(info.usability, t) : undefined;
  return (
    <section
      aria-label={t("settings.knowledgeBase.loadedLabelVersion", { version })}
      className="space-y-2 rounded-md border border-border p-3"
    >
      <h3 className="text-sm font-medium text-foreground">
        {t("settings.knowledgeBase.versionHeading", { version })}
      </h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">
          {t("settings.knowledgeBase.space")}
        </dt>
        <dd>
          {info.space} · {info.site}
        </dd>
        <dt className="text-muted-foreground">
          {t("settings.knowledgeBase.cards")}
        </dt>
        <dd>
          {info.stubCount
            ? t("settings.knowledgeBase.cardsWithStubs", {
                count: info.cardCount,
                stubs: info.stubCount,
              })
            : info.cardCount}
        </dd>
        <dt className="text-muted-foreground">
          {t("settings.knowledgeBase.built")}
        </dt>
        <dd>{info.builtAt.slice(0, 10)}</dd>
        <dt className="text-muted-foreground">
          {t("settings.knowledgeBase.imported")}
        </dt>
        <dd>{info.importedAt.slice(0, 10)}</dd>
        {trust && (
          <>
            <dt className="text-muted-foreground">
              {t("settings.knowledgeBase.signature")}
            </dt>
            <dd>{trust.signer}</dd>
            <dt className="text-muted-foreground">
              {t("settings.knowledgeBase.expires")}
            </dt>
            <dd>
              {info.expiresAt
                ? info.expiresAt.slice(0, 10)
                : t("settings.knowledgeBase.noExpiry")}
            </dd>
            <dt className="text-muted-foreground">
              {t("settings.knowledgeBase.stateLabel")}
            </dt>
            <dd data-testid="kb-pack-state">{trust.state}</dd>
          </>
        )}
        <dt className="text-muted-foreground">
          {t("settings.knowledgeBase.retrieval")}
        </dt>
        <dd>
          {t(
            info.mode === "hybrid"
              ? "settings.knowledgeBase.modeHybrid"
              : "settings.knowledgeBase.modeBm25",
          )}
          {" · "}
          {t(
            info.calibrated
              ? "settings.knowledgeBase.calibrated"
              : "settings.knowledgeBase.uncalibrated",
          )}
        </dd>
      </dl>
      {info.usability && !info.usability.usable && (
        <Notice tone="error">{t("settings.knowledgeBase.notUsed")}</Notice>
      )}
      {info.usability?.validity.state === "expiring" && (
        <Notice tone="warning">
          {t("settings.knowledgeBase.expiringSoon", {
            days: info.usability.validity.daysLeft ?? 0,
          })}
        </Notice>
      )}
      {stale && (
        <Notice tone="warning">
          {t("settings.knowledgeBase.stale", { days: age ?? 0 })}
        </Notice>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} onClick={onReplace}>
          <Upload aria-hidden="true" className="h-4 w-4" />
          {t("settings.knowledgeBase.replaceVersion", { version })}
        </Button>
        <Button variant="danger" disabled={busy} onClick={onRemove}>
          <Trash2 aria-hidden="true" className="h-4 w-4" />
          {t("settings.knowledgeBase.removeVersion", { version })}
        </Button>
      </div>
    </section>
  );
}

/**
 * Options → Settings → Knowledge base: import, see and remove the KB
 * packs, one per Apty version (KB-RAG K3, K12). Import reads the version
 * from the file and replaces that version's pack.
 */
export function KnowledgeBaseCard({
  adapter,
  now = () => new Date(),
}: KnowledgeBaseCardProps) {
  const { t } = useTranslation();
  const [packs, setPacks] = useState<KbPackInfo[] | undefined>(undefined);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<KbAptyVersion | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(
    () =>
      adapter
        .info()
        .then((loaded) => setPacks(loaded))
        .catch(() => setPacks([])),
    [adapter],
  );

  useEffect(() => {
    let live = true;
    adapter
      .info()
      .then((loaded) => live && setPacks(loaded))
      .catch(() => live && setPacks([]));
    return () => {
      live = false;
    };
  }, [adapter]);

  const onFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      setBusy(true);
      try {
        let result: KbImportResult;
        if (file.size > KB_PACK_LIMITS.maxBytes) {
          result = { ok: false, code: "too_large" };
        } else {
          let text: string | undefined;
          try {
            text = await file.text();
          } catch {
            text = undefined;
          }
          result =
            text === undefined
              ? { ok: false, code: "read_failed" }
              : await adapter.importPack(text);
        }
        if (result.ok) {
          await reload();
          setStatus({
            kind: "imported",
            cardCount: result.info.cardCount,
            space: result.info.space,
            version: result.info.aptyVersion,
          });
        } else {
          setStatus({
            kind: "error",
            code: result.code,
            ...(result.date ? { date: result.date } : {}),
          });
        }
      } catch {
        setStatus({ kind: "error", code: "read_failed" });
      } finally {
        setBusy(false);
      }
    },
    [adapter, reload],
  );

  const onRemove = useCallback(async () => {
    if (!confirming) return;
    const version = confirming;
    setBusy(true);
    try {
      await adapter.remove(version);
      await reload();
      setStatus({ kind: "removed", version });
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }, [adapter, confirming, reload]);

  const today = now();

  return (
    <Card id="knowledge-base" className="scroll-mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen aria-hidden="true" className="h-5 w-5" />
          {t("settings.knowledgeBase.title")}
        </CardTitle>
        <CardDescription>
          {t("settings.knowledgeBase.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {packs === undefined ? null : packs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("settings.knowledgeBase.notLoaded")}
          </p>
        ) : (
          packs.map((info) => (
            <PackRow
              key={info.aptyVersion}
              info={info}
              now={today}
              busy={busy}
              onReplace={() => fileInput.current?.click()}
              onRemove={() => setConfirming(info.aptyVersion)}
            />
          ))
        )}

        {status.kind === "imported" && (
          <Notice tone="success">
            {t("settings.knowledgeBase.importedStatus", {
              count: status.cardCount,
              space: status.space,
              version: status.version,
            })}
          </Notice>
        )}
        {status.kind === "removed" && (
          <Notice tone="info">
            {t("settings.knowledgeBase.removedStatus", {
              version: status.version,
            })}
          </Notice>
        )}
        {status.kind === "error" && (
          <Notice tone="error">
            {t(ERROR_KEYS[status.code], {
              date: status.date?.slice(0, 10) ?? "",
            })}
          </Notice>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Upload aria-hidden="true" className="h-4 w-4" />
            {t("settings.knowledgeBase.import")}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-label={t("settings.knowledgeBase.fileLabel")}
            data-testid="knowledge-base-file"
            onChange={onFile}
          />
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={t("settings.knowledgeBase.removeTitle", {
          version: confirming ?? "",
        })}
        description={t("settings.knowledgeBase.removeDescription")}
        confirmLabel={t("settings.knowledgeBase.remove")}
        pending={busy}
        onConfirm={onRemove}
      />
    </Card>
  );
}
