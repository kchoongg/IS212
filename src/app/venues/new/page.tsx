"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, PageHeader } from "@/components/ui";
import { VenueForm } from "@/components/VenueForm";
import { can } from "@/lib/permissions";
import { authedFetch } from "@/lib/session";
import { focusFirstError, readServerError, type FieldErrors } from "@/lib/formErrors";
import {
  INITIAL_VENUE,
  validateVenueForm,
  venuePayload,
  type Facility,
  type VenueFormValues,
} from "@/lib/venueForm";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";

// S-19 "Add venue". Venue Staff only - POST /api/venues requires venue:manage
// (briefing §3), and the fields come from src/components/VenueForm.tsx so this
// screen and the editor cannot drift apart.
//
// One submit, unlike the events form: a venue has no draft state. Either the
// room exists in the catalogue or it does not.

export default function NewVenuePage() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const { user, state } = useCurrentUser();

  const [values, setValues] = useState<VenueFormValues>(INITIAL_VENUE);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [facilities, setFacilities] = useState<Facility[] | null>(null);

  const loadFacilities = useCallback(async () => {
    try {
      const res = await authedFetch("/api/facilities");
      if (!res.ok) return;
      setFacilities(await res.json());
    } catch {
      // The rest of the form still works; the pickers stay in their loading
      // state rather than blocking the whole screen.
    }
  }, []);

  useEffect(() => {
    if (state === "anonymous") {
      router.push(loginUrlFor("/venues/new"));
      return;
    }
    if (state === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadFacilities();
    }
  }, [state, loadFacilities, router]);

  function clearError(field: string) {
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function save() {
    setFormError(null);

    const clientErrors = validateVenueForm(values);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      focusFirstError(formRef.current, clientErrors);
      return;
    }

    setPending(true);
    try {
      const res = await authedFetch("/api/venues", {
        method: "POST",
        body: JSON.stringify(venuePayload(values)),
      });

      const body = await res.json();
      if (!res.ok) {
        const { formError: message, fieldErrors } = readServerError(body, "Could not add this venue");
        setErrors(fieldErrors);
        setFormError(message);
        focusFirstError(formRef.current, fieldErrors);
        return;
      }

      router.push("/venues");
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
      focusFirstError(formRef.current, {});
    } finally {
      setPending(false);
    }
  }

  // The nav never offers this route to a role without venue:manage, but a typed
  // URL should say why rather than showing a form whose Save will 403.
  if (state === "authenticated" && !can(user?.role ?? "", "venue:manage")) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="Add venue" breadcrumbs={[{ label: "Venues", href: "/venues" }, { label: "Add venue" }]} />
        <Alert variant="error" title="Only Venue Staff can add a venue">
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

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Add venue"
        subtitle="Add a room to the catalogue so coordinators can check it and book it."
        breadcrumbs={[{ label: "Venues", href: "/venues" }, { label: "Add venue" }]}
      />

      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="flex flex-col gap-6"
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
        />

        <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t border-line bg-surface-2 px-4 py-3 sm:mx-0 sm:rounded-md sm:px-4">
          <Button type="submit" loading={pending} loadingText="Adding…">
            Add venue
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.push("/venues")}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
