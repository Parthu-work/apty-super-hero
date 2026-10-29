/**
 * Generate a unique ID with the native crypto.randomUUID() API, which every
 * supported runtime has (browsers in a secure context, Node.js 19+). There
 * is no Math.random fallback: these IDs name sessions.
 */
export function generateId(): string {
  return crypto.randomUUID();
}
