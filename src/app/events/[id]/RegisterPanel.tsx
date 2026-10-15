"use client";

import { useState } from "react";
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, StatusBadge } from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { formatDate, formatDateTime } from "@/lib/format";
import { canWithdraw, type RegistrationState } from "@/lib/registrationEligibility";
import { WithdrawRegistrationDialog } from "@/components/WithdrawRegistrationDialog";

// Register for Event (SPM-51): the attendee's "Your registration" card on the
// event page. Whether they can register is the server's rule
// (registrationState(), the same one POST /api/registrations applies); this
// card shows it - a message instead of a button whenever registering would be
// refused (UI_DESIGN §7: S-26 rows).

/// A state as it arrives over JSON: its dates are strings.
export type RegistrationStateJson = { kind: RegistrationState["kind"]; opensAt?: string; closesAt?: string };

export interface MyRegistration {
  id: string;
  status: string;
  registeredAt: string;
}

/// Statuses that mean the attendee already holds a place, so no Register.
const HOLDS_A_PLACE = ["registered", "attended", "waitlisted"];

interface Props {
  /// The event's id (POST /api/registrations takes the id, not the reference).
  eventId: string;
  /// For the Withdraw question (SPM-52).
  eventTitle: string | null;
  state: RegistrationStateJson;
  myRegistration: MyRegistration | null;
  /// Called after registering or withdrawing, to reload the event.
  onRegistered: () => void;
}

function Message({ state }: { state: RegistrationStateJson }) {
  switch (state.kind) {
    case "not_open":
      return <p>Registration opens {formatDateTime(state.opensAt ?? null)}.</p>;
    case "closed":
      return <p>Registration closed on {formatDateTime(state.closesAt ?? null)}.</p>;
    case "no_period":
      return <p>Registration dates haven&apos;t been set for this event.</p>;
    // AC10: offered, not joined - joining and responding to the waiting list
    // is its own story (Join and Respond to Waiting List). No dead button
    // (UI_DESIGN: hide a control rather than disable it).
    case "full":
      return (
        <>
          <p>This event is full. You can join the waiting list instead.</p>
          <p className="mt-1 text-ink-3">Joining the waiting list isn&apos;t available yet.</p>
        </>
      );
    default:
      return <p>Registration is not enabled for this event.</p>;
  }
}

export function RegisterPanel({ eventId, eventTitle, state, myRegistration, onRegistered }: Props) {
  const [dietary, setDietary] = useState("");
  const [accessibility, setAccessibility] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await authedFetch("/api/registrations", {
        method: "POST",
        body: JSON.stringify({
          eventId,
          ...(dietary.trim() ? { dietaryRequirements: dietary.trim() } : {}),
          ...(accessibility.trim() ? { accessibilityRequirements: accessibility.trim() } : {}),
        }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "Could not register for this event.");
        return;
      }
      setRegistered(true);
      setWithdrawn(false);
      onRegistered();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const holding = myRegistration && HOLDS_A_PLACE.includes(myRegistration.status) ? myRegistration : null;

  return (
    <Card>
      <CardHeader title="Your registration" />
      <CardBody>
        <div className="flex flex-col gap-4">
          {registered && <Alert variant="success">You&apos;re registered for this event.</Alert>}
          {withdrawn && <Alert variant="success">You have withdrawn from this event.</Alert>}
          {error && <Alert variant="error">{error}</Alert>}

          {holding ? (
            <div className="flex flex-wrap items-center gap-3 text-sm text-ink">
              <StatusBadge status={holding.status} />
              <span>
                {holding.status === "waitlisted"
                  ? "You're on the waiting list."
                  : `You registered on ${formatDate(holding.registeredAt)}.`}
              </span>
              {/* SPM-52: Withdraw, for a registration holding a seat. */}
              {canWithdraw(holding.status) && (
                <Button variant="secondary" size="sm" onClick={() => setConfirmWithdraw(true)}>
                  Withdraw
                </Button>
              )}
            </div>
          ) : state.kind === "open" ? (
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
              <div>
                <Button type="submit" loading={saving} loadingText="Registering…">
                  Register
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
      <WithdrawRegistrationDialog
        target={confirmWithdraw && holding ? { id: holding.id, eventTitle } : null}
        onCancel={() => setConfirmWithdraw(false)}
        onWithdrawn={() => {
          setConfirmWithdraw(false);
          setRegistered(false);
          setWithdrawn(true);
          onRegistered();
        }}
      />
    </Card>
  );
}
