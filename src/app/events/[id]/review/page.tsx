"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CheckboxGroup,
  CardHeader,
  ConfirmDialog,
  DetailList,
  Field,
  PageHeader,
  SkeletonRows,
  StatusBadge,
  Textarea,
} from "@/components/ui";
import { RequirePermission } from "@/components/RequirePermission";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { eventCrumbs } from "@/lib/breadcrumbs";
import { eventReference, formatDateTimeRange } from "@/lib/format";
import { humanise, statusLabel } from "@/lib/statuses";
import { canReviewEvent } from "@/lib/permissions";
import {
  REJECTION_REASON_REQUIRED,
  REVIEW_FIELD_LABELS as L,
  isBlankReason,
  missingRequestFields,
} from "@/lib/eventReview";
import { cn } from "@/lib/cn";
import {
  CLARIFICATION_FIELDS_REQUIRED,
  CLARIFICATION_MESSAGE_REQUIRED,
  clarificationProblem,
} from "@/lib/clarification";
import { ClarificationDetails, type OpenClarification } from "../ClarificationDetails";

// S-13 Event review (SPM-28), design/mockups/EventReview.dc.html. A task
// screen of its own (UI_DESIGN.md §3.3), not a tab of the event hub (S-06).
//
// The assigned coordinator reads everything that was requested (AC2), sees
// what is missing (AC3), and either approves the request for planning (AC4)
// or rejects it with a reason (AC5). Either outcome moves the status (AC6)
// and takes the request off the Review Queue.
//
// SPM-29: or asks the organiser for clarification - which parts of the
// request, and a message. The event stays Under review, the clarification is
// shown here and on the event page, and Approve and Reject stay available
// (decided 2026-10-19). One is open at a time, so the option is hidden while
// one is.
//
// Decisions made 2026-09-30 (docs/test-cases/SPM-28_test_cases.json):
//   - missing information is flagged, never blocking (discussions #80, #72)
//   - Approve asks for confirmation; Reject needs a reason instead

interface ReviewEvent {
  id: string;
  sequenceNumber: number;
  title: string | null;
  purpose: string | null;
  description: string | null;
  category: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  expectedAttendance: number | null;
  preferredLayout: string | null;
  accessibilityNotes: string | null;
  specialRequirements: string | null;
  registrationEnabled: boolean;
  registrationCapacity: number | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  organiserId: string;
  organisationId: string | null;
  coordinatorId: string | null;
  organiser: { fullName: string };
  organisation: { name: string } | null;
  facilityRequirements: Array<{ facilityId: string; isMandatory: boolean; facility: { name: string } }>;
  equipmentRequests: Array<{
    id: string;
    sessionId: string | null;
    quantityRequested: number;
    equipment: { name: string };
  }>;
  sessions: Array<{
    id: string;
    label: string | null;
    startsAt: string;
    endsAt: string;
    expectedAttendance: number | null;
    preferredLayout: string | null;
  }>;
  /// SPM-29: sent to the assigned coordinator; null when none is open.
  openClarification?: OpenClarification | null;
}

type Choice = "approve" | "reject" | "clarify" | null;

const CLARIFY_OPTIONS = Object.entries(L).map(([id, name]) => ({ id, name }));

/// The visible marker for anything the organiser left empty (AC3). Text, not
/// only colour, so it reads the same in greyscale and to a screen reader.
function NotProvided() {
  return (
    <span className="inline-flex items-center rounded-full bg-tone-warning-bg px-2 py-0.5 text-xs font-medium text-tone-warning-fg ring-1 ring-inset ring-tone-warning-ring">
      Not provided
    </span>
  );
}

function orMissing(value: string | number | null | undefined): React.ReactNode {
  if (value == null || (typeof value === "string" && value.trim() === "")) return <NotProvided />;
  return String(value);
}

export default function ReviewRequestPage() {
  const eventId = useParams<{ id: string }>().id;
  return (
    <RequirePermission
      action="event:review"
      title="Review request"
      breadcrumbs={(role) => eventCrumbs(role, eventId, null, { label: "Review request" })}
      reason="Reviewing event requests is the Event Coordinator's role. You can still see events you are involved in from All Events."
    >
      <ReviewScreen />
    </RequirePermission>
  );
}

function ReviewScreen() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const { user } = useCurrentUser();

  const [event, setEvent] = useState<ReviewEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [choice, setChoice] = useState<Choice>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Set once a decision is saved: the page stays, showing the outcome.
  const [outcome, setOutcome] = useState<"approved" | "rejected" | null>(null);

  // SPM-29: asking the organiser for clarification.
  const [clarifyFields, setClarifyFields] = useState<string[]>([]);
  const [clarifyMessage, setClarifyMessage] = useState("");
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [clarified, setClarified] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}`);
      if (res.status === 401) {
        router.push(loginUrlFor(`/events/${eventId}/review`));
        return;
      }
      if (res.status === 404) {
        setError("This event doesn't exist, or you don't have access to it.");
        return;
      }
      if (!res.ok) throw new Error("Could not load this request.");
      setEvent(await res.json());
    } catch (err) {
      setEvent(null);
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [eventId, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function choose(next: Choice) {
    setChoice(next);
    setReasonError(null);
    setSubmitError(null);
  }

  function cancelReject() {
    setChoice(null);
    setReason("");
    setReasonError(null);
    setSubmitError(null);
  }

  async function decide(status: "approved" | "rejected") {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(status === "rejected" ? { status, reason: reason.trim() } : { status }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Could not save your decision. Please try again.");
      }
      const updated = await res.json();
      setEvent((current) =>
        current ? { ...current, status: updated.status, coordinatorId: updated.coordinatorId } : current
      );
      setOutcome(status);
      setConfirmOpen(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong");
      setConfirmOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  function toggleClarifyField(field: string) {
    setClarifyFields((current) =>
      current.includes(field) ? current.filter((f) => f !== field) : [...current, field]
    );
    setFieldsError(null);
  }

  async function sendClarification() {
    const problem = clarificationProblem({ fields: clarifyFields, message: clarifyMessage });
    setFieldsError(problem === CLARIFICATION_FIELDS_REQUIRED ? problem : null);
    setMessageError(problem === CLARIFICATION_MESSAGE_REQUIRED ? problem : null);
    if (problem) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}/clarifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: clarifyFields, message: clarifyMessage.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Could not send your request. Please try again.");
      }
      const clarification: OpenClarification = await res.json();
      // v8 ignore next -- the form is only shown once the event has loaded, so `current` is never null here
      setEvent((current) => (current ? { ...current, openClarification: clarification } : current));
      setClarified(true);
      setChoice(null);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  function submitReject() {
    if (isBlankReason(reason)) {
      setReasonError(REJECTION_REASON_REQUIRED);
      return;
    }
    void decide("rejected");
  }

  const ref = event ? eventReference(event.sequenceNumber) : eventId;
  const title = event?.title || "Untitled event";

  const actor = user ? { id: user.id, role: user.role, organisationId: null } : null;
  const reviewable = Boolean(
    actor &&
      event &&
      canReviewEvent(actor, {
        organiserId: event.organiserId,
        organisationId: event.organisationId,
        coordinatorId: event.coordinatorId,
        status: event.status,
      })
  );
  const assignedToMe = Boolean(user && event && event.coordinatorId === user.id);
  const missing = event ? missingRequestFields(event) : [];

  // Opened for a request that was already decided (an old link, Back, a typed
  // address): there is nothing to review, and the event page is where its
  // status and any rejection reason are shown - go there instead of a dead
  // end (confirmed 2026-09-30). Not after a decision made on this page:
  // `outcome` keeps the confirmation here.
  const alreadyDecided = Boolean(event && assignedToMe && !reviewable && !outcome);
  useEffect(() => {
    if (alreadyDecided) router.replace(`/events/${ref}`);
  }, [alreadyDecided, ref, router]);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Review request"
        subtitle={event ? title : undefined}
        meta={
          event && (
            <>
              <span className="text-xs text-ink-3">{ref}</span>
              <StatusBadge status={event.status} />
            </>
          )
        }
        breadcrumbs={eventCrumbs(user?.role, ref, event?.title, { label: "Review request" })}
      />

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
      ) : !event || !user || alreadyDecided ? (
        <SkeletonRows rows={4} />
      ) : !assignedToMe ? (
        // Any coordinator can view any submitted event (canViewEvent), but only
        // the one it is assigned to may review it - so the request itself is
        // not shown here, only the refusal (AC1).
        <Alert variant="error" title="You can't review this request">
          Only the coordinator assigned to this request can review it.
        </Alert>
      ) : (
        <div className="flex flex-col gap-6">
          {outcome === "approved" && (
            <Alert
              variant="success"
              title="Request approved"
              action={
                <ButtonLink href="/queue" variant="secondary" size="sm">
                  Back to Review Queue
                </ButtonLink>
              }
            >
              &ldquo;{title}&rdquo; is now {statusLabel("approved")}. Planning can start.
            </Alert>
          )}
          {outcome === "rejected" && (
            <Alert
              variant="success"
              title="Request rejected"
              action={
                <ButtonLink href="/queue" variant="secondary" size="sm">
                  Back to Review Queue
                </ButtonLink>
              }
            >
              &ldquo;{title}&rdquo; is now {statusLabel("rejected")}. The organiser can see your reason on the event.
              <span className="mt-1 block">Reason: {reason.trim()}</span>
            </Alert>
          )}

          {clarified && (
            <Alert variant="success" title="Clarification requested">
              &ldquo;{title}&rdquo; stays {statusLabel("under_review")}. The organiser can see your request on the event.
            </Alert>
          )}

          {event.openClarification && (
            <Card>
              <CardHeader title="Open clarification" />
              <CardBody className="text-sm text-ink-2">
                <ClarificationDetails clarification={event.openClarification} />
              </CardBody>
            </Card>
          )}

          {reviewable && missing.length > 0 && (
            <Alert variant="warning" title="Some information was not provided">
              {missing.join(", ")}. Check whether any of these matter for this event before you decide.
            </Alert>
          )}

          <Card>
            <CardHeader title="What was requested" />
            <CardBody>
              <DetailList
                items={[
                  { label: "Client", value: orMissing(event.organisation?.name) },
                  { label: "Organiser", value: event.organiser.fullName },
                  { label: L.category, value: orMissing(event.category && humanise(event.category)) },
                  {
                    label: L.when,
                    value:
                      event.startsAt && event.endsAt ? formatDateTimeRange(event.startsAt, event.endsAt) : <NotProvided />,
                  },
                  { label: L.purpose, value: orMissing(event.purpose) },
                  { label: L.description, value: orMissing(event.description) },
                  { label: L.expectedAttendance, value: orMissing(event.expectedAttendance) },
                  { label: L.preferredLayout, value: orMissing(event.preferredLayout && humanise(event.preferredLayout)) },
                  { label: L.accessibilityNotes, value: orMissing(event.accessibilityNotes) },
                  { label: L.specialRequirements, value: orMissing(event.specialRequirements) },
                  {
                    label: "Registration",
                    value: event.registrationEnabled ? (
                      <>
                        Enabled · capacity {orMissing(event.registrationCapacity)}
                        {(event.registrationOpensAt || event.registrationClosesAt) && (
                          <span className="block text-ink-3">
                            {formatDateTimeRange(event.registrationOpensAt, event.registrationClosesAt)}
                          </span>
                        )}
                      </>
                    ) : (
                      "Not enabled"
                    ),
                  },
                  {
                    label: L.facilities,
                    value:
                      event.facilityRequirements.length === 0 ? (
                        <NotProvided />
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {event.facilityRequirements.map((req) => (
                            <li key={req.facilityId}>
                              {req.facility.name}{" "}
                              <span className="text-ink-3">({req.isMandatory ? "required" : "nice-to-have"})</span>
                            </li>
                          ))}
                        </ul>
                      ),
                  },
                  {
                    label: L.equipment,
                    value:
                      event.equipmentRequests.length === 0 ? (
                        <NotProvided />
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {event.equipmentRequests.map((req) => {
                            const session = req.sessionId && event.sessions.find((s) => s.id === req.sessionId);
                            return (
                              <li key={req.id}>
                                {req.equipment.name} × {req.quantityRequested}
                                {session && (
                                  <span className="text-ink-3">
                                    {" "}
                                    ({session.label || formatDateTimeRange(session.startsAt, session.endsAt)})
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      ),
                  },
                ]}
              />
            </CardBody>
          </Card>

          {event.sessions.length > 0 && (
            <Card>
              <CardHeader title="Sessions" subtitle={`${event.sessions.length} sessions in this event.`} />
              <CardBody>
                <ul className="flex flex-col divide-y divide-line">
                  {event.sessions.map((session, i) => (
                    <li key={session.id} className="py-3 first:pt-0 last:pb-0 text-sm">
                      <p className="font-medium text-ink">{session.label || `Session ${i + 1}`}</p>
                      <p className="text-ink-2">
                        {formatDateTimeRange(session.startsAt, session.endsAt)} · Attendance{" "}
                        {orMissing(session.expectedAttendance)} · Layout{" "}
                        {orMissing(session.preferredLayout && humanise(session.preferredLayout))}
                      </p>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}


          {reviewable && !outcome && (
            <Card>
              <CardHeader title="Your decision" />
              <CardBody className="flex flex-col gap-3">
                {submitError && <Alert variant="error">{submitError}</Alert>}

                <div role="radiogroup" aria-label="Review outcome" className="flex flex-col gap-3">
                  <DecisionOption
                    checked={choice === "approve"}
                    onSelect={() => choose("approve")}
                    title="Approve — planning can start"
                    description="Moves the event to Approved so venue and equipment planning can begin."
                  />
                  <DecisionOption
                    checked={choice === "reject"}
                    onSelect={() => choose("reject")}
                    title="Reject this request"
                    description="The decision and its reason stay on the event record. The organiser sees the reason."
                  />
                  {!event.openClarification && (
                    <DecisionOption
                      checked={choice === "clarify"}
                      onSelect={() => choose("clarify")}
                      title="Ask the organiser for clarification"
                      description="Keeps the request Under review and shows your message to the organiser on the event."
                    />
                  )}
                </div>

                {choice === "approve" && (
                  <div>
                    <Button onClick={() => setConfirmOpen(true)}>Approve request</Button>
                  </div>
                )}

                {choice === "reject" && (
                  <div className="flex flex-col gap-3">
                    <Field
                      label="Reason for rejection"
                      required
                      hint="Explain the decision so the organiser can act on it. The organiser sees this message."
                      error={reasonError}
                    >
                      <Textarea
                        value={reason}
                        onChange={(e) => {
                          setReason(e.target.value);
                          if (reasonError) setReasonError(null);
                        }}
                        placeholder="Explain the decision so the organiser can act on it…"
                        rows={4}
                      />
                    </Field>
                    <div className="flex gap-2">
                      <Button variant="danger" onClick={submitReject} loading={submitting} loadingText="Rejecting…">
                        Reject request
                      </Button>
                      <Button variant="secondary" onClick={cancelReject} disabled={submitting}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {choice === "clarify" && (
                  <div className="flex flex-col gap-3">
                    <div>
                      <CheckboxGroup
                        legend="What needs clarification"
                        hint="Tick each part of the request the organiser should clarify."
                        options={CLARIFY_OPTIONS}
                        selected={clarifyFields}
                        onToggle={toggleClarifyField}
                      />
                      {fieldsError && <p className="mt-2 text-xs font-medium text-tone-danger-fg">{fieldsError}</p>}
                    </div>
                    <Field
                      label="Message to the organiser"
                      required
                      hint="Say what is unclear or missing. The organiser sees this message."
                      error={messageError}
                    >
                      <Textarea
                        value={clarifyMessage}
                        onChange={(e) => {
                          setClarifyMessage(e.target.value);
                          if (messageError) setMessageError(null);
                        }}
                        rows={4}
                      />
                    </Field>
                    <div>
                      <Button onClick={() => void sendClarification()} loading={submitting} loadingText="Sending…">
                        Send request
                      </Button>
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          <ConfirmDialog
            open={confirmOpen}
            title="Approve this request?"
            confirmLabel="Approve"
            confirmVariant="primary"
            loading={submitting}
            onConfirm={() => void decide("approved")}
            onCancel={() => setConfirmOpen(false)}
          >
            &ldquo;{title}&rdquo; moves from {statusLabel("under_review")} to {statusLabel("approved")}, and leaves
            your Review Queue. Venue and equipment planning can then start.
          </ConfirmDialog>
        </div>
      )}
    </div>
  );
}

function DecisionOption({
  checked,
  onSelect,
  title,
  description,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border bg-surface px-4 py-3",
        checked ? "border-ink ring-1 ring-inset ring-ink" : "border-line"
      )}
    >
      <input
        type="radio"
        name="review-outcome"
        checked={checked}
        onChange={onSelect}
        className="mt-1 h-4 w-4 accent-ink"
      />
      <span>
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block text-sm text-ink-3">{description}</span>
      </span>
    </label>
  );
}
