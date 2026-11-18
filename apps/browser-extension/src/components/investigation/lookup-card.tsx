/**
 * A lookup answered from the Apty Client's content files (KB-RAG K27, E4):
 * one line that answers, a small table, the question to ask when two names
 * match, and where the files came from. No model was asked.
 */
import type {
  LookupColumn,
  LookupResult,
  LookupWord,
} from "@apty/browser-runtime/apty/diagnosis/lookup";
import { useTranslation } from "@apty/ui/i18n/context";
import type { ToolDisplaySlotProps } from "@apty/ui/types";

/** A lookup_content result, as the responder writes it. */
export function isLookupResult(output: unknown): output is LookupResult {
  const result = output as Partial<LookupResult> | null;
  return (
    typeof result === "object" &&
    result !== null &&
    result.kind === "lookup" &&
    Array.isArray(result.rows) &&
    typeof result.message?.key === "string"
  );
}

const WORDS = new Set<string>([
  "@yes",
  "@no",
  "@unknown",
  "@none",
  "@notRead",
  "@name",
  "@id",
  "@hidden",
  "@segments",
]);

export function LookupCard({ tool }: ToolDisplaySlotProps) {
  const { t } = useTranslation();
  const result = tool.output;
  if (!isLookupResult(result)) return null;
  const cell = (value: string) =>
    WORDS.has(value)
      ? t(
          `lookup.word.${value.slice(1) as LookupWord extends `@${infer W}` ? W : never}`,
        )
      : value;
  const title = t("lookup.title");
  return (
    <section
      aria-label={title}
      className="space-y-2 rounded-lg border border-border bg-card p-3"
      data-testid="lookup-card"
    >
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <p className="text-sm text-foreground" data-testid="lookup-answer">
        {t(`lookup.message.${result.message.key}`, result.message.values)}
      </p>
      {result.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                {result.columns.map((column: LookupColumn) => (
                  <th
                    key={column}
                    scope="col"
                    className="py-1 pr-3 font-medium"
                  >
                    {t(`lookup.column.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.join("|")} className="border-t border-border">
                  {row.map((value, i) => (
                    <td
                      key={`${result.columns[i]}-${value}`}
                      className="py-1.5 pr-3"
                    >
                      {cell(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.ask && (
        <div className="space-y-1" data-testid="lookup-ask">
          <p className="text-sm text-foreground">
            {t(`lookup.ask.${result.ask.what}`)}
          </p>
          <ul className="list-disc pl-5 text-sm text-foreground">
            {result.ask.options.map((option) => (
              <li key={option}>{option}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {t(`lookup.source.${result.source}`, {
          version: result.aptyVersion,
          files: result.files.join(", "),
        })}
      </p>
    </section>
  );
}
