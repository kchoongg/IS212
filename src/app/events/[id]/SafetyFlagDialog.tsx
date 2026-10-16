"use client";

import { useEffect, useState } from "react";
import { Checkbox, ConfirmDialog } from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { FLAGGABLE_BOOKING_STATUSES, SAFETY_FLAG_NONE_MESSAGE, UNFLAGGABLE_EQUIPMENT_STATUS } from "@/lib/safetyResolution";

// SPM-88 (AC3): after the Safety Officer returns a check, the assigned
// coordinator ticks the arrangements it concerns. The page sends them; this
// loads what can be flagged - the event's pending or approved bookings and
// its equipment lines that are not cancelled - and collects the choice.

interface Option {
  id: string;
  kind: "venue" | "equipment";
  label: string;
}

interface BookingRow {
  id: string;
  status: string;
  session: { label: string | null } | null;
  venue: { name: string };
}

interface EquipmentRow {
  id: string;
  status: string;
  equipment: { name: string };
}

export interface SafetyFlagChoice {
  venueBookingIds: string[];
  equipmentRequestIds: string[];
}

async function loadOptions(eventId: string): Promise<Option[]> {
  const [bookingsRes, equipmentRes] = await Promise.all([
    authedFetch(`/api/events/${eventId}/venue-bookings`),
    authedFetch(`/api/events/${eventId}/equipment`),
  ]);
  if (!bookingsRes.ok || !equipmentRes.ok) throw new Error("not loaded");
  const { bookings } = (await bookingsRes.json()) as { bookings: BookingRow[] };
  const equipment = (await equipmentRes.json()) as EquipmentRow[];
  return [
    ...bookings
      .filter((b) => FLAGGABLE_BOOKING_STATUSES.includes(b.status))
      .map((b) => ({
        id: b.id,
        kind: "venue" as const,
        label: `Venue: ${b.session?.label ? `${b.session.label}: ` : ""}${b.venue.name}`,
      })),
    ...equipment
      .filter((r) => r.status !== UNFLAGGABLE_EQUIPMENT_STATUS)
      .map((r) => ({ id: r.id, kind: "equipment" as const, label: `Equipment: ${r.equipment.name}` })),
  ];
}

export function SafetyFlagDialog({
  open,
  eventId,
  saving,
  onFlag,
  onCancel,
}: {
  open: boolean;
  eventId: string;
  saving: boolean;
  onFlag: (choice: SafetyFlagChoice) => void;
  onCancel: () => void;
}) {
  const [options, setOptions] = useState<Option[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    loadOptions(eventId).then(
      (loaded) => live && setOptions(loaded),
      () => live && setLoadError("Could not load this event's arrangements.")
    );
    return () => {
      live = false;
    };
  }, [open, eventId]);

  function reset() {
    setOptions(null);
    setLoadError(null);
    setTicked(new Set());
    setError(null);
  }

  function toggle(id: string) {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTicked(next);
    setError(null);
  }

  function flag() {
    if (ticked.size === 0) {
      setError(SAFETY_FLAG_NONE_MESSAGE);
      return;
    }
    // Something is ticked, so the options have loaded.
    const chosen = (options as Option[]).filter((o) => ticked.has(o.id));
    onFlag({
      venueBookingIds: chosen.filter((o) => o.kind === "venue").map((o) => o.id),
      equipmentRequestIds: chosen.filter((o) => o.kind === "equipment").map((o) => o.id),
    });
    reset();
  }

  return (
    <ConfirmDialog
      open={open}
      title="Flag arrangements for review"
      confirmLabel="Flag for review"
      confirmVariant="primary"
      loading={saving}
      onConfirm={flag}
      onCancel={() => {
        reset();
        onCancel();
      }}
    >
      <p>
        Tick the arrangements the Safety Officer&apos;s decision concerns. They are flagged for review, not changed
        or cancelled, and must be resolved in Flagged Arrangements before the event is submitted again.
      </p>
      {loadError ? (
        <p className="mt-3 text-sm text-tone-danger-fg">{loadError}</p>
      ) : options === null ? (
        <p className="mt-3 text-sm text-ink-3">Loading…</p>
      ) : options.length === 0 ? (
        <p className="mt-3 text-sm text-ink-3">This event has no venue bookings or equipment to flag.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {options.map((o) => (
            <Checkbox key={o.id} label={o.label} checked={ticked.has(o.id)} onChange={() => toggle(o.id)} />
          ))}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-tone-danger-fg">{error}</p>}
    </ConfirmDialog>
  );
}
