/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${Math.round((bytes / k ** i) * 100) / 100} ${sizes[i]}`;
}

/**
 * Format date to human-readable string
 */
export function formatDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  // Less than 1 minute
  if (diff < 60000) {
    return "Just now";
  }

  // Less than 1 hour
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  }

  // Less than 1 day
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  }

  // Less than 7 days
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return `${days} day${days > 1 ? "s" : ""} ago`;
  }

  // Otherwise, show the date
  return date.toLocaleDateString();
}

/**
 * Get file extension
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filename.substring(lastDot + 1).toLowerCase();
}

/**
 * Get file icon based on extension
 */
export function getFileIcon(filename: string): string {
  const ext = getFileExtension(filename);

  const iconMap: Record<string, string> = {
    // Documents
    md: "📝",
    txt: "📄",
    pdf: "📕",
    // Code
    js: "📜",
    ts: "📘",
    tsx: "📘",
    jsx: "📜",
    json: "📋",
    html: "🌐",
    css: "🎨",
    scss: "🎨",
    // Images
    png: "🖼️",
    jpg: "🖼️",
    jpeg: "🖼️",
    gif: "🖼️",
    svg: "🎨",
    // Archives
    zip: "📦",
    tar: "📦",
    gz: "📦",
    // Other
    xml: "📰",
    yaml: "⚙️",
    yml: "⚙️",
    sh: "⚡",
    py: "🐍",
    go: "🐹",
    rs: "🦀",
    java: "☕",
    c: "©️",
    cpp: "©️",
    h: "©️",
    log: "📊",
  };

  return iconMap[ext] || "📄";
}

/**
 * Check if a path is protected (should not be deleted)
 */
function isProtectedPath(path: string): boolean {
  const protectedPaths = ["/skills", "/skills/skill-creator"];

  // Exact match
  if (protectedPaths.includes(path)) {
    return true;
  }

  // Check if path starts with protected path + /
  for (const protectedPath of protectedPaths) {
    if (path.startsWith(`${protectedPath}/`)) {
      return true;
    }
  }

  return false;
}
