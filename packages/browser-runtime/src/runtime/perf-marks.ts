/**
 * Named timings for the performance budgets (KB-RAG K27, R5): a
 * `performance.measure` the E2E suite reads in the side panel. Nothing is
 * recorded elsewhere or sent anywhere.
 */
export const PERF = {
  kbIndexBuild: "apty:kb-index-build",
  kbSearch: "apty:kb-search",
} as const;

/** Runs `fn` and records how long it took under `name`, when the page has `performance`. */
export async function measured<T>(
  name: (typeof PERF)[keyof typeof PERF],
  fn: () => T | Promise<T>,
): Promise<T> {
  const start = globalThis.performance?.now();
  try {
    return await fn();
  } finally {
    if (start !== undefined) {
      try {
        globalThis.performance.measure(name, {
          start,
          end: globalThis.performance.now(),
        });
      } catch {
        // A page without User Timing level 3 records nothing.
      }
    }
  }
}
