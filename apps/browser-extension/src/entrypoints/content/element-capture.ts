/**
 * "Pick an element" capture mode, run by the frame responder in every frame
 * so an element inside an iframe or frameset can be picked too. The first
 * click in any frame is reported to the background as capture-click-event;
 * the intervention service then sends stop-capture to the whole tab.
 */

const HIGHLIGHT_CLASS = "aipex-capture-highlight";

let isCapturing = false;
let highlighted: Element | null = null;
let cleanupListeners: (() => void) | null = null;

export function generateCssSelector(element: Element): string {
  const path: string[] = [];
  let current: Element | null = element;
  let depth = 0;
  const maxDepth = 5;

  while (current && current !== document.body && depth < maxDepth) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      selector += `#${current.id}`;
      path.unshift(selector);
      break;
    }

    if (current.classList.length > 0) {
      const classes = Array.from(current.classList)
        .filter((c) => !c.startsWith("plasmo-") && !c.startsWith("aipex-"))
        .slice(0, 2)
        .join(".");
      if (classes) {
        selector += `.${classes}`;
      }
    }

    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children);
      const index = siblings.indexOf(current) + 1;
      if (siblings.length > 1) {
        selector += `:nth-child(${index})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;
    depth++;
  }

  return path.join(" > ");
}

function describeElement(target: Element) {
  const rect = target.getBoundingClientRect();
  return {
    timestamp: Date.now(),
    url: window.location.href,
    tagName: target.tagName.toLowerCase(),
    selector: generateCssSelector(target),
    id: target.id || undefined,
    classes: Array.from(target.classList).filter(
      (c) => !c.startsWith("aipex-") && !c.startsWith("plasmo-"),
    ),
    textContent: target.textContent?.trim().substring(0, 200) || undefined,
    attributes: Array.from(target.attributes).reduce(
      (acc, attr) => {
        if (!attr.name.startsWith("data-plasmo")) {
          acc[attr.name] = attr.value;
        }
        return acc;
      },
      {} as Record<string, string>,
    ),
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
  };
}

function ensureHighlightStyle(): void {
  if (document.getElementById("aipex-capture-styles")) return;
  const style = document.createElement("style");
  style.id = "aipex-capture-styles";
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      outline: 2px solid #3b82f6 !important;
      outline-offset: 2px !important;
      cursor: crosshair !important;
    }
  `;
  (document.head ?? document.documentElement).appendChild(style);
}

export function stopCapture(): void {
  isCapturing = false;
  highlighted?.classList.remove(HIGHLIGHT_CLASS);
  highlighted = null;
  cleanupListeners?.();
  cleanupListeners = null;
}

export function startCapture(): void {
  if (isCapturing) return;
  isCapturing = true;

  const handleMouseOver = (e: MouseEvent) => {
    if (!isCapturing) return;
    const target = e.target as Element | null;
    if (!target) return;
    highlighted?.classList.remove(HIGHLIGHT_CLASS);
    target.classList.add(HIGHLIGHT_CLASS);
    highlighted = target;
  };

  const handleClick = (e: MouseEvent) => {
    if (!isCapturing) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as Element | null;
    if (!target) return;

    chrome.runtime
      .sendMessage({
        request: "capture-click-event",
        data: describeElement(target),
      })
      .catch((err) => {
        console.error("❌ Failed to send capture event:", err);
      });

    stopCapture();
  };

  document.addEventListener("mouseover", handleMouseOver, true);
  document.addEventListener("click", handleClick, true);
  cleanupListeners = () => {
    document.removeEventListener("mouseover", handleMouseOver, true);
    document.removeEventListener("click", handleClick, true);
  };

  ensureHighlightStyle();
}
