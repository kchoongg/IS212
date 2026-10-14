"use client";

import { useState } from "react";
import { ConfirmDialog, Field, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { SafetyDecision } from "@/lib/safetyDecision";

// SPM-87: the Safety Officer's decision on an event in Safety review - approve,
// request changes or reject (AC3-AC5), with the changes or the reason required
// for the last two (AC6). The page sends it; this only collects and checks it.

const CHOICES: { value: SafetyDecision; label: string; box?: string; missing?: string }[] = [
  { value: "approved", label: "Approve" },
  {
    value: "changes_requested",
    label: "Request changes",
    box: "Changes required",
    missing: "Describe the changes required.",
  },
  { value: "rejected", label: "Reject", box: "Reason for rejecting", missing: "Give a reason for rejecting." },
];

export function SafetyDecisionDialog({
  open,
  eventTitle,
  saving,
  onRecord,
  onCancel,
}: {
  open: boolean;
  eventTitle: string | null;
  saving: boolean;
  onRecord: (decision: SafetyDecision, note: string | undefined) => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<SafetyDecision | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const chosen = CHOICES.find((c) => c.value === choice);

  function reset() {
    setChoice(null);
    setNote("");
    setError(null);
  }

  function record() {
    if (!chosen) {
      setError("Choose a decision.");
      return;
    }
    const trimmed = note.trim();
    if (chosen.missing && !trimmed) {
      setError(chosen.missing);
      return;
    }
    onRecord(chosen.value, chosen.box ? trimmed : undefined);
    reset();
  }

  return (
    <ConfirmDialog
      open={open}
      title="Record safety decision"
      confirmLabel="Record decision"
      confirmVariant="primary"
      loading={saving}
      onConfirm={record}
      onCancel={() => {
        reset();
        onCancel();
      }}
    >
      <p>
        Your decision on the Operational Safety Check for {eventTitle || "this event"}. The coordinator is
        notified of it.
      </p>
      <div role="radiogroup" aria-label="Decision" className="mt-3 flex flex-col gap-2">
        {CHOICES.map((c) => (
          <label
            key={c.value}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-lg border bg-surface px-3 py-2 text-sm text-ink",
              choice === c.value ? "border-ink ring-1 ring-inset ring-ink" : "border-line"
            )}
          >
            <input
              type="radio"
              name="safety-decision"
              checked={choice === c.value}
              onChange={() => {
                setChoice(c.value);
                setError(null);
              }}
              className="h-4 w-4 accent-ink"
            />
            {c.label}
          </label>
        ))}
      </div>
      {chosen?.box ? (
        <Field label={chosen.box} error={error} className="mt-3">
          <Textarea
            value={note}
            maxLength={1000}
            rows={4}
            onChange={(e) => {
              setNote(e.target.value);
              if (error) setError(null);
            }}
          />
        </Field>
      ) : (
        error && <p className="mt-3 text-sm text-tone-danger-fg">{error}</p>
      )}
    </ConfirmDialog>
  );
}
