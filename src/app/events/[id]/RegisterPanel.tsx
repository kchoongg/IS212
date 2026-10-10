"use client";

import { useState } from "react";
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, StatusBadge } from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { formatDate, formatDateTime } from "@/lib/format";
import type { RegistrationState } from "@/lib/registrationEligibility";

// Register for Event (SPM-51): the attendee's "Your registration" card on the
// event page. Whether they can register is the server's rule
// (registrationState(), the same one POST /api/registrations applies); this
// card shows it - a message instead of a button whenever registering would be
// refused (UI_DESIGN §7: S-26 rows).

/// A state as it arrives over JSON: its dates are strings.
export type RegistrationStateJson = { kind: RegistrationState["kind"]; opensAt?: string; closesAt?: string };

export interface MyRegistration {
  status: string;
  registeredAt: string;
}

/// Statuses that mean the attendee already holds a place, so no Register.
const HOLDS_A_PLACE = ["registered", "attended", "waitlisted"];

interface Props {
  /// The event's id (POST /api/registrations takes the id, not the reference).
  eventId: string;
  state: RegistrationStateJson;
  myRegistration: MyRegistration | null;
  /// Called after registering, to reload the event.
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
    default:
      return <p>Registration is not enabled for this event.</p>;
  }
}

export function RegisterPanel({ eventId, state, myRegistration, onRegistered }: Props) {
  const [dietary, setDietary] = useState("");
  const [accessibility, setAccessibility] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);

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
          {error && <Alert variant="error">{error}</Alert>}

          {holding ? (
            <div className="flex flex-wrap items-center gap-3 text-sm text-ink">
              <StatusBadge status={holding.status} />
              <span>
                {holding.status === "waitlisted"
                  ? "You're on the waiting list."
                  : `You registered on ${formatDate(holding.registeredAt)}.`}
              </span>
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
    </Card>
  );
}
