import { ArrowDownIcon, ArrowUpIcon, CornerDownLeftIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../../i18n/context";
import { cn } from "../../lib/utils";
import type { SlashCommand, SlashCommandGroup } from "./slash-commands";

export const SLASH_MENU_ID = "prompt-input-slash-menu";

export function slashOptionId(command: SlashCommand): string {
  return `${SLASH_MENU_ID}-${command.id.replace(/[^\w-]/g, "_")}`;
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-strong px-1 font-sans text-xs text-muted-foreground [&_svg]:size-3">
      {children}
    </kbd>
  );
}

/**
 * The "/" list above the composer. Focus stays in the composer, which
 * points at the highlighted row with aria-activedescendant.
 */
export function SlashCommandMenu({
  groups,
  highlighted,
  position,
  onSelect,
  onHighlight,
}: {
  groups: SlashCommandGroup[];
  highlighted: SlashCommand | undefined;
  position: { bottom: number; left: number; width: number };
  onSelect: (command: SlashCommand) => void;
  onHighlight: (command: SlashCommand) => void;
}) {
  const { t } = useTranslation();
  const highlightedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlighted)
      highlightedRef.current?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed z-50"
      style={{
        bottom: `${position.bottom}px`,
        left: `${position.left}px`,
        width: `${position.width}px`,
      }}
    >
      <div className="overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
        <div
          id={SLASH_MENU_ID}
          role="listbox"
          aria-label={t("slash.label")}
          // A tab stop, so a keyboard can scroll the list from here too
          tabIndex={0}
          className="max-h-96 overflow-y-auto rounded-lg p-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
        >
          {groups.map((group) => (
            <div
              key={group.id}
              role="group"
              aria-labelledby={`${SLASH_MENU_ID}-group-${group.id}`}
            >
              <div
                id={`${SLASH_MENU_ID}-group-${group.id}`}
                className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground"
              >
                {group.label}
              </div>
              {group.commands.map((command) => {
                const selected = command === highlighted;
                return (
                  <div
                    key={command.id}
                    id={slashOptionId(command)}
                    ref={selected ? highlightedRef : undefined}
                    role="option"
                    aria-selected={selected}
                    tabIndex={-1}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2",
                      selected && "bg-accent",
                    )}
                    onMouseMove={() => onHighlight(command)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      onSelect(command);
                    }}
                  >
                    {command.icon && (
                      <span
                        aria-hidden="true"
                        className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4"
                      >
                        {command.icon}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {command.label}
                      </span>
                      {command.description && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {command.description}
                        </span>
                      )}
                    </span>
                    {selected && (
                      <Key>
                        <CornerDownLeftIcon aria-hidden="true" />
                      </Key>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Key>
              <ArrowUpIcon aria-hidden="true" />
            </Key>
            <Key>
              <ArrowDownIcon aria-hidden="true" />
            </Key>
            {t("slash.move")}
          </span>
          <span className="flex items-center gap-1">
            <Key>
              <CornerDownLeftIcon aria-hidden="true" />
            </Key>
            {t("slash.open")}
          </span>
          <span className="flex items-center gap-1">
            <Key>{t("slash.escapeKey")}</Key>
            {t("slash.close")}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
