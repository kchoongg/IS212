"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Alert,
  Button,
  ButtonLink,
  ConfirmDialog,
  Field,
  PageHeader,
  Textarea,
} from "@/components/ui";
import { SkeletonRows } from "@/components/ui/DataState";
import { VenueForm } from "@/components/VenueForm";
import { VenueUnavailablePeriods, type PeriodAction } from "@/components/VenueUnavailablePeriods";
import { can } from "@/lib/permissions";
import { authedFetch } from "@/lib/session";
import { focusFirstError, readServerError, type FieldErrors } from "@/lib/formErrors";
import {
  INITIAL_VENUE,
  toVenueFormValues,
  validateVenueForm,
  venuePayload,
  type Facility,
  type VenueFormValues,
  type VenueRecord,
} from "@/lib/venueForm";
import { IMPACT_REASON_PROSE, type ImpactReason } from "@/lib/venueImpact";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { venueCrumbs } from "@/lib/breadcrumbs";

// S-20 "Venue detail / edit", plus the retire action.
//
// The acceptance criterion this screen exists to make visible (Manage Venue
// Catalogue, discussion board #120 and #122): "When a venue's attributes are
// updated or it is retired, existing bookings that may be affected are flagged
// for review rather than automatically changed, and the assigned Coordinator is
// notified."
//
// So this screen does NOT navigate away after a successful save. PATCH
// /api/venues/[id] returns which bookings it flagged, and that is the only
// place a person is told it happened - pushing to /venues would throw it away.

/// What the page reports at the top: a save, retire or restore of the venue
/// itself, or (SPM-45) a change to one of its unavailable periods.
type ResultAction = "save" | "retire" | "restore" | PeriodAction;

/// One entry of the PATCH response's `flaggedBookings`.
interface FlaggedBooking {
  bookingId: string;
  eventId: string;
  eventTitle: string | null;
  sessionLabel: string | null;
  reasons: ImpactReason[];
  /// SPM-80: the bookings this one now overlaps, after a setup or turnaround change.
  clashesWith?: { bookingId: string; eventReference: string; eventTitle: string | null }[];
}

interface PatchResponse {
  venue: VenueRecord;
  flaggedBookings: FlaggedBooking[];
}

export default function EditVenuePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const venueId = params.id;
  const formRef = useRef<HTMLFormElement>(null);
  const { user, state: authState } = useCurrentUser();

  const [values, setValues] = useState<VenueFormValues>(INITIAL_VENUE);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<"save" | "retire" | "restore" | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [facilities, setFacilities] = useState<Facility[] | null>(null);

  const [isActive, setIsActive] = useState(true);
  const [venueName, setVenueName] = useState("");

  // What the last successful PATCH did. null means "nothing saved yet this
  // visit"; an empty array means "saved, and nothing was affected" - which is
  // itself worth saying, so the two cases are not collapsed.
  const [result, setResult] = useState<{ action: ResultAction; flagged: FlaggedBooking[] } | null>(null);

  const [retireOpen, setRetireOpen] = useState(false);
  const [retireReason, setRetireReason] = useState("");

  const loadFacilities = useCallback(async () => {
    try {
      const res = await authedFetch("/api/facilities");
      if (!res.ok) return;
      setFacilities(await res.json());
    } catch {
      // Non-fatal: the pickers stay in their loading state.
    }
  }, []);

  const loadVenue = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await authedFetch(`/api/venues/${venueId}`);
      if (res.status === 401) {
        router.push(loginUrlFor(`/venues/${venueId}/edit`));
        return;
      }
      if (res.status === 404) {
        setLoadError("This venue could not be found. It may have been removed.");
        return;
      }
      if (res.status === 403) {
        setLoadError("The venue catalogue is for ConnectSphere staff.");
        return;
      }
      if (!res.ok) {
        setLoadError("Could not load this venue.");
        return;
      }
      const venue: VenueRecord = await res.json();
      setValues(toVenueFormValues(venue));
      setIsActive(venue.isActive);
      setVenueName(venue.name);
      setLoaded(true);
    } catch {
      setLoadError("Could not reach the server. Check your connection and try again.");
    }
  }, [venueId, router]);

  useEffect(() => {
    if (authState === "anonymous") {
      router.push(loginUrlFor(`/venues/${venueId}/edit`));
      return;
    }
    if (authState === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadVenue();
      void loadFacilities();
    }
  }, [authState, loadVenue, loadFacilities, venueId, router]);

  function clearError(field: string) {
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  /// One PATCH for all three actions - an attribute edit, a retire and a
  /// restore differ only in their body. The impact handling is identical
  /// because the server treats them identically.
  async function patch(action: "save" | "retire" | "restore", body: Record<string, unknown>) {
    setFormError(null);
    setResult(null);
    setPending(action);
    try {
      const res = await authedFetch(`/api/venues/${venueId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });

      const payload = await res.json();
      if (!res.ok) {
        const { formError: message, fieldErrors } = readServerError(
          payload,
          "Could not save this venue"
        );
        setErrors(fieldErrors);
        setFormError(message);
        focusFirstError(formRef.current, fieldErrors);
        return;
      }

      const { venue, flaggedBookings }: PatchResponse = payload;
      // Re-sync from the server's own copy rather than trusting what was
      // typed: a layout replacement comes back with real ids, and isActive may
      // have just changed underneath the form.
      setValues(toVenueFormValues(venue));
      setIsActive(venue.isActive);
      setVenueName(venue.name);
      setResult({ action, flagged: flaggedBookings });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
      focusFirstError(formRef.current, {});
    } finally {
      setPending(null);
    }
  }

  async function save() {
    const clientErrors = validateVenueForm(values);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      focusFirstError(formRef.current, clientErrors);
      return;
    }
    await patch("save", venuePayload(values));
  }

  async function retire() {
    setRetireOpen(false);
    await patch("retire", {
      isActive: false,
      reason: retireReason.trim() || undefined,
    });
    setRetireReason("");
  }

  // The venue's name links to its availability, which everyone who can see the
  // venue can open.
  const crumbs = venueCrumbs(venueName, "Edit venue", `/venues/${venueId}/availability`);

  if (loadError) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="Edit venue" breadcrumbs={crumbs} />
        <Alert variant="error" title="Could not open this venue">
          {loadError}
        </Alert>
        <div className="mt-4">
          <Button variant="secondary" onClick={() => router.push("/venues")}>
            Back to Venues
          </Button>
        </div>
      </div>
    );
  }

  if (authState === "authenticated" && !can(user?.role ?? "", "venue:manage")) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="Edit venue" breadcrumbs={crumbs} />
        <Alert variant="error" title="Only Venue Staff can change a venue">
          Venue Staff are responsible for venue information. You can still browse the catalogue.
        </Alert>
        <div className="mt-4">
          <Button variant="secondary" onClick={() => router.push("/venues")}>
            Back to Venues
          </Button>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="Edit venue" breadcrumbs={crumbs} />
        <SkeletonRows rows={4} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={venueName || "Edit venue"}
        subtitle="Changes here can affect this venue's bookings. Nothing is changed for them automatically."
        breadcrumbs={crumbs}
        // SPM-46: the availability calendar for this room. Also linked from
        // each row of the Venues list - that is the way in for coordinators,
        // who cannot open this editor at all.
        actions={
          <ButtonLink href={`/venues/${venueId}/availability`} variant="secondary">
            View availability
          </ButtonLink>
        }
        meta={
          isActive ? undefined : (
            <span className="rounded-full bg-tone-warning-bg px-2.5 py-0.5 text-xs font-medium text-tone-warning-fg ring-1 ring-inset ring-tone-warning-ring">
              Retired
            </span>
          )
        }
      />

      {result && <SaveResult action={result.action} flagged={result.flagged} />}

      {!isActive && (
        <Alert variant="warning" title="This venue is retired" className="mt-4">
          It no longer appears in the catalogue for coordinators, and venue search will not offer it.
          Its past bookings are untouched.
        </Alert>
      )}

      {/* SPM-45: out of use for a period, which is not the same as retired -
          so it is offered whether or not the venue is. */}
      <VenueUnavailablePeriods
        venueId={venueId}
        venueName={venueName}
        onStart={() => setResult(null)}
        onResult={(action, flagged) => {
          setResult({ action, flagged });
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />

      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="mt-6 flex flex-col gap-6"
        noValidate
      >
        {formError && <Alert variant="error">{formError}</Alert>}

        <VenueForm
          values={values}
          setValues={setValues}
          errors={errors}
          clearError={clearError}
          facilities={facilities ?? []}
          facilitiesLoading={facilities === null}
          existing
        />

        <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t border-line bg-surface-2 px-4 py-3 sm:mx-0 sm:rounded-md sm:px-4">
          <Button type="submit" loading={pending === "save"} loadingText="Saving…">
            Save changes
          </Button>

          {isActive ? (
            <Button
              type="button"
              variant="danger"
              onClick={() => setRetireOpen(true)}
              disabled={pending !== null}
            >
              Retire venue
            </Button>
          ) : (
            // A retired venue's editor would otherwise have a dead Retire
            // button. Restoring is not destructive, so it needs no dialog.
            <Button
              type="button"
              variant="secondary"
              onClick={() => void patch("restore", { isActive: true })}
              loading={pending === "restore"}
              loadingText="Restoring…"
            >
              Restore venue
            </Button>
          )}

          <Button type="button" variant="ghost" onClick={() => router.push("/venues")}>
            Back to Venues
          </Button>
        </div>
      </form>

      {/* §7.5: a destructive action names its specific consequence. The exact
          number of affected bookings is not known until the server has looked,
          so this says what will happen and the Alert afterwards says to whom. */}
      <ConfirmDialog
        open={retireOpen}
        title={`Retire ${venueName}?`}
        confirmLabel="Retire venue"
        loading={pending === "retire"}
        onConfirm={() => void retire()}
        onCancel={() => setRetireOpen(false)}
      >
        <p>
          This room will stop appearing in the catalogue and venue search will no longer offer it.
          Past bookings are kept exactly as they are — nothing is deleted.
        </p>
        <p className="mt-2">
          Any approved booking that has not yet happened will be <strong>flagged for review</strong>,
          and the coordinator responsible for it will be notified. No booking is cancelled or moved.
        </p>
        <div className="mt-3">
          <Field label="Reason" hint="Included in the notification to each coordinator.">
            <Textarea
              rows={2}
              value={retireReason}
              onChange={(e) => setRetireReason(e.target.value)}
              placeholder="e.g. Closed for renovation until March"
            />
          </Field>
        </div>
      </ConfirmDialog>
    </div>
  );
}

const RESULT_VERBS: Record<ResultAction, string> = {
  save: "Changes saved",
  retire: "Venue retired",
  restore: "Venue restored",
  period_saved: "Unavailable period saved",
  period_changed: "Unavailable period changed",
  period_ended: "Unavailable period ended",
};

/// What the save actually did. The flagged list is the visible half of the AC —
/// without it, "coordinators were notified" happens silently in the database.
function SaveResult({
  action,
  flagged,
}: {
  action: ResultAction;
  flagged: FlaggedBooking[];
}) {
  const verb = RESULT_VERBS[action];

  // Ending a period flags nothing and notifies nobody, so the usual "no
  // bookings were affected" would answer a question it did not ask.
  if (action === "period_ended") {
    return (
      <Alert variant="success" title={verb} className="mt-4">
        The venue can be requested again for the time that was left in the period.
      </Alert>
    );
  }

  if (flagged.length === 0) {
    return (
      <Alert variant="success" title={verb} className="mt-4">
        No bookings were affected, so nobody needed to be notified.
      </Alert>
    );
  }

  return (
    <Alert
      variant="warning"
      title={`${verb} — ${flagged.length} ${flagged.length === 1 ? "booking" : "bookings"} flagged for review, coordinators notified`}
      className="mt-4"
    >
      <p>
        These bookings have <strong>not</strong> been changed. Each one is flagged for its
        coordinator to decide what to do.
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {flagged.map((booking) => (
          <li key={booking.bookingId}>
            <span className="font-medium">{booking.eventTitle ?? "Untitled event"}</span>
            {booking.sessionLabel && <span className="text-ink-3"> ({booking.sessionLabel})</span>}
            {": "}
            {booking.reasons.map((reason) => IMPACT_REASON_PROSE[reason]).join("; ")}
            {booking.clashesWith?.length
              ? ` (clashes with ${booking.clashesWith
                  .map((other) => [other.eventReference, other.eventTitle].filter(Boolean).join(" "))
                  .join(", ")})`
              : null}
          </li>
        ))}
      </ul>
    </Alert>
  );
}
