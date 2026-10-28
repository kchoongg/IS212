"use client";

import { useRef, useState } from "react";
import { Alert, Button, Card, CardBody, CardHeader, Field, Input } from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { focusFirstError, readServerError, validate, type FieldErrors } from "@/lib/formErrors";
import { addAttendeeSchema } from "@/lib/validation";

// Manually Add Attendee (SPM-57): the assigned coordinator's form on the
// Attendees tab. It adds an existing Attendee account by its email address,
// with the attendee's dietary and accessibility requirements (AC1) - the same
// two fields as the attendee's own Register form (RegisterPanel.tsx). Whether
// the account exists, the attendee already holds a place, or the room is full
// (AC3) is the server's answer, shown on the field or above the form.

interface Props {
  /// The event's reference, as in the page address.
  eventId: string;
  /// Called with the server's confirmation once the attendee is added.
  onAdded: (message: string) => void;
  onCancel: () => void;
}

export function AddAttendeeForm({ eventId, onAdded, onCancel }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState("");
  const [dietary, setDietary] = useState("");
  const [accessibility, setAccessibility] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = { email, dietaryRequirements: dietary, accessibilityRequirements: accessibility };
    const local = validate(addAttendeeSchema, body);
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length > 0) {
      focusFirstError(formRef.current, local);
      return;
    }

    setSaving(true);
    try {
      const res = await authedFetch(`/api/events/${eventId}/registrations`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const answer = await res.json().catch(() => ({}));
      if (!res.ok) {
        const server = readServerError(answer, "Could not add this attendee.");
        setErrors(server.fieldErrors);
        setFormError(server.formError);
        focusFirstError(formRef.current, server.fieldErrors);
        return;
      }
      onAdded(answer.message);
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Add an attendee" />
      <CardBody>
        <form ref={formRef} noValidate aria-label="Add an attendee" onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          {formError && <Alert variant="error">{formError}</Alert>}
          <Field label="Attendee email" hint="The email address of their Attendee account." error={errors.email}>
            <Input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
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
          <div className="flex gap-3">
            <Button type="submit" loading={saving} loadingText="Adding…">
              Add attendee
            </Button>
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
