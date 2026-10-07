/**
 * `bookmarks`/`history`/`management` (M5) are declared as
 * `optional_permissions` in manifest.json rather than unconditional
 * `permissions` — Chrome does not grant these at install time, and the
 * extension must request each one explicitly, from a real user gesture
 * (a button click on an extension page; `chrome.permissions.request`
 * throws/rejects if called without one).
 *
 * The context providers and panels that use these APIs (BookmarksProvider,
 * HistoryProvider, the Apty Client "Detect" panel's `chrome.management.get`
 * call) already handle the permission being absent gracefully — they
 * either feature-detect the namespace or wrap the call in try/catch and
 * return an empty/undefined result. Converting these to optional
 * permissions does not require touching that code: it only changes
 * whether the API exists to call at all, a case those call sites already
 * handle.
 */

export type OptionalPermissionName = "bookmarks" | "history" | "management";

export const OPTIONAL_PERMISSIONS: readonly OptionalPermissionName[] = [
  "bookmarks",
  "history",
  "management",
];

export async function hasOptionalPermission(
  name: OptionalPermissionName,
): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ permissions: [name] });
  } catch {
    return false;
  }
}

/** Must be called synchronously from a user gesture (e.g. a button's onClick) — Chrome rejects a request made from any other context. */
export async function requestOptionalPermission(
  name: OptionalPermissionName,
): Promise<boolean> {
  try {
    return await chrome.permissions.request({ permissions: [name] });
  } catch {
    return false;
  }
}

export async function removeOptionalPermission(
  name: OptionalPermissionName,
): Promise<boolean> {
  try {
    return await chrome.permissions.remove({ permissions: [name] });
  } catch {
    return false;
  }
}
