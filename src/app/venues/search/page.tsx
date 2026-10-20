"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  CheckboxGroup,
  DataState,
  Field,
  Input,
  PageHeader,
  type Crumb,
  Select,
} from "@/components/ui";
import { BeginPlanningDialog } from "@/components/BeginPlanningDialog";
import { LAYOUTS, toOptions } from "@/lib/eventForm";
import { eventReference, formatVenue } from "@/lib/format";
import { can } from "@/lib/permissions";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { eventCrumbs } from "@/lib/breadcrumbs";
import { DEFAULT_SPACE_PURPOSE, layoutLabel } from "@/lib/venueSuitability";
import {
  EMPTY_SEARCH,
  searchFormErrors,
  searchFromBooking,
  searchFromEvent,
  searchQuery,
  shouldStartPlanning,
  type ReplaceableBooking,
  type SearchableEvent,
  type SearchFormValues,
} from "@/lib/venueSearchForm";

// S-14, "Find a venue" (SPM-40; design/mockups/VenueSearch.dc.html). Filters
// on the left, matching venues on the right. Unlike SPM-41's Venue tab, a
// venue failing any filter is NOT shown (AC7) - see src/lib/venueSearch.ts for
// why the two screens differ.
//
// Opened as /venues/search it is a blank search of the catalogue. Opened as
// /venues/search?event=EVT-000123 it is pre-filled from that event's
// requirements, which is the story: "search and filter venues using event
// requirements".
//
// SPM-68: opened as /venues/search?event=EVT-000123&booking=<id> it is the
// search for a room to REPLACE that booking, which Review Flagged
// Arrangements flagged. The form is filled from the booking itself - its
// date, times and layout - with the event's present attendance and
// requirements, and each result can be requested straight away. Requesting
// one changes nothing about the flagged booking or the event: the coordinator
// releases the old room separately (SPM-67).

interface Facility {
  id: string;
  name: string;
  category: string;
}

interface VenueResult {
  id: string;
  code: string;
  name: string;
  building: string;
  floor: string | null;
  maxCapacity: number;
  opensAt: string;
  closesAt: string;
  layouts: { layoutName: string; capacity: number }[];
  facilities: Facility[];
}

interface SearchResponse {
  checked: number;
  buildings: string[];
  results: VenueResult[];
}

interface EventForSearch extends SearchableEvent {
  title: string | null;
  sequenceNumber: number;
  status: string;
  coordinatorId: string | null;
  sessions?: (NonNullable<SearchableEvent["sessions"]>[number] & { label: string | null })[];
}

/// The booking being replaced, as GET /api/events/[id]/venue-bookings lists it.
interface BookingToReplace extends ReplaceableBooking {
  id: string;
  venue: { name: string };
}

const LAYOUT_OPTIONS = [{ value: "", label: "Any layout" }, ...toOptions(LAYOUTS)];

export default function VenueSearchPage() {
  return (
    // useSearchParams needs a Suspense boundary above it.
    <Suspense fallback={null}>
      <VenueSearch />
    </Suspense>
  );
}

function VenueSearch() {
  const router = useRouter();
  const query = useSearchParams();
  const eventRef = query.get("event") ?? undefined;
  // SPM-68: only meaningful with an event - a booking belongs to one.
  const bookingId = (eventRef && query.get("booking")) || undefined;
  const { user, state } = useCurrentUser();
  const selfUrl = eventRef
    ? `/venues/search?event=${eventRef}${bookingId ? `&booking=${bookingId}` : ""}`
    : "/venues/search";

  const [values, setValues] = useState<SearchFormValues>(EMPTY_SEARCH);
  const [errors, setErrors] = useState<ReturnType<typeof searchFormErrors>>({});
  const [facilities, setFacilities] = useState<Facility[] | null>(null);
  const [event, setEvent] = useState<EventForSearch | null>(null);
  const [sessionId, setSessionId] = useState("");
  /// SPM-68: the flagged booking this search is looking to replace.
  const [replacing, setReplacing] = useState<BookingToReplace | null>(null);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  /// Set once a Search on this visit has moved the event from Approved to
  /// Planning, or tried to and failed - either way the coordinator is told.
  const [planning, setPlanning] = useState<"started" | "failed" | null>(null);
  /// Open while the coordinator is being asked whether to begin planning.
  const [confirmPlanning, setConfirmPlanning] = useState(false);

  const search = useCallback(
    async (next: SearchFormValues) => {
      const formErrors = searchFormErrors(next);
      setErrors(formErrors);
      if (Object.keys(formErrors).length > 0) return;

      setError(null);
      setSearching(true);
      try {
        const res = await authedFetch(`/api/venues/search?${searchQuery(next, eventRef)}`);
        if (res.status === 401) {
          router.push(loginUrlFor(selfUrl));
          return;
        }
        if (res.status === 403) {
          setError("Venue search is for ConnectSphere staff.");
          return;
        }
        if (res.status === 404) {
          setError("This event doesn't exist, or you don't have access to it.");
          return;
        }
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Could not search venues.");
        setData(body);
      } catch (err) {
        setData(null);
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setSearching(false);
      }
    },
    [eventRef, router, selfUrl]
  );

  // First load: the facility list (the two checkbox groups), the event to
  // pre-fill from if there is one, then the first search - so the page opens
  // on results, not on an empty form.
  const load = useCallback(async () => {
    setError(null);
    try {
      const [facRes, eventRes, bookingsRes] = await Promise.all([
        authedFetch("/api/facilities"),
        eventRef ? authedFetch(`/api/events/${eventRef}`) : Promise.resolve(null),
        eventRef && bookingId ? authedFetch(`/api/events/${eventRef}/venue-bookings`) : Promise.resolve(null),
      ]);
      if (facRes.status === 401 || eventRes?.status === 401 || bookingsRes?.status === 401) {
        router.push(loginUrlFor(selfUrl));
        return;
      }
      if (!facRes.ok) throw new Error("Could not load the facility list.");
      setFacilities(await facRes.json());

      let initial = EMPTY_SEARCH;
      if (eventRes) {
        if (!eventRes.ok) {
          setError("This event doesn't exist, or you don't have access to it.");
          return;
        }
        const loaded: EventForSearch = await eventRes.json();
        setEvent(loaded);
        initial = searchFromEvent(loaded);

        // SPM-68 (AC11): replacing a booking starts from that booking. One
        // that cannot be found (it was withdrawn in another tab, say) leaves
        // the ordinary search for the event.
        const bookings: BookingToReplace[] = bookingsRes?.ok ? ((await bookingsRes.json()).bookings ?? []) : [];
        const booking = bookings.find((b) => b.id === bookingId);
        if (booking) {
          setReplacing(booking);
          initial = searchFromBooking(loaded, booking);
        }
      }
      setValues(initial);
      // This first search only fills the page - it does not begin planning
      // (see startPlanning below).
      await search(initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [eventRef, bookingId, router, search, selfUrl]);

  // Starting the venue search is what moves an Approved event into Planning
  // (the lifecycle diagram's "search" edge) - and "starting" means the
  // coordinator pressing Search (SPM-54, decided 2026-10-02), not the page
  // opening and not Clear filters. The server makes the move, the same way it
  // does for a booking request or an equipment change, and says whether it
  // did. The coordinator is asked first (BeginPlanningDialog); cancelling
  // leaves the event Approved and does not run the search. A failure here must
  // not stop the search itself - it is reported, and the search goes on.
  const startPlanning = async () => {
    if (!user || !event || !eventRef || !shouldStartPlanning(event, user)) return;
    try {
      const res = await authedFetch(`/api/events/${eventRef}/begin-planning`, { method: "POST" });
      if (!res.ok) {
        setPlanning("failed");
        return;
      }
      // False when it had already begun elsewhere (another tab, a booking
      // request) - nothing to say then.
      const { planningStarted } = await res.json();
      if (planningStarted) {
        setPlanning("started");
        setEvent({ ...event, status: "planning" });
      }
    } catch {
      setPlanning("failed");
    }
  };

  useEffect(() => {
    if (state === "anonymous") {
      router.push(loginUrlFor(selfUrl));
      return;
    }
    if (state === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [state, load, router, selfUrl]);

  const set = <K extends keyof SearchFormValues>(key: K, value: SearchFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const toggleFacility = (id: string) =>
    setValues((v) => ({
      ...v,
      facilityIds: v.facilityIds.includes(id)
        ? v.facilityIds.filter((f) => f !== id)
        : [...v.facilityIds, id],
    }));

  const chooseSession = (id: string) => {
    setSessionId(id);
    if (event) setValues(searchFromEvent(event, id || undefined));
  };

  const facilityOptions = useMemo(
    () => (facilities ?? []).filter((f) => f.category !== "accessibility"),
    [facilities]
  );
  const accessibilityOptions = useMemo(
    () => (facilities ?? []).filter((f) => f.category === "accessibility"),
    [facilities]
  );
  const buildingOptions = useMemo(
    () => [
      { value: "", label: "Any building" },
      ...(data?.buildings ?? []).map((b) => ({ value: b, label: b })),
    ],
    [data]
  );
  // The ids the coordinator asked for, so a result card can show them first.
  const wanted = useMemo(() => new Set(values.facilityIds), [values.facilityIds]);

  if (state === "loading" || (state === "authenticated" && !user)) {
    return null;
  }

  const reference = event ? eventReference(event.sequenceNumber) : eventRef;
  // Opened for an event, the search hangs off that event (SPM-98); otherwise
  // off the venue catalogue. Decided by the address, so the trail is the same
  // before the event has loaded.
  const crumbs: Crumb[] = reference
    ? eventCrumbs(user?.role, reference, event?.title, { label: "Find a venue" })
    : [{ label: "Venues", href: "/venues" }, { label: "Find a venue" }];

  if (user && !can(user.role, "venue:view")) {
    return (
      <div>
        <PageHeader title="Find a venue" breadcrumbs={crumbs} />
        <Alert variant="error" title="Not available">
          Venue search is for ConnectSphere staff.
        </Alert>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Find a venue"
        subtitle={
          replacing
            ? `Filled in from the flagged booking at ${replacing.venue.name}. Change any filter and search again.`
            : event
              ? `Filled in from ${event.title ?? "this event"}'s requirements. Change any filter and search again.`
              : "Only venues matching every filter you set are shown."
        }
        breadcrumbs={crumbs}
      />

      {planning === "started" && (
        <Alert variant="success" title="Planning has started" className="mb-6">
          This event has moved from Approved to Planning now that its venue search has begun.
        </Alert>
      )}
      {planning === "failed" && (
        <Alert variant="warning" title="The event is still Approved" className="mb-6">
          Its status could not be moved to Planning. The search below still works; try searching
          again.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[20rem_1fr]">
        <Card className="self-start">
          <CardHeader title="Requirements" />
          <CardBody>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                // This Search would begin planning: ask first. A search the
                // form refuses is not a search started, so it is not asked about.
                const valid = Object.keys(searchFormErrors(values)).length === 0;
                if (valid && user && event && shouldStartPlanning(event, user)) {
                  setConfirmPlanning(true);
                  return;
                }
                void search(values);
              }}
            >
              {event?.sessions && event.sessions.length > 0 && (
                <Field
                  label="Fill in from"
                  hint="Sessions can differ in time, attendance and layout."
                >
                  <Select
                    value={sessionId}
                    onChange={(e) => chooseSession(e.target.value)}
                    options={[
                      { value: "", label: "Whole event" },
                      ...event.sessions.map((s, i) => ({
                        value: s.id,
                        label: s.label ?? `Session ${i + 1}`,
                      })),
                    ]}
                  />
                </Field>
              )}

              <Field label="From" hint="Singapore time.">
                <Input
                  type="datetime-local"
                  value={values.from}
                  onChange={(e) => set("from", e.target.value)}
                />
              </Field>
              <Field label="To" error={errors.to}>
                <Input
                  type="datetime-local"
                  value={values.to}
                  onChange={(e) => set("to", e.target.value)}
                />
              </Field>

              <Field
                label="Expected attendance"
                hint="Checked against the capacity for the chosen layout."
                error={errors.attendance}
              >
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={values.attendance}
                  onChange={(e) => set("attendance", e.target.value)}
                />
              </Field>

              <Field label="Location">
                <Select
                  value={values.building}
                  onChange={(e) => set("building", e.target.value)}
                  options={buildingOptions}
                />
              </Field>

              <Field label="Room layout">
                <Select
                  value={values.layout}
                  onChange={(e) => set("layout", e.target.value)}
                  options={LAYOUT_OPTIONS}
                />
              </Field>

              <CheckboxGroup
                legend="Accessibility requirements"
                options={accessibilityOptions}
                selected={values.facilityIds}
                onToggle={toggleFacility}
                loading={facilities === null}
              />
              <CheckboxGroup
                legend="Required facilities"
                options={facilityOptions}
                selected={values.facilityIds}
                onToggle={toggleFacility}
                loading={facilities === null}
              />

              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="submit" loading={searching} loadingText="Searching…">
                  Search
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setSessionId("");
                    setValues(EMPTY_SEARCH);
                    void search(EMPTY_SEARCH);
                  }}
                >
                  Clear filters
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>

        <div className="flex min-w-0 flex-col gap-3">
          {data && !error && (
            <p className="text-sm text-ink-3" aria-live="polite">
              {data.results.length} of {data.checked} venues match
            </p>
          )}
          <DataState
            data={data?.results ?? (error ? [] : null)}
            error={error}
            onRetry={() => void (data ? search(values) : load())}
            empty={{
              title: data?.checked ? "No venues match these filters" : "No venues yet",
              description: data?.checked
                ? "Try a wider time, a different layout or location, or fewer facilities."
                : "Venue Staff have not added any rooms yet.",
            }}
          >
            {(rows) => (
              <div className="flex flex-col gap-3">
                {rows.map((venue) => (
                  <VenueCard
                    key={venue.id}
                    venue={venue}
                    wanted={wanted}
                    layout={values.layout}
                    suitabilityHref={reference ? `/events/${reference}/venue` : undefined}
                    // SPM-68 (AC12): the replacement is requested with the
                    // ordinary request form (S-15), for the same session and
                    // the same space (SPM-90): what it is for - the main
                    // programme for a booking made before spaces were named -
                    // and the attendance and layout searched for.
                    requestHref={
                      replacing && reference
                        ? `/events/${reference}/booking/new?${new URLSearchParams({
                            venue: venue.id,
                            ...(replacing.session ? { session: replacing.session.id } : {}),
                            purpose: replacing.purpose?.trim() || DEFAULT_SPACE_PURPOSE,
                            ...(values.attendance.trim() ? { attendance: values.attendance.trim() } : {}),
                            layout: values.layout,
                          })}`
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </DataState>
        </div>
      </div>

      <BeginPlanningDialog
        open={confirmPlanning}
        onConfirm={() => {
          setConfirmPlanning(false);
          void startPlanning();
          void search(values);
        }}
        onCancel={() => setConfirmPlanning(false)}
      />
    </div>
  );
}

function VenueCard({
  venue,
  wanted,
  layout,
  suitabilityHref,
  requestHref,
}: {
  venue: VenueResult;
  wanted: Set<string>;
  layout: string;
  suitabilityHref?: string;
  requestHref?: string;
}) {
  // Requested facilities first, so the card confirms what was asked for
  // before listing everything else the room has.
  const facilities = [...venue.facilities].sort(
    (a, b) => Number(wanted.has(b.id)) - Number(wanted.has(a.id))
  );
  return (
    <Card>
      <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium text-ink">{formatVenue(venue.name, venue.code)}</p>
          <p className="mt-0.5 text-xs text-ink-3">
            {venue.floor ? `${venue.building} — ${venue.floor}` : venue.building} · open{" "}
            {venue.opensAt}–{venue.closesAt} · max {venue.maxCapacity} overall
          </p>
          <p className="mt-1 text-sm text-ink-2">
            {venue.layouts.map((l, i) => (
              <span key={l.layoutName}>
                {i > 0 && ", "}
                <span className={l.layoutName === layout ? "font-medium text-ink" : undefined}>
                  {layoutLabel(l.layoutName)} {l.capacity}
                </span>
              </span>
            ))}
          </p>
          {facilities.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Facilities">
              {facilities.map((f) => (
                <li
                  key={f.id}
                  className={
                    wanted.has(f.id)
                      ? "rounded-full bg-tone-success-bg px-2 py-0.5 text-xs text-tone-success-fg ring-1 ring-inset ring-tone-success-ring"
                      : "rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-3"
                  }
                >
                  {f.name}
                </li>
              ))}
            </ul>
          )}
        </div>
        {/* From an event, the next useful step is the suitability check
            (the Venue tab, SPM-41), which also shows the nice-to-haves this
            search ignored and is where a venue is normally requested. A
            search for a replacement (SPM-68) can request the venue directly. */}
        {(suitabilityHref || requestHref) && (
          <div className="flex shrink-0 flex-col items-stretch gap-2">
            {requestHref && (
              <ButtonLink href={requestHref} size="sm">
                Request booking
              </ButtonLink>
            )}
            {suitabilityHref && (
              <ButtonLink href={suitabilityHref} variant="secondary" size="sm">
                Check suitability
              </ButtonLink>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
