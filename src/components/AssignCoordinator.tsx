"use client";

import { useState } from "react";
import { Button, ConfirmDialog, Select } from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { cn } from "@/lib/cn";

// SPM-30. One control for both places the Ops Manager assigns from - a row on
// the Assignments screen (S-28) and the event's own Overview page - so the
// two cannot disagree about what "assign" and "reassign" mean.
//
//   no current coordinator -> "Assign": takes effect on click. The server also
//                             moves the event to Under review.
//   has one                -> "Reassign": asks first, because it takes the
//                             event away from someone who may be mid-way
//                             through planning it.
//
// Picking the coordinator who already has it disables the button and says so,
// rather than sending a no-op the server would refuse anyway.

export interface CoordinatorOption {
  id: string;
  fullName: string;
}

export interface AssignResult {
  status: string;
  coordinator: CoordinatorOption;
  previousCoordinator: CoordinatorOption | null;
}

interface AssignCoordinatorProps {
  /// The event's reference, e.g. "EVT-000123".
  eventRef: string;
  eventTitle: string;
  current: CoordinatorOption | null;
  coordinators: CoordinatorOption[];
  onAssigned: (result: AssignResult) => void;
  /// Accessible name for the select when there is no visible label (table rows).
  label?: string;
  className?: string;
}

export function AssignCoordinator({
  eventRef,
  eventTitle,
  current,
  coordinators,
  onAssigned,
  label = "Assign to",
  className,
}: AssignCoordinatorProps) {
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReassign = current !== null;
  const chosen = coordinators.find((c) => c.id === selected) ?? null;
  const isSame = isReassign && selected === current.id;

  async function submit() {
    if (!chosen) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/events/${eventRef}/coordinator`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinatorId: chosen.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Could not save the coordinator.");
      }
      setSelected("");
      setConfirming(false);
      onAssigned(body as AssignResult);
    } catch (err) {
      setConfirming(false);
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={`${label} — ${eventTitle}`}
          className="min-w-[12rem] flex-1"
          placeholder="Choose a coordinator"
          options={coordinators.map((c) => ({ value: c.id, label: c.fullName }))}
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setError(null);
          }}
          disabled={saving}
        />
        <Button
          size="sm"
          variant={isReassign ? "secondary" : "primary"}
          disabled={!chosen || isSame}
          loading={saving && !confirming}
          loadingText={isReassign ? "Reassigning…" : "Assigning…"}
          onClick={() => (isReassign ? setConfirming(true) : void submit())}
        >
          {isReassign ? "Reassign" : "Assign"}
        </Button>
      </div>

      {isSame && (
        <p className="text-xs text-ink-3">{current.fullName} is already the assigned coordinator.</p>
      )}
      {error && (
        <p role="alert" className="text-xs font-medium text-tone-danger-fg">
          {error}
        </p>
      )}

      {isReassign && chosen && (
        <ConfirmDialog
          open={confirming}
          title="Reassign this event?"
          confirmLabel="Reassign"
          confirmVariant="primary"
          loading={saving}
          onConfirm={() => void submit()}
          onCancel={() => setConfirming(false)}
        >
          &ldquo;{eventTitle}&rdquo; moves from {current.fullName} to {chosen.fullName}.{" "}
          {current.fullName} will no longer be able to manage it. Both coordinators are notified.
        </ConfirmDialog>
      )}
    </div>
  );
}
