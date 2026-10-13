"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DetailList,
  PageHeader,
  SkeletonRows,
  StatusBadge,
  Tabs,
} from "@/components/ui";
import { AssignCoordinator, type AssignResult, type CoordinatorOption } from "@/components/AssignCoordinator";
import { RegistrationCard, type RegistrationEvent } from "./RegistrationCard";
import { RegisterPanel, type MyRegistration, type RegistrationStateJson } from "./RegisterPanel";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { eventTabItemsFor } from "@/lib/eventTabs";
import { EMPTY, eventReference, formatDateTime, formatDateTimeRange, orEmpty } from "@/lib/format";
import { humanise, statusLabel } from "@/lib/statuses";
import { isExternalRole } from "@/lib/roles";
import {
  EVENT_INFORMATION_STATUSES,
  can,
  canAssignCoordinator,
  canConfigureRegistration,
  canConfirmEvent,
  canReviewEvent,
  canSubmitForSafetyCheck,
  canUpdateEventInformation,
  canWithdrawEvent,
} from "@/lib/permissions";

// S-06 — "the hub" (UI_DESIGN.md §3.1): every role lands here first when they
// open an event, then moves to a tab (Equipment is S-16 / SPM-47). Every role
// has the Overview tab (roles.ts EVENT_TABS_BY_ROLE), so there is no access
// gate here the way there is on the Equipment tab.

interface FacilityRequirement {
  facilityId: string;
  isMandatory: boolean;
  facility: { id: string; name: string; category: string };
}

interface EventDetail extends RegistrationEvent {
  id: string;
  // SPM-51: an Attendee's only - whether they can register now, and their
  // own registration for the event, if any.
  registrationState?: RegistrationStateJson;
  myRegistration?: MyRegistration | null;
  // Present for every role, including an Attendee - see ATTENDEE_EVENT_FIELDS
  // (src/lib/permissions.ts). Format with eventReference() for display.
  sequenceNumber: number;
  title: string | null;
  description: string | null;
  purpose: string | null;
  category: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  // Absent (not just empty/null) for an Attendee: ATTENDEE_EVENT_FIELDS
  // (src/lib/permissions.ts) omits them entirely, since expected attendance,
  // preferred layout, accessibility/special requirements, the organiser's own
  // name, the coordinator, and facility requirements are all either internal
  // planning information or simply not relevant to someone deciding whether
  // to register (docs/PERMISSIONS.md §4). Each is rendered only when present,
  // rather than as an empty "—" row/card an Attendee has no reason to see.
  expectedAttendance?: number | null;
  preferredLayout?: string | null;
  accessibilityNotes?: string | null;
  specialRequirements?: string | null;
  organiser?: { fullName: string };
  coordinator?: { fullName: string } | null;
  /// SPM-34: the approved booking(s), so every authorised role - the organiser
  /// included - can see which room the event is in.
  venueBookings?: {
    startsAt: string;
    endsAt: string;
    /// SPM-85: the layout booked, and the seats each of the room's layouts holds.
    layoutName?: string | null;
    session: { label: string | null } | null;
    venue: { name: string; code: string; layouts?: { layoutName: string; capacity: number }[] };
  }[];
  /// A multi-session event's own sessions (SPM-23); empty for an ordinary
  /// event and absent for an Attendee.
  sessions?: {
    id: string;
    label: string | null;
    startsAt: string;
    endsAt: string;
    expectedAttendance: number | null;
    preferredLayout: string | null;
  }[];
  // SPM-30: needed to tell "assign" from "reassign", and which choice would be
  // a no-op. Absent for an Attendee along with the rest of the internal fields.
  coordinatorId?: string | null;
  organiserId?: string;
  organisationId?: string | null;
  facilityRequirements?: FacilityRequirement[];
  // SPM-28: shown as a banner on a rejected event. Absent for an Attendee.
  rejectionReason?: string | null;
  // Present for an Attendee too - which company is running the event is
  // public, even though who personally organised it (above) is not.
  organisation?: { name: string } | null;
  /// SPM-86 (AC8): the latest Operational Safety Check, null if the event was
  /// never submitted. Absent for an external user - safety details are
  /// internal (SPM-88), so the organiser sees the Safety review status only.
  safetyCheck?: { status: string; submittedAt: string; submittedBy: string | null } | null;
}

/// SPM-85: "14 Jun 2027, 09:00–12:00 · 200 people · Theatre" - what a safety
/// review needs to know about one session.
function sessionSummary(session: NonNullable<EventDetail["sessions"]>[number]): string {
  return [
    formatDateTimeRange(session.startsAt, session.endsAt),
    session.expectedAttendance != null ? `${session.expectedAttendance} people` : "Attendance not set",
    session.preferredLayout ? humanise(session.preferredLayout) : "Layout not set",
  ].join(" · ");
}

/// SPM-85: "Marina Auditorium (MAR-AUD) · Theatre · seats 220" - the room,
/// the layout booked, and the seats that layout holds (not the room's largest).
function bookingArrangement(booking: NonNullable<EventDetail["venueBookings"]>[number]): string {
  const room = `${booking.venue.name} (${booking.venue.code})`;
  if (!booking.layoutName) return `${room} · Layout not set`;
  const capacity = booking.venue.layouts?.find((l) => l.layoutName === booking.layoutName)?.capacity;
  const seats = capacity != null ? `seats ${capacity}` : "capacity not recorded";
  return `${room} · ${humanise(booking.layoutName)} · ${seats}`;
}

/// SPM-86: "Awaiting review · submitted by Daniel Tan, 9 Oct 2026, 14:30".
/// SPM-87 adds the Safety Officer's decision to the same row.
function safetyCheckSummary(check: NonNullable<EventDetail["safetyCheck"]>): string {
  const state = check.status === "pending" ? "Awaiting review" : humanise(check.status);
  const by = check.submittedBy ? ` by ${check.submittedBy}` : "";
  return `${state} · submitted${by}, ${formatDateTime(check.submittedAt)}`;
}

/// "Orchard Seminar Room (ORC-SEM)", or one line per session for a
/// multi-session event. "Not booked yet" until Venue Staff approve a booking -
/// a pending request is not an arrangement.
function venueSummary(bookings: NonNullable<EventDetail["venueBookings"]>): string {
  if (bookings.length === 0) return "Not booked yet";
  return bookings
    .map((b) => {
      const room = `${b.venue.name} (${b.venue.code})`;
      return b.session?.label ? `${b.session.label}: ${room}` : room;
    })
    .join(" · ");
}

export default function EventOverviewPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const { user, state } = useCurrentUser();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // SPM-30: the Ops Manager's coordinator choices, and what just happened.
  const [coordinators, setCoordinators] = useState<CoordinatorOption[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mayAssign = user ? can(user.role, "event:assign_coordinator") : false;
  // SPM-27: the assigned coordinator recording a withdrawal the organiser
  // asked for outside the system (clarification #103).
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  // SPM-34: the assigned coordinator confirming the event once its
  // arrangements are done. The server decides whether they are; this only
  // asks, and shows what it says back.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // SPM-86: the assigned coordinator submitting the event for an Operational
  // Safety Check. As with Confirm, the server decides whether the
  // arrangements are ready and the page shows what it says back.
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [submittingSafety, setSubmittingSafety] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}`);
      if (res.status === 401) {
        router.push(loginUrlFor(`/events/${eventId}`));
        return;
      }
      if (res.status === 404) {
        setError("This event doesn't exist, or you don't have access to it.");
        return;
      }
      if (!res.ok) throw new Error("Could not load this event.");
      const data = await res.json();
      // The Overview hub is for a submitted request onwards; a draft is
      // edited, not overviewed - only its owning organiser can ever reach
      // this far (canViewEvent hides a draft from everyone else), so send
      // them to the draft editor instead of a page with nothing to show.
      if (data.status === "draft") {
        router.replace(`/events/${eventId}/edit`);
        return;
      }
      setEvent(data);
    } catch (err) {
      setEvent(null);
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [eventId, router]);

  useEffect(() => {
    if (state === "anonymous") {
      router.push(loginUrlFor(`/events/${eventId}`));
      return;
    }
    if (state === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [state, load, router, eventId]);

  // Only fetched for a role that can use it - nobody else is shown the list of
  // coordinators to choose from.
  useEffect(() => {
    if (!mayAssign) return;
    void (async () => {
      try {
        const res = await authedFetch("/api/assignments");
        if (res.ok) setCoordinators((await res.json()).coordinators);
      } catch {
        // The page still works without it; the assign card just doesn't show.
      }
    })();
  }, [mayAssign]);

  function handleAssigned(result: AssignResult) {
    setNotice(
      result.previousCoordinator
        ? `Reassigned from ${result.previousCoordinator.fullName} to ${result.coordinator.fullName}.`
        : `${result.coordinator.fullName} is now the coordinator. The event has moved to ${statusLabel(result.status)}.`
    );
    void load();
  }

  async function withdraw() {
    setWithdrawing(true);
    setActionError(null);
    setNotice(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "withdrawn" }),
      });
      if (!res.ok) {
        setActionError((await res.json()).error ?? "Could not withdraw this request.");
        return;
      }
      setNotice("The withdrawal has been recorded.");
      void load();
    } catch {
      setActionError("Could not reach the server. Check your connection and try again.");
    } finally {
      setWithdrawing(false);
      setWithdrawOpen(false);
    }
  }

  async function confirmEvent() {
    setConfirming(true);
    setActionError(null);
    setNotice(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "confirmed" }),
      });
      if (!res.ok) {
        // The refusal names the arrangements that are still outstanding
        // (SPM-34 AC3), so it is shown as it comes rather than replaced with
        // a generic message.
        setActionError((await res.json()).error ?? "Could not confirm this event.");
        return;
      }
      setNotice("The event is confirmed. The organiser can now see the arrangements.");
      void load();
    } catch {
      setActionError("Could not reach the server. Check your connection and try again.");
    } finally {
      setConfirming(false);
      setConfirmOpen(false);
    }
  }

  async function submitForSafetyCheck() {
    setSubmittingSafety(true);
    setActionError(null);
    setNotice(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}/safety-check`, { method: "POST" });
      if (!res.ok) {
        // The refusal names what is outstanding or flagged (AC2), or says a
        // check is already pending (AC6) - shown as it comes.
        setActionError((await res.json()).error ?? "Could not submit this event for a safety check.");
        return;
      }
      setNotice("The event has been submitted for a safety check. The Safety Officer has been notified.");
      void load();
    } catch {
      setActionError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmittingSafety(false);
      setSafetyOpen(false);
    }
  }

  // Same fields and checks as the PATCH route, so the button only appears
  // when withdrawing would succeed.
  const showWithdraw = Boolean(
    user &&
    event &&
    event.organiserId !== undefined &&
    event.coordinatorId !== undefined &&
    canWithdrawEvent(
      { id: user.id, role: user.role, organisationId: null },
      {
        organiserId: event.organiserId,
        organisationId: event.organisationId ?? null,
        coordinatorId: event.coordinatorId,
        status: event.status,
      }
    )
  );

  // SPM-34 (AC4): only the assigned coordinator, and only from a status the
  // lifecycle lets into Confirmed. Whether the arrangements are ready is the
  // server's call - offering the button and refusing with a reason is more
  // useful than hiding it and leaving the coordinator to guess.
  const showConfirm = Boolean(
    user &&
    event &&
    event.organiserId !== undefined &&
    event.coordinatorId !== undefined &&
    canConfirmEvent(
      { id: user.id, role: user.role, organisationId: null },
      {
        organiserId: event.organiserId,
        organisationId: event.organisationId ?? null,
        coordinatorId: event.coordinatorId,
        status: event.status,
      }
    )
  );

  // SPM-86 (AC1, AC7): the assigned coordinator, while the event is in
  // Planning. Readiness is the server's call, as for Confirm.
  const showSafetyCheck = Boolean(
    user &&
    event &&
    event.organiserId !== undefined &&
    event.coordinatorId !== undefined &&
    canSubmitForSafetyCheck(
      { id: user.id, role: user.role, organisationId: null },
      {
        organiserId: event.organiserId,
        organisationId: event.organisationId ?? null,
        coordinatorId: event.coordinatorId,
        status: event.status,
      }
    )
  );

  const showAssign = Boolean(
    user &&
    event &&
    coordinators &&
    event.organiserId !== undefined &&
    event.coordinatorId !== undefined &&
    canAssignCoordinator(
      { id: user.id, role: user.role, organisationId: null },
      {
        organiserId: event.organiserId,
        organisationId: event.organisationId ?? null,
        coordinatorId: event.coordinatorId,
        status: event.status,
      }
    )
  );

  const showReview = Boolean(
    user &&
    event &&
    event.organiserId !== undefined &&
    event.coordinatorId !== undefined &&
    canReviewEvent(
      { id: user.id, role: user.role, organisationId: null },
      {
        organiserId: event.organiserId,
        organisationId: event.organisationId ?? null,
        coordinatorId: event.coordinatorId,
        status: event.status,
      }
    )
  );

  // SPM-62: the assigned coordinator updates the event's information after
  // approval (/events/[id]/update). Same rule as the route.
  const showEditInformation = Boolean(
    user &&
    event &&
    event.organiserId !== undefined &&
    event.coordinatorId !== undefined &&
    EVENT_INFORMATION_STATUSES.includes(event.status) &&
    canUpdateEventInformation(
      { id: user.id, role: user.role, organisationId: null },
      {
        organiserId: event.organiserId,
        organisationId: event.organisationId ?? null,
        coordinatorId: event.coordinatorId,
        status: event.status,
      }
    )
  );

  // SPM-64: the assigned coordinator configures registration in the same
  // status window as the route (EVENT_INFORMATION_STATUSES).
  const showRegistrationControls = Boolean(
    user &&
    event &&
    event.organiserId !== undefined &&
    event.coordinatorId !== undefined &&
    EVENT_INFORMATION_STATUSES.includes(event.status) &&
    canConfigureRegistration(
      { id: user.id, role: user.role, organisationId: null },
      {
        organiserId: event.organiserId,
        organisationId: event.organisationId ?? null,
        coordinatorId: event.coordinatorId,
        status: event.status,
      }
    )
  );

  if (state === "loading" || (state === "authenticated" && !user)) {
    return null;
  }

  const tabs = user ? eventTabItemsFor(user.role, eventId) : [];

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={event?.title || (error ? "Event" : "Loading…")}
        subtitle={event?.purpose ?? undefined}
        meta={
          event && (
            <>
              <span className="text-xs text-ink-3">{eventReference(event.sequenceNumber)}</span>
              <StatusBadge status={event.status} />
            </>
          )
        }
        breadcrumbs={[
          { label: user?.role === "organiser" ? "My Events" : "Events", href: "/events" },
          { label: event?.title || "Event" },
        ]}
        actions={
          <>
            {showSafetyCheck && (
              <Button onClick={() => setSafetyOpen(true)}>Submit for safety check</Button>
            )}
            {showConfirm && (
              <Button onClick={() => setConfirmOpen(true)}>Confirm event</Button>
            )}
            {showEditInformation && (
              <ButtonLink href={`/events/${eventId}/update`} variant="secondary">
                Edit event information
              </ButtonLink>
            )}
            {showWithdraw && (
              <Button variant="secondary" onClick={() => setWithdrawOpen(true)}>
                Record withdrawal
              </Button>
            )}
          </>
        }
      />

      {tabs.length > 0 && <Tabs items={tabs} activeKey="overview" className="mb-6" />}

      {error ? (
        <Alert
          variant="error"
          title="Could not load this"
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      ) : !event ? (
        <SkeletonRows rows={3} />
      ) : (
        <div className="flex flex-col gap-6">
          {notice && <Alert variant="success">{notice}</Alert>}
          {actionError && <Alert variant="error">{actionError}</Alert>}

          {/* SPM-28: the decision and its reason stay on the event record, and
              the organiser sees why (confirmed 2026-09-30). An Attendee never
              gets here - a rejected event is not visible to them at all. */}
          {event.status === "rejected" && event.rejectionReason && (
            <Alert variant="error" title="This request was rejected">
              {event.rejectionReason}
            </Alert>
          )}

          {/* SPM-28: the way in to the review from the event itself, as well
              as from the Review Queue. Only for the assigned coordinator,
              while the request is under review. */}
          {showReview && (
            <Alert
              variant="info"
              title="This request is waiting for your review"
              action={
                <ButtonLink href={`/events/${eventId}/review`} size="sm">
                  Review request
                </ButtonLink>
              }
            >
              Approve it for planning, or reject it with a reason.
            </Alert>
          )}

          {/* SPM-30: the Ops Manager assigns or changes the coordinator here as
              well as from the Assignments screen. Absent for every other
              role, and for an event whose coordinator can no longer change
              (completed, cancelled, rejected). */}
          {showAssign && (
            <Card>
              <CardHeader
                title={event.coordinatorId ? "Change coordinator" : "Assign a coordinator"}
                subtitle={
                  event.coordinatorId
                    ? `Currently ${event.coordinator?.fullName ?? "assigned"}.`
                    : "Assigning one moves this event to Under review."
                }
              />
              <CardBody>
                <AssignCoordinator
                  eventRef={eventReference(event.sequenceNumber)}
                  eventTitle={event.title || "Untitled event"}
                  current={
                    event.coordinatorId
                      ? { id: event.coordinatorId, fullName: event.coordinator?.fullName ?? "" }
                      : null
                  }
                  coordinators={coordinators ?? []}
                  label={event.coordinatorId ? "Reassign to" : "Assign to"}
                  onAssigned={handleAssigned}
                  className="max-w-md"
                />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DetailList
                items={[
                  { label: "Category", value: orEmpty(event.category && humanise(event.category)) },
                  { label: "Status", value: statusLabel(event.status) },
                  // SPM-86 (AC8): staff only - the API leaves it out for the organiser.
                  ...(event.safetyCheck
                    ? [{ label: "Safety check", value: safetyCheckSummary(event.safetyCheck) }]
                    : []),
                  { label: "When", value: formatDateTimeRange(event.startsAt, event.endsAt) },
                  // Not relevant to someone deciding whether to register, and
                  // absent from an Attendee's response entirely - see the
                  // comment on EventDetail above.
                  ...(event.expectedAttendance !== undefined
                    ? [{ label: "Expected attendance", value: orEmpty(event.expectedAttendance) }]
                    : []),
                  ...(event.preferredLayout !== undefined
                    ? [
                        {
                          label: "Preferred layout",
                          value: orEmpty(event.preferredLayout && humanise(event.preferredLayout)),
                        },
                      ]
                    : []),
                  { label: "Description", value: orEmpty(event.description) },
                  // Absent entirely for an Attendee (internal planning info) —
                  // shown here, not only on the Equipment tab's "at a glance"
                  // sidebar, so every other authorised role sees it without
                  // having to leave Overview (SPM-31).
                  ...(event.organiser !== undefined
                    ? [{ label: "Organiser", value: event.organiser.fullName }]
                    : []),
                  // Independent of Organiser above: an Attendee gets this
                  // row (which company is running the event) without the
                  // organiser's personal name.
                  ...(event.organisation !== undefined
                    ? [{ label: "Company", value: orEmpty(event.organisation?.name) }]
                    : []),
                  ...(event.coordinator !== undefined
                    ? [{ label: "Coordinator", value: event.coordinator?.fullName ?? "Not yet assigned" }]
                    : []),
                  // SPM-34 (AC6, AC7): the confirmed arrangement itself. The
                  // Venue tab is the coordinator's planning screen; this row
                  // is how everyone else, the organiser above all, learns
                  // which room their event is in.
                  ...(event.venueBookings !== undefined
                    ? [{ label: "Venue", value: venueSummary(event.venueBookings) }]
                    : []),
                ]}
              />
            </CardBody>
          </Card>

          {/* SPM-85 (AC3): what a safety review reads - each session's time,
              attendance and layout, and each booked room with its layout and
              seats. ConnectSphere staff only: the organiser learns their room
              from the Venue row above, and an Attendee gets neither field. */}
          {user && !isExternalRole(user.role) && event.sessions && event.sessions.length > 0 && (
            <Card>
              <CardHeader title="Sessions" />
              <CardBody>
                <DetailList
                  columns={1}
                  items={event.sessions.map((session, i) => ({
                    label: session.label || `Session ${i + 1}`,
                    value: sessionSummary(session),
                  }))}
                />
              </CardBody>
            </Card>
          )}

          {user && !isExternalRole(user.role) && event.venueBookings !== undefined && (
            <Card>
              <CardHeader title="Venue bookings" />
              <CardBody>
                {event.venueBookings.length === 0 ? (
                  <p className="text-sm text-ink-3">No venue is booked yet.</p>
                ) : (
                  <DetailList
                    columns={1}
                    items={event.venueBookings.map((booking) => ({
                      label: booking.session?.label || "Whole event",
                      value: bookingArrangement(booking),
                    }))}
                  />
                )}
              </CardBody>
            </Card>
          )}

          {/* Absent entirely, not just empty, for an Attendee - internal
              planning information they have no reason to see (SPM-31). */}
          {event.facilityRequirements !== undefined && (
            <Card>
              <CardHeader title="Venue requirements" />
              <CardBody>
                <DetailList
                  items={[
                    {
                      label: "Required facilities",
                      value:
                        event.facilityRequirements.length === 0 ? (
                          EMPTY
                        ) : (
                          <ul className="flex flex-col gap-1">
                            {event.facilityRequirements.map((req) => (
                              <li key={req.facilityId}>
                                {req.facility.name}
                                {!req.isMandatory && <span className="text-ink-3"> (nice-to-have)</span>}
                              </li>
                            ))}
                          </ul>
                        ),
                    },
                    { label: "Accessibility notes", value: orEmpty(event.accessibilityNotes) },
                    { label: "Special requirements", value: orEmpty(event.specialRequirements) },
                  ]}
                />
              </CardBody>
            </Card>
          )}

          {/* SPM-64: read-only for everyone; the assigned coordinator changes
              the settings here. */}
          <RegistrationCard
            event={event}
            eventId={eventId}
            canChange={showRegistrationControls}
            showOutstanding={user?.role !== "attendee"}
            onSaved={() => void load()}
          />

          {/* SPM-51: registering is the Attendee's action, so only they get it. */}
          {user?.role === "attendee" && event.registrationState && (
            <RegisterPanel
              eventId={event.id}
              state={event.registrationState}
              myRegistration={event.myRegistration ?? null}
              onRegistered={() => void load()}
            />
          )}
        </div>
      )}

      <ConfirmDialog
        open={withdrawOpen}
        title="Record this withdrawal?"
        confirmLabel="Record withdrawal"
        cancelLabel="Keep request"
        loading={withdrawing}
        onConfirm={() => void withdraw()}
        onCancel={() => setWithdrawOpen(false)}
      >
        Only do this when the organiser has asked to withdraw.{" "}
        {event?.title || "This request"} will be marked Withdrawn and can&apos;t be reopened.
        To go ahead later, the organiser submits a new request.
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmOpen}
        title="Confirm this event?"
        confirmLabel="Confirm event"
        cancelLabel="Not yet"
        loading={confirming}
        onConfirm={() => void confirmEvent()}
        onCancel={() => setConfirmOpen(false)}
      >
        {event?.title || "This event"} will be marked Confirmed, and the organiser will be
        able to see the venue and equipment arranged for it. Anything still outstanding will
        be listed instead.
      </ConfirmDialog>

      <ConfirmDialog
        open={safetyOpen}
        title="Submit for safety check?"
        confirmLabel="Submit"
        cancelLabel="Not yet"
        loading={submittingSafety}
        onConfirm={() => void submitForSafetyCheck()}
        onCancel={() => setSafetyOpen(false)}
      >
        {event?.title || "This event"} will move to Safety review and the Safety Officer will be
        notified. Anything still outstanding or flagged for review will be listed instead.
      </ConfirmDialog>
    </div>
  );
}
