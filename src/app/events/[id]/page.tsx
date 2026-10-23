"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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
import { eventCrumbs } from "@/lib/breadcrumbs";
import { eventTabItemsFor } from "@/lib/eventTabs";
import { EMPTY, eventReference, formatDateTime, formatDateTimeRange, orEmpty } from "@/lib/format";
import { humanise, statusLabel } from "@/lib/statuses";
import { isExternalRole } from "@/lib/roles";
import { decisionDoneMessage, safetyCheckSummary, type SafetyDecision } from "@/lib/safetyDecision";
import { unavailabilityReasonLabel } from "@/lib/venueUnavailability";
import { SafetyDecisionDialog } from "./SafetyDecisionDialog";
import { SafetyFlagDialog, type SafetyFlagChoice } from "./SafetyFlagDialog";
import { ChangeRequestsCard } from "./ChangeRequestsCard";
import { canRequestChangeIn } from "@/lib/eventChangeRequest";
import { completedMessage } from "@/lib/eventCompletion";
import { ClarificationDetails, type OpenClarification } from "./ClarificationDetails";
import { canFlagAfterReturn, safetyFlaggedMessage, safetyHistoryLine } from "@/lib/safetyResolution";
import {
  EVENT_INFORMATION_EDIT_STATUSES,
  EVENT_INFORMATION_STATUSES,
  can,
  canAssignCoordinator,
  canConfigureRegistration,
  canConfirmEvent,
  canFlagForSafetyReview,
  canMarkEventCompleted,
  canRecordSafetyDecision,
  canRequestEventChange,
  canRespondToClarification,
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
  // SPM-35: how many change requests the event has - present (and above 0)
  // only for the people who may see them, so the card loads only then.
  changeRequestCount?: number;
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
    /// SPM-90: what the space is for; null on a booking made without one.
    purpose?: string | null;
    session: { label: string | null } | null;
    venue: {
      name: string;
      code: string;
      layouts?: { layoutName: string; capacity: number }[];
      /// SPM-87 (AC2): the venue's opening hours and its unavailable periods
      /// on the event's dates - staff only.
      opensAt?: string;
      closesAt?: string;
      unavailable?: { startsAt: string; endsAt: string; reason: string }[];
    };
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
  // SPM-29: sent only to the organiser and the assigned coordinator.
  openClarification?: OpenClarification | null;
  // Present for an Attendee too - which company is running the event is
  // public, even though who personally organised it (above) is not.
  organisation?: { name: string } | null;
  /// SPM-86 (AC8): the latest Operational Safety Check, null if the event was
  /// never submitted. Absent for an external user - safety details are
  /// internal (SPM-88), so the organiser sees the Safety review status only.
  safetyCheck?: SafetyCheckEntry | null;
  /// SPM-88 (AC1): every check, newest first. Staff only, like safetyCheck.
  safetyHistory?: SafetyCheckEntry[];
  /// SPM-65: whether this user may open the Attendees tab. Absent for a role
  /// that never has it.
  canViewRegistrationList?: boolean;
}

interface SafetyCheckEntry {
  status: string;
  submittedAt: string;
  submittedBy: string | null;
  /// SPM-87 (AC10): the Safety Officer's decision, who and when, and why.
  decidedAt?: string | null;
  decidedBy?: string | null;
  decisionNote?: string | null;
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
/// SPM-90 (AC5): what the space is for comes straight after the room -
/// "Marina Auditorium (MAR-AUD) · Main programme · Theatre · seats 220".
function bookingArrangement(booking: NonNullable<EventDetail["venueBookings"]>[number]): string {
  const purpose = booking.purpose?.trim();
  const room = `${booking.venue.name} (${booking.venue.code})${purpose ? ` · ${purpose}` : ""}`;
  if (!booking.layoutName) return `${room} · Layout not set`;
  const capacity = booking.venue.layouts?.find((l) => l.layoutName === booking.layoutName)?.capacity;
  const seats = capacity != null ? `seats ${capacity}` : "capacity not recorded";
  return `${room} · ${humanise(booking.layoutName)} · ${seats}`;
}

/// SPM-87 (AC2): the room as SPM-85 words it, then - when the response
/// carries them - its opening hours and each period it is unavailable on the
/// event's dates: "Open 08:00–22:00", "Unavailable 8 Oct 2027, 07:00–09:00 (Maintenance)".
function bookingWithRestrictions(booking: NonNullable<EventDetail["venueBookings"]>[number]): React.ReactNode {
  const { opensAt, closesAt, unavailable } = booking.venue;
  if (!opensAt && !unavailable?.length) return bookingArrangement(booking);
  return (
    <span className="flex flex-col gap-0.5">
      <span>{bookingArrangement(booking)}</span>
      {opensAt && closesAt && <span className="text-ink-3">{`Open ${opensAt}–${closesAt}`}</span>}
      {unavailable?.map((p) => (
        <span key={`${p.startsAt}-${p.reason}`} className="text-tone-warning-fg">
          {`Unavailable ${formatDateTimeRange(p.startsAt, p.endsAt)} (${unavailabilityReasonLabel(p.reason)})`}
        </span>
      ))}
    </span>
  );
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
  return (
    // useSearchParams needs a Suspense boundary above it.
    <Suspense fallback={null}>
      <EventOverview />
    </Suspense>
  );
}

function EventOverview() {
  const router = useRouter();
  // SPM-26: the Update request page brings the organiser back with
  // ?resubmitted=1 once their answer is saved.
  const resubmitted = useSearchParams().get("resubmitted") === "1";
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
  // SPM-36: the assigned coordinator marking the event completed once it has
  // taken place.
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  // SPM-86: the assigned coordinator submitting the event for an Operational
  // Safety Check. As with Confirm, the server decides whether the
  // arrangements are ready and the page shows what it says back.
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [submittingSafety, setSubmittingSafety] = useState(false);
  // SPM-87: the Safety Officer recording their decision.
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [deciding, setDeciding] = useState(false);
  // SPM-88 (AC3): the assigned coordinator flagging what a returned check concerns.
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /// `whenGone` is called instead of showing "doesn't exist" when the event
  /// can no longer be seen (SPM-52: an attendee who withdrew from an event
  /// with registration turned off could only see it while holding a place).
  const load = useCallback(async (whenGone?: () => void) => {
    setError(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}`);
      if (res.status === 401) {
        router.push(loginUrlFor(`/events/${eventId}`));
        return;
      }
      if (res.status === 404) {
        if (whenGone) {
          whenGone();
          return;
        }
        // Not the old title and status badge above the error.
        setEvent(null);
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

  async function markCompleted() {
    setCompleting(true);
    setActionError(null);
    setNotice(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
      });
      if (!res.ok) {
        setActionError((await res.json().catch(() => ({}))).error ?? "Could not mark this event as completed.");
        return;
      }
      setNotice(completedMessage(event?.title));
      void load();
    } catch {
      setActionError("Could not reach the server. Check your connection and try again.");
    } finally {
      setCompleting(false);
      setCompleteOpen(false);
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

  async function recordSafetyDecision(decision: SafetyDecision, note: string | undefined) {
    setDeciding(true);
    setActionError(null);
    setNotice(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}/safety-decision`, {
        method: "POST",
        body: JSON.stringify(note === undefined ? { decision } : { decision, note }),
      });
      if (!res.ok) {
        // e.g. "This safety check has already been decided." (AC11)
        setActionError((await res.json().catch(() => ({}))).error ?? "Could not record this safety decision.");
        return;
      }
      setNotice(decisionDoneMessage(decision));
      void load();
    } catch {
      setActionError("Could not reach the server. Check your connection and try again.");
    } finally {
      setDeciding(false);
      setDecisionOpen(false);
    }
  }

  async function flagForSafetyReview(choice: SafetyFlagChoice) {
    setFlagging(true);
    setActionError(null);
    setNotice(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}/safety-flags`, {
        method: "POST",
        body: JSON.stringify(choice),
      });
      if (!res.ok) {
        setActionError((await res.json().catch(() => ({}))).error ?? "Could not flag these arrangements.");
        return;
      }
      setNotice(safetyFlaggedMessage((await res.json()).flagged));
      void load();
    } catch {
      setActionError("Could not reach the server. Check your connection and try again.");
    } finally {
      setFlagging(false);
      setFlagOpen(false);
    }
  }

  // SPM-26: the organiser who raised the request answers the clarification -
  // the PATCH route's own rule, so the link is never shown only to be refused.
  const showRespond = Boolean(
    user &&
    event?.openClarification &&
    event.organiserId !== undefined &&
    canRespondToClarification(
      { id: user.id, role: user.role, organisationId: null },
      {
        organiserId: event.organiserId,
        // v8 ignore next -- the API always sends it to an organiser; `?? null` only satisfies the type
        organisationId: event.organisationId ?? null,
        // v8 ignore next -- as above
        coordinatorId: event.coordinatorId ?? null,
        status: event.status,
      }
    )
  );

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

  // SPM-36 (AC1, AC2): the assigned coordinator, on a Confirmed event that
  // has ended - the PATCH route's own checks.
  const showComplete = Boolean(
    user &&
    event &&
    event.organiserId !== undefined &&
    event.coordinatorId !== undefined &&
    canMarkEventCompleted(
      { id: user.id, role: user.role, organisationId: null },
      {
        organiserId: event.organiserId,
        organisationId: event.organisationId ?? null,
        coordinatorId: event.coordinatorId,
        status: event.status,
        endsAt: event.endsAt,
      },
      new Date()
    )
  );

  // SPM-86 (AC1, AC7): the assigned coordinator, while the event is in
  // Planning. Readiness is the server's call, as for Confirm.
  // SPM-87 (AC11, AC12): the Safety Officer, while the event is in Safety review.
  const showSafetyDecision = Boolean(
    user &&
    event &&
    event.organiserId !== undefined &&
    event.coordinatorId !== undefined &&
    canRecordSafetyDecision(
      { id: user.id, role: user.role, organisationId: null },
      {
        organiserId: event.organiserId,
        organisationId: event.organisationId ?? null,
        coordinatorId: event.coordinatorId,
        status: event.status,
      }
    )
  );

  // SPM-88 (AC3): the assigned coordinator, once the Safety Officer has
  // returned the check and the event is back in Planning. Same rule as the route.
  const showSafetyFlags = Boolean(
    user &&
    event &&
    event.organiserId !== undefined &&
    event.coordinatorId !== undefined &&
    canFlagAfterReturn(event.status, event.safetyCheck?.status) &&
    canFlagForSafetyReview(
      { id: user.id, role: user.role, organisationId: null },
      {
        organiserId: event.organiserId,
        organisationId: event.organisationId ?? null,
        coordinatorId: event.coordinatorId,
        status: event.status,
      }
    )
  );

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
  // approval (/events/[id]/update). Same rule as the route - SPM-88 adds
  // Safety review and Safety approved.
  const showEditInformation = Boolean(
    user &&
    event &&
    event.organiserId !== undefined &&
    event.coordinatorId !== undefined &&
    EVENT_INFORMATION_EDIT_STATUSES.includes(event.status) &&
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

  // SPM-35 (AC1): the organiser who owns the event asks for a change, from
  // approval until it is over - the same rule as the change-request route.
  const showRequestChange = Boolean(
    user &&
    event &&
    event.organiserId !== undefined &&
    canRequestChangeIn(event.status) &&
    canRequestEventChange(
      { id: user.id, role: user.role, organisationId: null },
      {
        organiserId: event.organiserId,
        organisationId: event.organisationId ?? null,
        coordinatorId: event.coordinatorId ?? null,
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

  const tabs = user ? eventTabItemsFor(user.role, eventId, event?.canViewRegistrationList) : [];

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
        breadcrumbs={eventCrumbs(user?.role, eventId, event?.title)}
        actions={
          <>
            {showSafetyCheck && (
              <Button onClick={() => setSafetyOpen(true)}>Submit for safety check</Button>
            )}
            {showSafetyDecision && (
              <Button onClick={() => setDecisionOpen(true)}>Record safety decision</Button>
            )}
            {showSafetyFlags && (
              <Button variant="secondary" onClick={() => setFlagOpen(true)}>
                Flag arrangements for review
              </Button>
            )}
            {showConfirm && (
              <Button onClick={() => setConfirmOpen(true)}>Confirm event</Button>
            )}
            {showComplete && (
              <Button onClick={() => setCompleteOpen(true)}>Mark as completed</Button>
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
            {showRequestChange && (
              <ButtonLink href={`/events/${eventId}/change-request`} variant="secondary">
                Request a change
              </ButtonLink>
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
          {resubmitted && !event.openClarification && (
            <Alert variant="success">
              Your updated request has been sent to {event.coordinator?.fullName ?? "your coordinator"}. It stays{" "}
              {statusLabel(event.status)}.
            </Alert>
          )}
          {actionError && <Alert variant="error">{actionError}</Alert>}

          {/* SPM-28: the decision and its reason stay on the event record, and
              the organiser sees why (confirmed 2026-09-30). An Attendee never
              gets here - a rejected event is not visible to them at all. */}
          {event.status === "rejected" && event.rejectionReason && (
            <Alert variant="error" title="This request was rejected">
              {event.rejectionReason}
            </Alert>
          )}

          {/* SPM-29 (AC3): the open clarification, on the event itself. The
              API sends it only to the organiser and the assigned coordinator,
              so it is shown whenever it is here. */}
          {event.openClarification && (
            <Alert
              variant="warning"
              title="Clarification requested"
              action={
                showRespond ? (
                  <ButtonLink href={`/events/${eventId}/edit`} size="sm">
                    Update request
                  </ButtonLink>
                ) : undefined
              }
            >
              <ClarificationDetails clarification={event.openClarification} />
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

          {/* SPM-35 (AC2): what has been asked for, for the event's organisers,
              its coordinator and the Ops Manager - the only people given a count. */}
          {(event.changeRequestCount ?? 0) > 0 && <ChangeRequestsCard eventRef={eventReference(event.sequenceNumber)} />}

          {/* SPM-88 (AC1): every submission and decision, newest first. Staff
              only - the API leaves the history out for an external user. */}
          {event.safetyHistory && event.safetyHistory.length > 0 && (
            <Card>
              <CardHeader title="Safety check history" />
              <CardBody>
                <ol aria-label="Safety check history" className="flex flex-col gap-2 text-sm text-ink-2">
                  {event.safetyHistory.map((check) => (
                    <li key={check.submittedAt}>{safetyHistoryLine(check)}</li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          )}

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
                      value: bookingWithRestrictions(booking),
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
              eventTitle={event.title}
              eventStatus={event.status}
              eventEndsAt={event.endsAt}
              registrationEnabled={event.registrationEnabled}
              registrationClosesAt={event.registrationClosesAt}
              state={event.registrationState}
              myRegistration={event.myRegistration ?? null}
              onRegistered={() => void load()}
              // SPM-52: if the event is gone once they withdraw, My
              // Registrations says so and shows the row as Withdrawn.
              onWithdrawn={(registrationId) =>
                void load(() => router.replace(`/registrations?withdrawn=${encodeURIComponent(registrationId)}`))
              }
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
        open={completeOpen}
        title="Mark this event as completed?"
        confirmLabel="Mark as completed"
        cancelLabel="Not yet"
        loading={completing}
        onConfirm={() => void markCompleted()}
        onCancel={() => setCompleteOpen(false)}
      >
        {event?.title || "This event"} will be marked Completed. Its venue and equipment stay on
        record, and its status can&apos;t be changed after this.
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

      <SafetyDecisionDialog
        open={decisionOpen}
        eventTitle={event?.title ?? null}
        saving={deciding}
        onRecord={(decision, note) => void recordSafetyDecision(decision, note)}
        onCancel={() => setDecisionOpen(false)}
      />

      <SafetyFlagDialog
        open={flagOpen}
        eventId={eventId}
        saving={flagging}
        onFlag={(choice) => void flagForSafetyReview(choice)}
        onCancel={() => setFlagOpen(false)}
      />
    </div>
  );
}
