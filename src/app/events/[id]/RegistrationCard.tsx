"use client";

import { useRef, useState } from "react";
import { Alert, Button, Card, CardBody, CardHeader, Checkbox, DetailList, Field, Input, Select } from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { EMPTY, formatDateTime, orEmpty, toDateTimeLocalValue } from "@/lib/format";
import { toIso } from "@/lib/eventForm";
import { focusFirstError, readServerError, type FieldErrors } from "@/lib/formErrors";
import { registrationGaps } from "@/lib/eventConfirmation";
import { humanise } from "@/lib/statuses";
import { layoutLabel } from "@/lib/venueSuitability";
import type { RegistrationCounts } from "@/lib/registrationEligibility";

// Configure Event Registration (SPM-64): the Registration card on the event's
// Overview. Read-only for everyone who can see the event (AC10, AC11); the
// assigned coordinator, while the event is Approved, Planning or Confirmed,
// changes the settings here (PATCH /api/events/[id]/registration). The rules
// are the server's (src/lib/registrationSettings.ts) - the form checks
// nothing itself and shows each refusal under its own field.

interface MeasuredBooking {
  id: string;
  status: string;
  layoutName: string | null;
  venue: { name: string; code: string; layouts: { layoutName: string; capacity: number }[] };
}

export interface RegistrationEvent {
  registrationEnabled: boolean;
  registrationCapacity: number | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  /// Absent for an Attendee: which room caps the capacity is internal.
  registrationVenueBookingId?: string | null;
  registrationVenueBooking?: MeasuredBooking | null;
  /// SPM-52 AC5: sent to the organiser and coordinator only.
  registrationCounts?: RegistrationCounts;
}

/// One of the bookings GET /api/events/[id]/registration offers.
interface BookingOption {
  id: string;
  status: string;
  layoutName: string | null;
  layoutCapacity: number | null;
  venue: { name: string; code: string };
}

interface FormValues {
  enabled: boolean;
  capacity: string;
  bookingId: string;
  opensAt: string;
  closesAt: string;
}

const UNREACHABLE = "Could not reach the server. Check your connection and try again.";

function valuesOf(event: RegistrationEvent): FormValues {
  return {
    enabled: event.registrationEnabled,
    capacity: event.registrationCapacity == null ? "" : String(event.registrationCapacity),
    bookingId: event.registrationVenueBookingId ?? "",
    opensAt: toDateTimeLocalValue(event.registrationOpensAt),
    closesAt: toDateTimeLocalValue(event.registrationClosesAt),
  };
}

/// Only what changed is sent, as on Edit event information. An emptied field
/// is left as it was: no AC asks for clearing a setting.
function changesFrom(initial: FormValues, values: FormValues): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (values.enabled !== initial.enabled) body.registrationEnabled = values.enabled;
  if (values.capacity !== initial.capacity && values.capacity !== "") body.registrationCapacity = Number(values.capacity);
  if (values.bookingId !== initial.bookingId && values.bookingId !== "") body.registrationVenueBookingId = values.bookingId;
  if (values.opensAt !== initial.opensAt && values.opensAt !== "") body.registrationOpensAt = toIso(values.opensAt);
  if (values.closesAt !== initial.closesAt && values.closesAt !== "") body.registrationClosesAt = toIso(values.closesAt);
  return body;
}

/// "Orchard Seminar Room (ORC-SEM), Classroom layout – up to 70".
function measuredAgainst(booking: MeasuredBooking | null): string {
  if (!booking) return EMPTY;
  const room = `${booking.venue.name} (${booking.venue.code})`;
  const layout = booking.venue.layouts.find((l) => l.layoutName === booking.layoutName);
  return layout ? `${room}, ${layoutLabel(layout.layoutName)} layout – up to ${layout.capacity}` : room;
}

/// "Orchard Studio (ORC-STU) · Classroom · up to 40 · Pending".
function optionLabel(b: BookingOption): string {
  return [
    `${b.venue.name} (${b.venue.code})`,
    ...(b.layoutName ? [layoutLabel(b.layoutName)] : []),
    ...(b.layoutCapacity != null ? [`up to ${b.layoutCapacity}`] : []),
    humanise(b.status),
  ].join(" · ");
}

/// "12 of 40 · 28 left", or just "12" when no capacity is set (no limit).
function placesTaken(counts: RegistrationCounts, capacity: number | null): string {
  if (capacity == null) return String(counts.taken);
  return `${counts.taken} of ${capacity} · ${Math.max(capacity - counts.taken, 0)} left`;
}

interface Props {
  event: RegistrationEvent;
  eventId: string;
  /// The assigned coordinator, in a status that allows changes.
  canChange: boolean;
  /// Show the outstanding alert. Not for an Attendee - planning is internal.
  showOutstanding: boolean;
  /// Called after a successful save, to reload the event.
  onSaved: () => void;
}

export function RegistrationCard({ event, eventId, canChange, showOutstanding, onSaved }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState(false);
  const [initial, setInitial] = useState<FormValues>(() => valuesOf(event));
  const [values, setValues] = useState<FormValues>(initial);
  const [bookings, setBookings] = useState<BookingOption[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ flagged: string[] } | null>(null);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  async function startEditing() {
    const start = valuesOf(event);
    setInitial(start);
    setValues(start);
    setFieldErrors({});
    setFormError(null);
    setSaved(null);
    setEditing(true);
    try {
      const res = await authedFetch(`/api/events/${eventId}/registration`);
      if (res.ok) {
        const list: BookingOption[] = (await res.json()).bookings;
        setBookings(list);
        // AC8: the booking the capacity was measured against is no longer
        // active, and one active booking remains - use it, so pressing Save
        // re-measures against it. With several, the coordinator chooses.
        if (start.bookingId !== "" && list.length === 1 && list[0].id !== start.bookingId) {
          setValues((current) => ({ ...current, bookingId: list[0].id }));
        }
      }
    } catch {
      // Without the list the form still works for a single booking; the
      // server picks it, and says so if a choice is needed.
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFormError(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}/registration`, {
        method: "PATCH",
        body: JSON.stringify(changesFrom(initial, values)),
      });
      const body = await res.json();
      if (!res.ok) {
        const { formError: message, fieldErrors: errors } = readServerError(body, "Could not save the registration settings.");
        setFieldErrors(errors);
        setFormError(message);
        focusFirstError(formRef.current, errors);
        return;
      }
      setSaved({ flagged: body.flagged ?? [] });
      setEditing(false);
      onSaved();
    } catch {
      setFormError(UNREACHABLE);
    } finally {
      setSaving(false);
    }
  }

  const gaps =
    showOutstanding && event.registrationEnabled
      ? registrationGaps(
          {
            enabled: true,
            capacity: event.registrationCapacity,
            opensAt: event.registrationOpensAt ? new Date(event.registrationOpensAt) : null,
            closesAt: event.registrationClosesAt ? new Date(event.registrationClosesAt) : null,
            measuredBookingId: event.registrationVenueBookingId ?? null,
          },
          event.registrationVenueBooking ? [event.registrationVenueBooking] : []
        )
      : null;

  const readOnly = (
    <DetailList
      items={
        event.registrationEnabled
          ? [
              { label: "Registration", value: "Enabled" },
              { label: "Capacity", value: orEmpty(event.registrationCapacity) },
              ...(event.registrationVenueBooking !== undefined
                ? [{ label: "Measured against", value: measuredAgainst(event.registrationVenueBooking) }]
                : []),
              { label: "Opens", value: formatDateTime(event.registrationOpensAt) },
              { label: "Closes", value: formatDateTime(event.registrationClosesAt) },
              ...(event.registrationCounts
                ? [
                    { label: "Places taken", value: placesTaken(event.registrationCounts, event.registrationCapacity) },
                    { label: "Withdrawn", value: String(event.registrationCounts.withdrawn) },
                  ]
                : []),
            ]
          : [{ label: "Registration", value: "Not enabled for this event" }]
      }
    />
  );

  return (
    <Card>
      <CardHeader
        title="Registration"
        aside={
          canChange && !editing ? (
            <Button variant="secondary" size="sm" onClick={() => void startEditing()}>
              Change registration settings
            </Button>
          ) : undefined
        }
      />
      <CardBody>
        <div className="flex flex-col gap-4">
          {saved && <Alert variant="success">Registration settings saved.</Alert>}
          {saved && saved.flagged.length > 0 && (
            <Alert variant="warning" title="Flagged for review">
              <p>The registrations have not been changed.</p>
              <ul className="mt-2 list-disc pl-5">
                {saved.flagged.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </Alert>
          )}
          {gaps && (gaps.stillNeeded.length > 0 || gaps.bookingLost) && (
            <Alert variant="warning" title="Registration setup is incomplete">
              {gaps.stillNeeded.length > 0 && <p>Still needed: {gaps.stillNeeded.join(", ")}.</p>}
              {gaps.bookingLost && (
                <p>The venue booking the capacity was measured against is no longer active. Choose another booking.</p>
              )}
            </Alert>
          )}

          {!editing ? (
            readOnly
          ) : (
            <form ref={formRef} noValidate onSubmit={(e) => void save(e)} className="flex flex-col gap-4">
              {formError && <Alert variant="error">{formError}</Alert>}
              <Checkbox
                name="registrationEnabled"
                label="Attendees need to register for this event"
                checked={values.enabled}
                onChange={(e) => set("enabled", e.target.checked)}
              />
              {values.enabled && (
                <>
                  <Field
                    label="Registration capacity"
                    hint="How many attendees can register. It can't be more than the booked room holds in its layout."
                    error={fieldErrors.registrationCapacity}
                  >
                    <Input
                      name="registrationCapacity"
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      value={values.capacity}
                      onChange={(e) => set("capacity", e.target.value)}
                    />
                  </Field>
                  {bookings.length > 1 && (
                    <Field
                      label="Capacity measured against"
                      hint="This event has more than one venue booking."
                      error={fieldErrors.registrationVenueBookingId}
                    >
                      <Select
                        name="registrationVenueBookingId"
                        placeholder="Choose a booking"
                        options={bookings.map((b) => ({ value: b.id, label: optionLabel(b) }))}
                        value={bookings.some((b) => b.id === values.bookingId) ? values.bookingId : ""}
                        onChange={(e) => set("bookingId", e.target.value)}
                      />
                    </Field>
                  )}
                  <Field label="Registration opens" error={fieldErrors.registrationOpensAt}>
                    <Input
                      name="registrationOpensAt"
                      type="datetime-local"
                      value={values.opensAt}
                      onChange={(e) => set("opensAt", e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Registration closes"
                    hint="No later than the event starts."
                    error={fieldErrors.registrationClosesAt}
                  >
                    <Input
                      name="registrationClosesAt"
                      type="datetime-local"
                      value={values.closesAt}
                      onChange={(e) => set("closesAt", e.target.value)}
                    />
                  </Field>
                </>
              )}
              <div className="flex gap-3">
                <Button type="submit" loading={saving} loadingText="Saving…">
                  Save registration settings
                </Button>
                <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
