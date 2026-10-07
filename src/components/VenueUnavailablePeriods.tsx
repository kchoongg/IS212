"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, ConfirmDialog, Field, Input, Select, Textarea } from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { readServerError, type FieldErrors } from "@/lib/formErrors";
import { SLOTS } from "@/lib/venueSlots";
import {
  EMPTY_PERIOD_FORM,
  OTHER_REASON_MAX,
  UNAVAILABILITY_REASONS,
  describePeriod,
  periodPayload,
  unavailabilityReasonLabel,
  validatePeriodForm,
  type PeriodBounds,
  type PeriodFormValues,
} from "@/lib/venueUnavailability";
import type { ImpactReason } from "@/lib/venueImpact";

// SPM-45 (Record Venue Unavailability), on the venue editor (S-20).
//
// Lists the venue's unavailable periods that are under way or still to come,
// and lets Venue Staff mark the venue unavailable, change a period, or end one
// early. A period closes the room for its slots only - the venue stays active
// and in the catalogue, which is what separates this from "Retire venue".
//
// This is a dialog on the editor rather than the separate "Block venue" screen
// (S-23) UI_DESIGN.md sketched: the story was scoped down to recording a
// period, and the editor is where Venue Staff already are.

/// One entry of GET /api/venues/[id]/unavailability.
interface Period extends PeriodBounds {
  id: string;
  reason: string;
  /// The description of an "other" reason.
  otherReason: string | null;
}

/// One entry of a response's `flaggedBookings` - the same shape the venue
/// PATCH returns, so the editor reports both the same way.
export interface FlaggedByPeriod {
  bookingId: string;
  eventId: string;
  eventTitle: string | null;
  sessionLabel: string | null;
  reasons: ImpactReason[];
}

export type PeriodAction = "period_saved" | "period_changed" | "period_ended";

const SLOT_OPTIONS = SLOTS.map((slot) => ({ value: slot, label: slot }));
const REASON_OPTIONS = UNAVAILABILITY_REASONS.map((reason) => ({
  value: reason,
  label: unavailabilityReasonLabel(reason),
}));
const NETWORK_ERROR = "Could not reach the server. Check your connection and try again.";

export function VenueUnavailablePeriods({
  venueId,
  venueName,
  onStart,
  onResult,
}: {
  venueId: string;
  venueName: string;
  /// A change is being sent: the editor clears what the last one reported.
  onStart: () => void;
  /// A change went through: what it did, for the editor to say at the top.
  onResult: (action: PeriodAction, flagged: FlaggedByPeriod[]) => void;
}) {
  const base = `/api/venues/${venueId}/unavailability`;

  const [periods, setPeriods] = useState<Period[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  // The period being changed, or null when marking a new one. Kept when the
  // dialog closes, so its title does not flip while it is closing.
  const [editing, setEditing] = useState<Period | null>(null);
  const [values, setValues] = useState<PeriodFormValues>(EMPTY_PERIOD_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authedFetch(base);
      if (!res.ok) {
        setListError("Could not load this venue's unavailable periods.");
        return;
      }
      setPeriods(await res.json());
    } catch {
      setListError(NETWORK_ERROR);
    }
  }, [base]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function openDialog(period: Period | null) {
    setEditing(period);
    setValues(
      period
        ? {
            fromDay: period.fromDay,
            fromSlot: period.fromSlot,
            untilDay: period.untilDay,
            untilSlot: period.untilSlot,
            reason: period.reason,
            otherReason: period.otherReason ?? "",
          }
        : EMPTY_PERIOD_FORM
    );
    setErrors({});
    setDialogError(null);
    setDialogOpen(true);
  }

  function change<K extends keyof PeriodFormValues>(field: K, value: PeriodFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function save() {
    const clientErrors = validatePeriodForm(values);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      return;
    }

    setDialogError(null);
    onStart();
    setPending("save");
    try {
      const res = await authedFetch(editing ? `${base}/${editing.id}` : base, {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(periodPayload(values)),
      });
      const payload = await res.json();
      if (!res.ok) {
        const { formError, fieldErrors } = readServerError(payload, "Could not save this unavailable period");
        setErrors(fieldErrors);
        setDialogError(formError);
        return;
      }
      setDialogOpen(false);
      onResult(editing ? "period_changed" : "period_saved", payload.flaggedBookings ?? []);
      await load();
    } catch {
      setDialogError(NETWORK_ERROR);
    } finally {
      setPending(null);
    }
  }

  /// No confirmation: ending a period closes nothing and loses nothing - the
  /// room simply becomes available again, and a period can be marked again.
  async function end(period: Period) {
    setListError(null);
    onStart();
    setPending(`end:${period.id}`);
    try {
      const res = await authedFetch(`${base}/${period.id}`, { method: "DELETE" });
      const payload = await res.json();
      if (!res.ok) {
        setListError(readServerError(payload, "Could not end this unavailable period").formError);
        return;
      }
      onResult("period_ended", []);
      await load();
    } catch {
      setListError(NETWORK_ERROR);
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-labelledby="unavailable-periods-title" className="mt-6 rounded-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="unavailable-periods-title" className="font-display text-base font-semibold text-ink">
            Unavailable periods
          </h2>
          <p className="mt-1 text-sm text-ink-3">
            When this room is out of use. It stays in the catalogue, and cannot be requested for these slots.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={() => openDialog(null)} disabled={pending !== null}>
          Mark unavailable
        </Button>
      </div>

      {listError && (
        <Alert variant="error" className="mt-3">
          {listError}
        </Alert>
      )}

      {periods && periods.length === 0 && (
        <p className="mt-3 text-sm text-ink-3">No unavailable periods under way or coming up.</p>
      )}

      {periods && periods.length > 0 && (
        <ul className="mt-3 flex flex-col divide-y divide-line">
          {periods.map((period) => (
            <li key={period.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-col gap-1">
                <span className="font-medium text-ink">{unavailabilityReasonLabel(period.reason)}</span>
                {period.otherReason && <p className="text-sm text-ink-2">{period.otherReason}</p>}
                <p className="text-sm text-ink-2">{describePeriod(period)}</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => openDialog(period)} disabled={pending !== null}>
                  Change period
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void end(period)}
                  loading={pending === `end:${period.id}`}
                  disabled={pending !== null}
                >
                  End period
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={dialogOpen}
        title={editing ? "Change unavailable period" : `Mark ${venueName} unavailable`}
        confirmLabel={editing ? "Save period" : "Mark unavailable"}
        confirmVariant="primary"
        loading={pending === "save"}
        onConfirm={() => void save()}
        onCancel={() => setDialogOpen(false)}
      >
        {/* Only while open: a closed dialog should not leave a second set of
            fields and options in the page. */}
        {dialogOpen && (
          <div className="flex flex-col gap-3">
            <p>
              Any approved booking in these slots will be <strong>flagged for review</strong>, and the
              coordinator responsible for it will be notified. No booking is cancelled or moved.
            </p>

            {dialogError && <Alert variant="error">{dialogError}</Alert>}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Unavailable from" required error={errors.fromDay}>
                <Input type="date" name="fromDay" value={values.fromDay} onChange={(e) => change("fromDay", e.target.value)} />
              </Field>
              <Field label="First unavailable slot">
                <Select
                  name="fromSlot"
                  options={SLOT_OPTIONS}
                  value={values.fromSlot}
                  onChange={(e) => change("fromSlot", e.target.value as PeriodFormValues["fromSlot"])}
                />
              </Field>
              <Field label="Available again on" required error={errors.untilDay}>
                <Input type="date" name="untilDay" value={values.untilDay} onChange={(e) => change("untilDay", e.target.value)} />
              </Field>
              <Field label="First available slot">
                <Select
                  name="untilSlot"
                  options={SLOT_OPTIONS}
                  value={values.untilSlot}
                  onChange={(e) => change("untilSlot", e.target.value as PeriodFormValues["untilSlot"])}
                />
              </Field>
            </div>

            <Field label="Reason" required error={errors.reason}>
              <Select
                name="reason"
                options={REASON_OPTIONS}
                placeholder="Choose a reason"
                value={values.reason}
                onChange={(e) => change("reason", e.target.value)}
              />
            </Field>

            {values.reason === "other" && (
              <Field label="Other reason" required error={errors.otherReason} hint="Included in the notification to each coordinator.">
                <Textarea
                  name="otherReason"
                  rows={2}
                  maxLength={OTHER_REASON_MAX}
                  value={values.otherReason}
                  onChange={(e) => change("otherReason", e.target.value)}
                />
              </Field>
            )}
          </div>
        )}
      </ConfirmDialog>
    </section>
  );
}
