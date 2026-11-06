import {
  KB_PACK_LIMITS,
  KB_PACK_STALE_DAYS,
  type KbImportResult,
  type KbPackInfo,
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
};

type Status =
  | { kind: "idle" }
  | { kind: "imported"; cardCount: number; space: string }
  | { kind: "removed" }
  | { kind: "error"; code: ErrorCode };

export interface KnowledgeBaseCardProps {
  adapter: KnowledgeBaseAdapter;
  now?: () => Date;
}

/** Options → Settings → Knowledge base: import, see and remove the KB pack (KB-RAG K3). */
export function KnowledgeBaseCard({
  adapter,
  now = () => new Date(),
}: KnowledgeBaseCardProps) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<KbPackInfo | null | undefined>(undefined);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    adapter
      .info()
      .then((loaded) => live && setInfo(loaded))
      .catch(() => live && setInfo(null));
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
          setInfo(result.info);
          setStatus({
            kind: "imported",
            cardCount: result.info.cardCount,
            space: result.info.space,
          });
        } else {
          setStatus({ kind: "error", code: result.code });
        }
      } catch {
        setStatus({ kind: "error", code: "read_failed" });
      } finally {
        setBusy(false);
      }
    },
    [adapter],
  );

  const onRemove = useCallback(async () => {
    setBusy(true);
    try {
      await adapter.remove();
      setInfo(null);
      setStatus({ kind: "removed" });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }, [adapter]);

  const age = info ? kbPackAgeDays(info, now()) : undefined;
  const stale = age !== undefined && age > KB_PACK_STALE_DAYS;

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
        {info === undefined ? null : info === null ? (
          <p className="text-sm text-muted-foreground">
            {t("settings.knowledgeBase.notLoaded")}
          </p>
        ) : (
          <dl
            aria-label={t("settings.knowledgeBase.loadedLabel")}
            className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
          >
            <dt className="text-muted-foreground">
              {t("settings.knowledgeBase.space")}
            </dt>
            <dd>
              {info.space} · {info.site}
            </dd>
            <dt className="text-muted-foreground">
              {t("settings.knowledgeBase.cards")}
            </dt>
            <dd>{info.cardCount}</dd>
            <dt className="text-muted-foreground">
              {t("settings.knowledgeBase.built")}
            </dt>
            <dd>{info.builtAt.slice(0, 10)}</dd>
            <dt className="text-muted-foreground">
              {t("settings.knowledgeBase.imported")}
            </dt>
            <dd>{info.importedAt.slice(0, 10)}</dd>
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
        )}

        {stale && (
          <Notice tone="warning">
            {t("settings.knowledgeBase.stale", { days: age ?? 0 })}
          </Notice>
        )}
        {status.kind === "imported" && (
          <Notice tone="success">
            {t("settings.knowledgeBase.importedStatus", {
              count: status.cardCount,
              space: status.space,
            })}
          </Notice>
        )}
        {status.kind === "removed" && (
          <Notice tone="info">
            {t("settings.knowledgeBase.removedStatus")}
          </Notice>
        )}
        {status.kind === "error" && (
          <Notice tone="error">{t(ERROR_KEYS[status.code])}</Notice>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Upload aria-hidden="true" className="h-4 w-4" />
            {t(
              info
                ? "settings.knowledgeBase.replace"
                : "settings.knowledgeBase.import",
            )}
          </Button>
          {info && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
              {t("settings.knowledgeBase.remove")}
            </Button>
          )}
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
        open={confirming}
        onOpenChange={setConfirming}
        title={t("settings.knowledgeBase.removeTitle")}
        description={t("settings.knowledgeBase.removeDescription")}
        confirmLabel={t("settings.knowledgeBase.remove")}
        pending={busy}
        onConfirm={onRemove}
      />
    </Card>
  );
}
