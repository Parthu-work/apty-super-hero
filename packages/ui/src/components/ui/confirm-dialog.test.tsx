import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import { ConfirmDialog } from "./confirm-dialog";

function DeleteChat({
  onConfirm,
  pending,
}: {
  onConfirm: () => void;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Delete chat</Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this chat?"
        description="This can't be undone."
        confirmLabel="Delete"
        onConfirm={onConfirm}
        pending={pending}
      />
    </>
  );
}

describe("ConfirmDialog", () => {
  it("opens on Cancel, with the safe action first and the danger action last", () => {
    render(<DeleteChat onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete chat" }));

    const dialog = screen.getByRole("alertdialog", {
      name: "Delete this chat?",
    });
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    const footer = dialog.querySelector("[data-slot=dialog-footer]");
    expect(
      [...(footer?.querySelectorAll("button") ?? [])].map((b) => b.textContent),
    ).toEqual(["Cancel", "Delete"]);
  });

  it("confirms only from the danger action, and Cancel closes without it", () => {
    const onConfirm = vi.fn();
    render(<DeleteChat onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("stays open on Esc while its request runs", () => {
    render(<DeleteChat onConfirm={vi.fn()} pending />);
    fireEvent.click(screen.getByRole("button", { name: "Delete chat" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });
});
