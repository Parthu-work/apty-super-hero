const WAIT_MS = 5000;
const HIGHLIGHT_MS = 2000;

/**
 * Scroll to and briefly highlight a section of the Options page. Sections
 * render only after settings load, so this waits for the element to appear.
 */
export function revealSection(id: string): () => void {
  const reveal = (section: HTMLElement) => {
    section.scrollIntoView({ block: "start" });
    section.classList.add("ring-2", "ring-primary");
    setTimeout(
      () => section.classList.remove("ring-2", "ring-primary"),
      HIGHLIGHT_MS,
    );
  };

  const existing = document.getElementById(id);
  if (existing) {
    reveal(existing);
    return () => {};
  }

  const observer = new MutationObserver(() => {
    const section = document.getElementById(id);
    if (!section) return;
    stop();
    reveal(section);
  });
  const timer = setTimeout(() => stop(), WAIT_MS);
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
  };
  observer.observe(document.body, { childList: true, subtree: true });
  return stop;
}
