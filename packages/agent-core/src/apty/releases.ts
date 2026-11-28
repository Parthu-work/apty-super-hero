/**
 * Apty player releases a mirrored rule depends on (AUDIT-CORRECTIONS A6,
 * decision D-RELEASES).
 */

/**
 * The first 5.x player that decides the widget per environment
 * (apty-dap 9b2eef11). Older players read the application-level
 * `widgetConfig`, which the server keeps equal to Production's from
 * apty-dap 3ad61ef9 on
 * (packages/apps/core-service/src/accounts/application-config/application-config.service.ts,
 * `mirrorProductionWidgetDisplay`: "Players before 5.2.4 read who sees the
 * widget from here").
 */
export const WIDGET_DISPLAY_PER_ENVIRONMENT_FROM = "5.2.4";

const parts = (release: string): number[] | undefined => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(release.trim());
  return match ? match.slice(1, 4).map(Number) : undefined;
};

/** Whether `release` is `minimum` or later; undefined when either is not a release number. */
export function releaseAtLeast(
  release: string,
  minimum: string,
): boolean | undefined {
  const a = parts(release);
  const b = parts(minimum);
  if (!a || !b) return undefined;
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] as number) - (b[i] as number);
    if (diff !== 0) return diff > 0;
  }
  return true;
}
