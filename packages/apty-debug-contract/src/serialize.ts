/**
 * Safe value/console-argument serialization.
 *
 * Shared between the Apty Agent's console bridge (a page's MAIN-world
 * `console.*`, which must never throw back into the host page) and any
 * producer's own service-worker log wrapper (`console.*` there too) — both
 * need the exact same guarantees:
 *
 * - NEVER throws, regardless of what's passed in (a circular structure, a
 *   null-prototype object, a Proxy that throws on every trap, a getter that
 *   throws) — every failure degrades to a placeholder string instead.
 * - NEVER invokes a user-defined getter (only well-known, safe native
 *   accessors on Error/Date/RegExp/Map/Set/DOM nodes are read) — a getter
 *   can have arbitrary side effects or throw, and simply enumerating an
 *   object's keys must never risk running page code.
 * - Bounded in every dimension (depth, key count, array length, string
 *   length, total entry length) so one huge or deeply-nested value can
 *   never blow the buffer or the message size.
 */

const MAX_DEPTH = 3;
const MAX_KEYS = 20;
const MAX_ARRAY_ITEMS = 20;
const MAX_STRING_LENGTH = 2000;
const MAX_ENTRY_LENGTH = 4000;
const MAX_CAUSE_DEPTH = 3;

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}…[+${value.length - MAX_STRING_LENGTH} chars]`;
}

/** Duck-typed DOM Node check — safe in a context with no `Node` global (a service worker) and doesn't invoke any user code. */
function isDomNode(value: unknown): value is {
  nodeType: number;
  tagName?: string;
  id?: string;
  className?: string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { nodeType?: unknown }).nodeType === "number" &&
    typeof (value as { nodeName?: unknown }).nodeName === "string"
  );
}

function formatDomNode(node: {
  nodeType: number;
  tagName?: string;
  id?: string;
  className?: string;
  nodeName?: string;
}): string {
  try {
    if (node.nodeType !== 1) {
      // Not an Element (text/comment/document/...) — name only, no id/class.
      return `<${String((node as { nodeName?: string }).nodeName ?? "node").toLowerCase()}>`;
    }
    const tag = String(node.tagName ?? "unknown").toLowerCase();
    const id = typeof node.id === "string" && node.id ? `#${node.id}` : "";
    const className =
      typeof node.className === "string" && node.className
        ? `.${node.className.trim().split(/\s+/).join(".")}`
        : "";
    return `<${tag}${id}${className}>`;
  } catch {
    return "[Node]";
  }
}

function formatError(err: Error, causeDepth: number): string {
  let out: string;
  try {
    const name = err.name || "Error";
    const message = err.message || "";
    const stack = typeof err.stack === "string" ? err.stack : "";
    out = stack || `${name}: ${message}`;
  } catch {
    out = "[Error]";
  }
  try {
    const cause = (err as { cause?: unknown }).cause;
    if (cause !== undefined && causeDepth < MAX_CAUSE_DEPTH) {
      const causeText =
        cause instanceof Error
          ? formatError(cause, causeDepth + 1)
          : serializeValue(cause, 0, new WeakSet());
      out += `\nCaused by: ${causeText}`;
    }
  } catch {
    // A throwing `cause` getter must not break the outer error's own message.
  }
  return truncateString(out);
}

/**
 * Own enumerable keys, each tagged with whether reading it is safe (a plain
 * data property) or would invoke a getter — works on null-prototype objects
 * too (no reliance on inherited methods). A getter-backed key is still
 * listed (never silently dropped), just never invoked.
 */
function safeDataKeys(obj: object): Array<{ key: string; isGetter: boolean }> {
  try {
    return Object.keys(obj).map((key) => {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(obj, key);
        return { key, isGetter: !!descriptor?.get };
      } catch {
        return { key, isGetter: true };
      }
    });
  } catch {
    return [];
  }
}

function serializeValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): string {
  try {
    if (value === null) return "null";
    if (value === undefined) return "undefined";

    const type = typeof value;
    if (type === "string") return truncateString(value as string);
    if (type === "number" || type === "boolean") return String(value);
    if (type === "bigint") return `${value}n`;
    if (type === "symbol") {
      try {
        return (value as symbol).toString();
      } catch {
        return "Symbol()";
      }
    }
    if (type === "function") {
      const fn = value as (...args: unknown[]) => unknown;
      const name = (() => {
        try {
          return fn.name;
        } catch {
          return "";
        }
      })();
      return name ? `[Function: ${name}]` : "[Function (anonymous)]";
    }

    // From here, value is an object (or a Proxy pretending to be one) —
    // every subsequent property read is wrapped, and circular refs are
    // checked before recursing further.
    const obj = value as object;
    if (seen.has(obj)) return "[Circular]";

    if (value instanceof Error) return formatError(value, 0);
    if (value instanceof Date) {
      try {
        const t = value.getTime();
        return Number.isNaN(t) ? "Invalid Date" : value.toISOString();
      } catch {
        return "[Date]";
      }
    }
    if (value instanceof RegExp) {
      try {
        return value.toString();
      } catch {
        return "[RegExp]";
      }
    }
    if (isDomNode(value)) return formatDomNode(value);

    if (depth >= MAX_DEPTH) {
      if (Array.isArray(value)) return "[Array]";
      if (value instanceof Map) return "[Map]";
      if (value instanceof Set) return "[Set]";
      return "[Object]";
    }

    seen.add(obj);
    try {
      if (value instanceof Map) {
        const entries: string[] = [];
        let i = 0;
        for (const [k, v] of value) {
          if (i >= MAX_ARRAY_ITEMS) {
            entries.push(`… ${value.size - i} more`);
            break;
          }
          entries.push(
            `${serializeValue(k, depth + 1, seen)} => ${serializeValue(v, depth + 1, seen)}`,
          );
          i++;
        }
        return `Map(${value.size}) {${entries.join(", ")}}`;
      }
      if (value instanceof Set) {
        const entries: string[] = [];
        let i = 0;
        for (const v of value) {
          if (i >= MAX_ARRAY_ITEMS) {
            entries.push(`… ${value.size - i} more`);
            break;
          }
          entries.push(serializeValue(v, depth + 1, seen));
          i++;
        }
        return `Set(${value.size}) {${entries.join(", ")}}`;
      }
      if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
        const typedArray = value as unknown as ArrayLike<number>;
        const ctorName = (() => {
          try {
            return (value as object).constructor?.name ?? "TypedArray";
          } catch {
            return "TypedArray";
          }
        })();
        const items: string[] = [];
        const len = typedArray.length;
        for (let i = 0; i < Math.min(len, MAX_ARRAY_ITEMS); i++) {
          items.push(String(typedArray[i]));
        }
        if (len > MAX_ARRAY_ITEMS)
          items.push(`… ${len - MAX_ARRAY_ITEMS} more`);
        return `${ctorName}(${len}) [${items.join(", ")}]`;
      }
      if (Array.isArray(value)) {
        const items: string[] = [];
        for (let i = 0; i < Math.min(value.length, MAX_ARRAY_ITEMS); i++) {
          items.push(serializeValue(value[i], depth + 1, seen));
        }
        if (value.length > MAX_ARRAY_ITEMS) {
          items.push(`… ${value.length - MAX_ARRAY_ITEMS} more`);
        }
        return `[${items.join(", ")}]`;
      }

      // Generic object (including null-prototype) — every own enumerable
      // key is listed, but a getter-backed one is labeled, never invoked.
      const keys = safeDataKeys(obj);
      const parts: string[] = [];
      for (let i = 0; i < Math.min(keys.length, MAX_KEYS); i++) {
        const { key, isGetter } = keys[i]!;
        if (isGetter) {
          parts.push(`${key}: [Getter]`);
          continue;
        }
        let propValue: unknown;
        try {
          propValue = (obj as Record<string, unknown>)[key];
        } catch {
          parts.push(`${key}: [Unreadable]`);
          continue;
        }
        parts.push(`${key}: ${serializeValue(propValue, depth + 1, seen)}`);
      }
      if (keys.length > MAX_KEYS) {
        parts.push(`… ${keys.length - MAX_KEYS} more keys`);
      }
      return `{${parts.join(", ")}}`;
    } finally {
      seen.delete(obj);
    }
  } catch {
    return "[Unserializable]";
  }
}

/** Serialize one arbitrary value to a bounded, safe string. Never throws. */
export function safeSerialize(value: unknown): string {
  try {
    return serializeValue(value, 0, new WeakSet());
  } catch {
    return "[Unserializable]";
  }
}

const FORMAT_SPECIFIER_PATTERN = /%[sdifoOjc%]/g;

/**
 * `console.log`-style printf substitution (`%s %d %i %f %o %O %j %c`),
 * falling back to plain space-joined serialization when the first argument
 * isn't a format string (or there are more/fewer specifiers than
 * arguments — Node and browser consoles both just append the leftovers).
 * `%c` (CSS styling) consumes one argument and contributes nothing to the
 * visible text, matching real console behavior.
 */
export function formatConsoleArgs(args: unknown[]): string {
  try {
    if (args.length === 0) return "";
    const first = args[0];
    if (typeof first !== "string" || !FORMAT_SPECIFIER_PATTERN.test(first)) {
      return args.map((a) => safeSerialize(a)).join(" ");
    }

    let argIndex = 1;
    const formatted = first.replace(FORMAT_SPECIFIER_PATTERN, (specifier) => {
      if (specifier === "%%") return "%";
      if (argIndex >= args.length) return specifier;
      const arg = args[argIndex];
      switch (specifier) {
        case "%s":
          argIndex++;
          return typeof arg === "string" ? arg : safeSerialize(arg);
        case "%d":
        case "%i": {
          argIndex++;
          const n = Number(arg);
          return Number.isNaN(n) ? "NaN" : String(Math.trunc(n));
        }
        case "%f": {
          argIndex++;
          const n = Number(arg);
          return String(n);
        }
        case "%o":
        case "%O":
          argIndex++;
          return safeSerialize(arg);
        case "%j":
          argIndex++;
          try {
            return JSON.stringify(arg) ?? "undefined";
          } catch {
            return safeSerialize(arg);
          }
        case "%c":
          // CSS styling directive — consumes the arg, renders nothing.
          argIndex++;
          return "";
        default:
          return specifier;
      }
    });

    const rest = args.slice(argIndex).map((a) => safeSerialize(a));
    return [formatted, ...rest].filter((s) => s !== "").join(" ");
  } catch {
    return "[Unserializable console arguments]";
  }
}

/** Cap a fully-built message at the per-entry limit — the last line of defence before it goes into any buffer. */
export function capEntryLength(message: string): string {
  if (message.length <= MAX_ENTRY_LENGTH) return message;
  return `${message.slice(0, MAX_ENTRY_LENGTH)}…[+${message.length - MAX_ENTRY_LENGTH} chars]`;
}
