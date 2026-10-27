import { englishTranslate, type Translate } from "./model-list";

const INSPECTABLE_PROTOCOLS = new Set(["http:", "https:", "file:"]);
const STORE_HOSTS = new Set(["chromewebstore.google.com", "chrome.google.com"]);

/** Whether Chrome lets an extension read and act on the page at `url`. */
export function describePage(
  url: string | undefined,
  fileAccessAllowed = true,
  t: Translate = englishTranslate,
): {
  inspectable: boolean;
  detail: string;
} {
  if (!url) {
    return {
      inspectable: false,
      detail: t("readiness.noPage"),
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { inspectable: false, detail: t("readiness.unreadableAddress") };
  }
  if (
    !INSPECTABLE_PROTOCOLS.has(parsed.protocol) ||
    STORE_HOSTS.has(parsed.hostname)
  ) {
    return {
      inspectable: false,
      detail: t("readiness.notInspectable", {
        kind:
          parsed.protocol === "https:"
            ? parsed.hostname
            : `${parsed.protocol.replace(":", "")}:`,
      }),
    };
  }
  if (parsed.protocol === "file:") {
    return fileAccessAllowed
      ? { inspectable: true, detail: t("readiness.localFileReady") }
      : {
          inspectable: false,
          detail: t("readiness.fileAccessOff"),
        };
  }
  return {
    inspectable: true,
    detail: t("readiness.ready", { host: parsed.hostname }),
  };
}
