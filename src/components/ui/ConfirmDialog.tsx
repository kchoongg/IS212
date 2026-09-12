"use client";

import { useEffect, useRef } from "react";
import { Button, type ButtonVariant } from "./Button";

// UI_DESIGN.md §7.5. Destructive actions name their specific consequence:
// "This releases Marina Grand Hall on 3 Oct and cancels 42 registrations",
// never "Are you sure?".
//
// Built on the native <dialog>, which gives focus trapping, Esc-to-close and
// the top layer without a dependency or a hand-rolled trap.

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /// What will actually happen. Pass the real list of affected bookings,
  /// reservations and registrations where there is one.
  children: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  confirmVariant = "danger",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      // Esc fires `cancel`; route it through the same handler as the Cancel
      // button so the caller's state cannot drift out of sync with the dialog.
      onCancel={(e) => {
        e.preventDefault();
        if (!loading) onCancel();
      }}
      onClose={() => {
        if (open && !loading) onCancel();
      }}
      aria-labelledby="confirm-dialog-title"
      className="w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-line p-0 shadow-raised backdrop:bg-ink/40"
    >
      <div className="px-5 py-4">
        <h2 id="confirm-dialog-title" className="font-display text-lg font-semibold text-ink">
          {title}
        </h2>
        <div className="mt-2 text-sm text-ink-2">{children}</div>
      </div>
      <div className="flex justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">
        <Button variant="secondary" onClick={onCancel} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button variant={confirmVariant} onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
