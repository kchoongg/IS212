"use client";

import { useState } from "react";
import { Alert, Button, Card, CardBody, CardHeader, ConfirmDialog, Field, Input, StatusBadge } from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { formatDate, formatDateTime } from "@/lib/format";
import { canWithdraw, withdrawWarning, type RegistrationState } from "@/lib/registrationEligibility";
import { WithdrawRegistrationDialog } from "@/components/WithdrawRegistrationDialog";
import { offerStands } from "@/lib/waitingList";

// Register for Event (SPM-51): the attendee's "Your registration" card on the
// event page. Whether they can register is the server's rule
// (registrationState(), the same one POST /api/registrations applies); this
// card shows it - a message instead of a button whenever registering would be
// refused (UI_DESIGN §7: S-26 rows).
//
// SPM-66 (Join and Respond to Waiting List): a full event offers "Join waiting
// list" in place of Register (AC1); a waitlisted attendee sees their position
// and can leave (AC3, AC4); a place offered to them can be accepted or
// declined until the offer ends (AC6, AC7).

/// A state as it arrives over JSON: its dates are strings.
export type RegistrationStateJson = { kind: RegistrationState["kind"]; opensAt?: string; closesAt?: string };

export interface MyRegistration {
  id: string;
  status: string;
  registeredAt: string;
  /// SPM-66: set while a place is under offer to them.
  offerExpiresAt?: string | null;
  /// SPM-66 (AC3): their place in the queue, counting from 1.
  waitingListPosition?: number | null;
}

/// Statuses that mean the attendee already holds a place, so no Register.
const HOLDS_A_PLACE = ["registered", "attended", "waitlisted"];

interface Props {
  /// The event's id (POST /api/registrations takes the id, not the reference).
  eventId: string;
  /// SPM-66: the event's reference, for its waiting list route.
  eventRef: string;
  /// For the Withdraw question (SPM-52).
  eventTitle: string | null;
  /// SPM-52: no Withdraw once the event is over or cancelled.
  eventStatus: string;
  eventEndsAt: string | null;
  /// SPM-52: for the warning when they couldn't register again (withdrawWarning()).
  registrationEnabled: boolean;
  registrationClosesAt: string | null;
  state: RegistrationStateJson;
  myRegistration: MyRegistration | null;
  /// Called after registering, to reload the event.
  onRegistered: () => void;
  /// Called after withdrawing (SPM-52), with the registration's id. The page
  /// reloads the event, which the attendee may no longer be able to see.
  onWithdrawn: (registrationId: string) => void;
}

function Message({ state }: { state: RegistrationStateJson }) {
  switch (state.kind) {
    case "not_open":
      return <p>Registration opens {formatDateTime(state.opensAt ?? null)}.</p>;
    case "closed":
      return <p>Registration closed on {formatDateTime(state.closesAt ?? null)}.</p>;
    case "no_period":
      return <p>Registration dates haven&apos;t been set for this event.</p>;
    default:
      return <p>Registration is not enabled for this event.</p>;
  }
}

type Ask = "leave" | "decline" | null;

export function RegisterPanel({
  eventId,
  eventRef,
  eventTitle,
  eventStatus,
  eventEndsAt,
  registrationEnabled,
  registrationClosesAt,
  state,
  myRegistration,
  onRegistered,
  onWithdrawn,
}: Props) {
  const [dietary, setDietary] = useState("");
  const [accessibility, setAccessibility] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);
  // SPM-66: what just happened on the waiting list, and the question open.
  const [done, setDone] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [answering, setAnswering] = useState(false);
  const full = state.kind === "full";

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const needs = {
        ...(dietary.trim() ? { dietaryRequirements: dietary.trim() } : {}),
        ...(accessibility.trim() ? { accessibilityRequirements: accessibility.trim() } : {}),
      };
      // SPM-66 (AC1): a full event's form joins its waiting list instead.
      const res = full
        ? await authedFetch(`/api/events/${eventRef}/waiting-list`, { method: "POST", body: JSON.stringify(needs) })
        : await authedFetch("/api/registrations", { method: "POST", body: JSON.stringify({ eventId, ...needs }) });
      if (!res.ok) {
        setError(
          (await res.json()).error ?? (full ? "Could not join the waiting list." : "Could not register for this event.")
        );
        return;
      }
      setRegistered(!full);
      setDone(full ? "You're on the waiting list." : null);
      setWithdrawn(false);
      onRegistered();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const holding = myRegistration && HOLDS_A_PLACE.includes(myRegistration.status) ? myRegistration : null;
  const waiting = holding?.status === "waitlisted" ? holding : null;
  const offered = waiting && offerStands(waiting.offerExpiresAt, new Date()) ? waiting : null;

  /// SPM-66: accept or decline the place offered (AC6, AC7), or leave the list (AC4).
  async function answer(action: "accept" | "decline" | "leave") {
    // v8 ignore next -- these buttons only show while the attendee is waiting
    if (!waiting) return;
    setAnswering(true);
    setError(null);
    setDone(null);
    try {
      const res =
        action === "leave"
          ? await authedFetch(`/api/registrations/${waiting.id}`, {
              method: "PATCH",
              body: JSON.stringify({ status: "withdrawn" }),
            })
          : await authedFetch(`/api/registrations/${waiting.id}/offer`, {
              method: "POST",
              body: JSON.stringify({ response: action }),
            });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error ?? "Could not update your place on the waiting list.");
        return;
      }
      if (action === "accept") {
        setRegistered(true);
        onRegistered();
      } else {
        setDone(action === "leave" ? "You have left the waiting list." : "You have declined the place.");
        onWithdrawn(waiting.id);
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setAnswering(false);
      setAsk(null);
    }
  }

  return (
    <Card>
      <CardHeader title="Your registration" />
      <CardBody>
        <div className="flex flex-col gap-4">
          {registered && <Alert variant="success">You&apos;re registered for this event.</Alert>}
          {withdrawn && <Alert variant="success">You have withdrawn from this event.</Alert>}
          {done && <Alert variant="success">{done}</Alert>}
          {error && <Alert variant="error">{error}</Alert>}

          {offered ? (
            // SPM-66 (AC5, AC6): a place is theirs if they accept in time.
            <Alert variant="info" title="A place is available for you">
              <p>
                Accept it by {formatDateTime(offered.offerExpiresAt as string)}. If you don&apos;t, it goes to the next
                person on the waiting list.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" loading={answering} loadingText="Accepting…" onClick={() => void answer("accept")}>
                  Accept place
                </Button>
                <Button variant="secondary" size="sm" disabled={answering} onClick={() => setAsk("decline")}>
                  Decline
                </Button>
              </div>
            </Alert>
          ) : waiting ? (
            // SPM-66 (AC3, AC4): where they are, and the way off the list.
            <div className="flex flex-wrap items-center gap-3 text-sm text-ink">
              <StatusBadge status="waitlisted" />
              <span>
                {waiting.waitingListPosition
                  ? `You're number ${waiting.waitingListPosition} on the waiting list.`
                  : "You're on the waiting list."}
              </span>
              <Button variant="secondary" size="sm" onClick={() => setAsk("leave")}>
                Leave waiting list
              </Button>
            </div>
          ) : holding ? (
            <div className="flex flex-wrap items-center gap-3 text-sm text-ink">
              <StatusBadge status={holding.status} />
              <span>You registered on {formatDate(holding.registeredAt)}.</span>
              {/* SPM-52: Withdraw, for a registration holding a seat. */}
              {canWithdraw(holding.status, { status: eventStatus, endsAt: eventEndsAt }, new Date()) && (
                <Button variant="secondary" size="sm" onClick={() => setConfirmWithdraw(true)}>
                  Withdraw
                </Button>
              )}
            </div>
          ) : state.kind === "open" || full ? (
            <form noValidate onSubmit={(e) => void register(e)} className="flex flex-col gap-4">
              <Field label="Dietary requirements" hint="Optional.">
                <Input name="dietaryRequirements" value={dietary} onChange={(e) => setDietary(e.target.value)} />
              </Field>
              <Field label="Accessibility requirements" hint="Optional.">
                <Input
                  name="accessibilityRequirements"
                  value={accessibility}
                  onChange={(e) => setAccessibility(e.target.value)}
                />
              </Field>
              {/* SPM-66 (AC1): offered instead of Register on a full event. */}
              {full && <p className="text-sm text-ink">This event is full. You can join the waiting list instead.</p>}
              <div>
                <Button type="submit" loading={saving} loadingText={full ? "Joining…" : "Registering…"}>
                  {full ? "Join waiting list" : "Register"}
                </Button>
              </div>
            </form>
          ) : (
            <div className="text-sm text-ink">
              <Message state={state} />
            </div>
          )}
        </div>
      </CardBody>
      <ConfirmDialog
        open={ask === "leave"}
        title={`Leave the waiting list for ${eventTitle || "this event"}?`}
        confirmLabel="Leave waiting list"
        cancelLabel="Stay on the list"
        loading={answering}
        onConfirm={() => void answer("leave")}
        onCancel={() => setAsk(null)}
      >
        You lose your place in the queue. To wait again, you would join at the back of the list.
      </ConfirmDialog>
      <ConfirmDialog
        open={ask === "decline"}
        title="Decline this place?"
        confirmLabel="Decline place"
        cancelLabel="Keep the offer"
        loading={answering}
        onConfirm={() => void answer("decline")}
        onCancel={() => setAsk(null)}
      >
        The place goes to the next person on the waiting list, and you leave the waiting list.
      </ConfirmDialog>
      <WithdrawRegistrationDialog
        target={
          confirmWithdraw && holding
            ? {
                id: holding.id,
                eventTitle,
                warning: withdrawWarning({ registrationEnabled, registrationClosesAt }, new Date()),
              }
            : null
        }
        onCancel={() => setConfirmWithdraw(false)}
        onWithdrawn={() => {
          setConfirmWithdraw(false);
          setRegistered(false);
          setWithdrawn(true);
          // v8 ignore next -- the dialog only opens while holding is set
          if (holding) onWithdrawn(holding.id);
        }}
      />
    </Card>
  );
}
