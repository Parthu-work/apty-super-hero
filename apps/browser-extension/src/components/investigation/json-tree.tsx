import { cn } from "@apty/ui/lib/utils";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

const CHILDREN_PAGE = 100;

function summarize(value: unknown): string {
  if (Array.isArray(value)) return `Array(${value.length})`;
  return `{${Object.keys(value as object).length} keys}`;
}

function Primitive({ value }: { value: unknown }) {
  if (typeof value === "string") {
    return <span className="text-success">"{value}"</span>;
  }
  if (value === null)
    return <span className="text-muted-foreground">null</span>;
  return <span className="text-primary">{String(value)}</span>;
}

interface JsonNodeProps {
  name?: string;
  value: unknown;
  depth: number;
}

function JsonNode({ name, value, depth }: JsonNodeProps) {
  const isContainer = typeof value === "object" && value !== null;
  const [open, setOpen] = useState(depth < 1);
  const [shown, setShown] = useState(CHILDREN_PAGE);
  const label = name !== undefined && (
    <span className="text-foreground">{name}: </span>
  );

  if (!isContainer) {
    return (
      <div className="pl-4">
        {label}
        <Primitive value={value} />
      </div>
    );
  }

  const entries = Object.entries(value as object);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-0.5 text-left hover:bg-muted/50"
      >
        {open ? (
          <ChevronDownIcon className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRightIcon className="h-3 w-3 shrink-0" />
        )}
        {label}
        <span className="text-muted-foreground">{summarize(value)}</span>
      </button>
      {open && (
        <div className="ml-1.5 border-l pl-1.5">
          {entries.slice(0, shown).map(([key, child]) => (
            <JsonNode key={key} name={key} value={child} depth={depth + 1} />
          ))}
          {entries.length > shown && (
            <button
              type="button"
              className="pl-4 text-primary hover:underline"
              onClick={() => setShown(shown + CHILDREN_PAGE)}
            >
              Show {Math.min(CHILDREN_PAGE, entries.length - shown)} more of{" "}
              {entries.length - shown}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Collapsible JSON tree; large arrays and objects page in 100 children at a time. */
export function JsonTree({
  value,
  className,
}: {
  value: unknown;
  className?: string;
}) {
  return (
    <div className={cn("font-mono text-xs leading-5", className)}>
      <JsonNode value={value} depth={0} />
    </div>
  );
}
