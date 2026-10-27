import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import * as React from "react";

import { useTranslation } from "../../i18n/context";
import { cn } from "../../lib/utils";

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none fixed inset-0 z-50 bg-background/70",
        className,
      )}
      {...props}
    />
  );
}

const DIALOG_WIDTH = {
  default: "max-w-[min(calc(100vw-2rem),400px)]",
  wide: "max-w-[min(calc(100vw-2rem),672px)]",
  preview: "max-w-[min(calc(100vw-2rem),800px)]",
} as const;

/**
 * Focus returns to the element that had it when the dialog opened, also
 * when it was opened by a plain button rather than a DialogTrigger.
 */
function useOpenerFocus({
  onOpenAutoFocus,
  onCloseAutoFocus,
}: Pick<
  React.ComponentProps<typeof DialogPrimitive.Content>,
  "onOpenAutoFocus" | "onCloseAutoFocus"
>) {
  const opener = React.useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus(event: Event) {
      const active = document.activeElement;
      opener.current =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus(event: Event) {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented || !opener.current?.isConnected) return;
      event.preventDefault();
      opener.current.focus();
    },
  };
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  size = "default",
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  size?: keyof typeof DIALOG_WIDTH;
}) {
  const { t } = useTranslation();
  const focus = useOpenerFocus({ onOpenAutoFocus, onCloseAutoFocus });
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-card text-card-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 motion-reduce:animate-none fixed top-[50%] left-[50%] z-50 grid w-full max-h-[calc(100dvh-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto rounded-xl border border-border p-5 shadow-lg duration-200",
          DIALOG_WIDTH[size],
          className,
        )}
        {...focus}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-3 right-3 inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">{t("common.close")}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

/** A panel that slides in from the left over a scrim: a menu drawer. */
function DrawerContent({
  className,
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  const focus = useOpenerFocus({ onOpenAutoFocus, onCloseAutoFocus });
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          "bg-card text-card-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left motion-reduce:animate-none fixed inset-y-0 left-0 z-50 flex w-[min(320px,85%)] flex-col overflow-y-auto border-r border-border shadow-lg duration-200 outline-none",
          className,
        )}
        {...focus}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1 pr-8 text-left", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-wrap items-center justify-end gap-2", className)}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-title font-semibold text-foreground", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogContent,
  DrawerContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
};
