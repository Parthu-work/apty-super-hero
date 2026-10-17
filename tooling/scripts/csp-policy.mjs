/**
 * Extension pages render model and page text. A fetch directive that
 * allows remote origins turns any image, media or frame in that text into
 * a zero-click request to an attacker's server.
 */

const LOCAL_SOURCES = new Set(["'self'", "'none'", "data:", "blob:"]);

const REQUIRED_DIRECTIVES = ["img-src", "media-src", "frame-src"];

export function parseCsp(policy) {
  const directives = new Map();
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

export function extensionPageCspErrors(policy) {
  if (typeof policy !== "string" || policy.trim() === "") {
    return ["content_security_policy.extension_pages is missing"];
  }
  const directives = parseCsp(policy);
  const errors = [];
  for (const name of REQUIRED_DIRECTIVES) {
    const sources = directives.get(name) ?? directives.get("default-src");
    if (!sources) {
      errors.push(
        `extension_pages CSP has no ${name} (or default-src), so remote origins are allowed`,
      );
      continue;
    }
    const remote = sources.filter((s) => !LOCAL_SOURCES.has(s.toLowerCase()));
    if (remote.length > 0) {
      errors.push(
        `extension_pages CSP ${name} allows remote sources: ${remote.join(" ")}`,
      );
    }
  }
  return errors;
}
