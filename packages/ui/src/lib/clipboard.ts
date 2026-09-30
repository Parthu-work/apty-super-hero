/**
 * Copy text to the clipboard with a real fallback and no unhandled
 * rejection — `navigator.clipboard.writeText` can reject (denied
 * permission, insecure context, some in-extension surfaces) and the
 * previous call site (`chatbot.tsx`'s handleCopy) was fire-and-forget with
 * nothing catching that: a rejected promise, an invisible failure, and no
 * way for the user to tell copying didn't work.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the execCommand fallback below.
  }

  return copyTextViaExecCommand(text);
}

/** `document.execCommand("copy")` fallback via a temporary, off-screen, selected textarea — works in contexts where the async Clipboard API is unavailable or denied. Deprecated but still broadly supported; this IS the fallback path, not the primary one. */
function copyTextViaExecCommand(text: string): boolean {
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  document.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
