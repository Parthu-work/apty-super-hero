/**
 * A translator over a locale file, for tests of functions that take `t`.
 * @internal test-only
 */
export function translatorFor(locale: Record<string, unknown>) {
  return (key: string, params: Record<string, unknown> = {}) => {
    const value = key
      .split(".")
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown>)?.[part],
        locale,
      );
    if (typeof value !== "string") throw new Error(`missing ${key}`);
    return value.replace(/\{\{(\w+)\}\}/g, (_, name) => String(params[name]));
  };
}
