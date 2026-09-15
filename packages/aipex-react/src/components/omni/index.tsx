import { Fragment, useEffect } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "../ui/command";

export interface OmniCommandItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  onSelect: () => void;
}

export interface OmniCommandGroup {
  heading: string;
  items: OmniCommandItem[];
}

export interface OmniProps {
  open: boolean;
  setOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  /** Command groups to render. Kept generic so this library component stays platform-agnostic — callers supply their own product-specific actions. */
  groups?: OmniCommandGroup[];
  placeholder?: string;
  emptyLabel?: string;
}

export function Omni({
  open,
  setOpen,
  groups = [],
  placeholder = "Type a command or search...",
  emptyLabel = "No results found.",
}: OmniProps) {
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [setOpen]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={placeholder} />
      <CommandList>
        <CommandEmpty>{emptyLabel}</CommandEmpty>
        {groups.map((group, index) => (
          <Fragment key={group.heading}>
            {index > 0 && <CommandSeparator />}
            <CommandGroup heading={group.heading}>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.id}
                    onSelect={() => {
                      item.onSelect();
                      setOpen(false);
                    }}
                  >
                    {Icon ? <Icon /> : null}
                    <span>{item.label}</span>
                    {item.shortcut ? (
                      <CommandShortcut>{item.shortcut}</CommandShortcut>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </Fragment>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

export default Omni;
