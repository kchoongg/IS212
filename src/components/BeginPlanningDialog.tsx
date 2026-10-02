"use client";

import { ConfirmDialog } from "@/components/ui";

// SPM-54. The coordinator's first venue or equipment action on an Approved
// event moves it to Planning (src/lib/beginPlanning.ts). That cannot be undone
// and the organiser sees it, so the coordinator is asked first - once per
// event, since only an Approved event asks. Cancelling leaves the event
// Approved and does not carry out the action either.

/// Who sees the new status, and that there is no way back. Shared with the
/// equipment screen's Remove dialog, which already asks for a confirmation and
/// adds this to it rather than asking twice. Not "everyone": an Attendee only
/// ever sees Confirmed events.
export const BEGIN_PLANNING_NOTICE =
  "The organiser and ConnectSphere staff will see this status. This cannot be undone.";

interface BeginPlanningDialogProps {
  open: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function BeginPlanningDialog({ open, loading, onConfirm, onCancel }: BeginPlanningDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      title="Begin planning?"
      confirmLabel="Continue"
      confirmVariant="primary"
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      This is the first venue or equipment action for this event, so it will move from Approved to
      Planning. {BEGIN_PLANNING_NOTICE}
    </ConfirmDialog>
  );
}
