/**
 * Last-resort handlers for the service worker. They name only the kind of
 * failure: an error message can carry page content, a URL or a token.
 */

function kindOf(value: unknown): string {
  if (value instanceof Error) return value.name || "Error";
  return value === null ? "null" : typeof value;
}

export function registerGlobalErrorHandlers(
  target: EventTarget = globalThis,
): void {
  target.addEventListener("unhandledrejection", (event) => {
    console.error(
      "[Background] unhandled_rejection",
      kindOf((event as PromiseRejectionEvent).reason),
    );
    event.preventDefault();
  });
  target.addEventListener("error", (event) => {
    console.error(
      "[Background] uncaught_error",
      kindOf((event as ErrorEvent).error),
    );
  });
}
