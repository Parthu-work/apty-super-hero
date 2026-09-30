/**
 * Trigger a browser download of text content — no chat/tool-result Download
 * affordance existed anywhere before this (only Skills had one). Blob +
 * object URL is the primary path; `chrome.downloads.download` (the
 * `downloads` permission is already declared) is the fallback for contexts
 * where a synthetic `<a download>` click doesn't work (some extension
 * surfaces restrict programmatic anchor-click downloads).
 */
export function downloadText(
  filename: string,
  content: string,
  mimeType = "text/plain",
): boolean {
  const sanitized = sanitizeFilename(filename);
  try {
    if (typeof document === "undefined" || typeof URL === "undefined") {
      return downloadViaChromeApi(sanitized, content, mimeType);
    }
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = sanitized;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // Revoke on a delay, not immediately — some browsers haven't started
    // the actual download yet at the point `click()` returns.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return downloadViaChromeApi(sanitized, content, mimeType);
  }
}

function downloadViaChromeApi(
  filename: string,
  content: string,
  mimeType: string,
): boolean {
  try {
    const chromeApi = (globalThis as { chrome?: typeof chrome }).chrome;
    if (!chromeApi?.downloads?.download) return false;
    const dataUrl = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
    chromeApi.downloads.download({ url: dataUrl, filename, saveAs: false });
    return true;
  } catch {
    return false;
  }
}

/** Strip path separators and control characters, and timestamp the name so repeated exports never silently overwrite each other. */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
    .replace(/[/\\?%*:|"<>\x00-\x1f]/g, "-")
    .trim();
  return cleaned || "download";
}

/** `download-<label>-<ISO-timestamp-safe-for-filenames>.<ext>` — a consistent naming scheme for every export target (message, tool result, log/network export, conversation, evidence bundle). */
export function timestampedFilename(label: string, ext: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return sanitizeFilename(`${label}-${stamp}.${ext}`);
}
