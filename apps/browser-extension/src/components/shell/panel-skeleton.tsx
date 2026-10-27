import { Skeleton } from "@apty/ui/components/ui/skeleton";
import { useTranslation } from "@apty/ui/i18n/context";

/** The header, the context bar and Home in neutral blocks while settings load. */
export function PanelSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col bg-background" aria-busy="true">
      <span role="status" className="sr-only">
        {t("common.loading")}
      </span>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2">
        <Skeleton className="size-10" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="ml-auto size-10" />
      </div>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <Skeleton className="size-4 rounded-full" />
        <Skeleton className="h-3.5 w-32" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-hidden px-4 pt-10">
        <Skeleton className="mb-4 size-12 rounded-lg" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-64" />
        <div className="mt-6 w-full space-y-2">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-15 w-full rounded-lg" />
          ))}
        </div>
      </div>
      <div className="shrink-0 px-4 pt-2 pb-3">
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    </div>
  );
}
