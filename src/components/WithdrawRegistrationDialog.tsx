"use client";

import { useState } from "react";
import { Alert, ConfirmDialog } from "@/components/ui";
import { authedFetch } from "@/lib/session";

// Withdraw from Event (SPM-52): "Withdraw from <event>?" before
// PATCH /api/registrations/[id]. Shared by My Registrations (S-27) and the
// event page's "Your registration" card (S-06). Kept outside any clickable
// row: a click inside the dialog would otherwise reach the row too.
//
// The text names what happens to the place (UI_DESIGN §7.5), and promises
// nothing about the waiting list - that is SPM-66.

export interface WithdrawTarget {
  /// The registration's id.
  id: string;
  eventTitle: string | null;
}

interface Props {
  /// The registration being withdrawn, or null when the dialog is closed.
  target: WithdrawTarget | null;
  onCancel: () => void;
  /// Called after the server has withdrawn it, to reload.
  onWithdrawn: () => void;
}

export function WithdrawRegistrationDialog({ target, onCancel, onWithdrawn }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    // v8 ignore next -- the dialog's Withdraw button only shows while there is a target
    if (!target) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/registrations/${target.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "withdrawn" }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "Could not withdraw your registration.");
        return;
      }
      onWithdrawn();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setError(null);
    onCancel();
  }

  return (
    <ConfirmDialog
      open={target !== null}
      title={`Withdraw from ${target?.eventTitle || "this event"}?`}
      confirmLabel="Withdraw"
      cancelLabel="Keep my place"
      loading={saving}
      onConfirm={() => void withdraw()}
      onCancel={cancel}
    >
      {error && (
        <Alert variant="error" className="mb-3">
          {error}
        </Alert>
      )}
      Your place is released and can be taken by someone else. To attend, you would have to register again, and the
      event may be full by then.
    </ConfirmDialog>
  );
}
