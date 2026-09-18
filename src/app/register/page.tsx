"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { SELF_REGISTERABLE_ROLES, roleLabel } from "@/lib/roles";
import { registerSchema } from "@/lib/validation";
import {
  focusFirstError,
  readServerError,
  validate,
  validateField,
  type FieldErrors,
} from "@/lib/formErrors";

// S-02. This is the reference implementation of the validation pattern in
// UI_DESIGN.md §7.1: nothing while typing, the touched field on blur,
// everything on submit, and server errors mapped back onto their fields.

// CHANGED: was every role in ROLES, which offered a stranger "Operations
// Manager" and "Event Coordinator" in a public dropdown. Staff accounts are
// not self-service. The server enforces the same list (registerSchema) — this
// only keeps the form from advertising something it will refuse.
const ROLE_OPTIONS = SELF_REGISTERABLE_ROLES.map((role) => ({
  value: role,
  label: roleLabel(role),
}));

export default function RegisterPage() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [values, setValues] = useState({
    name: "",
    email: "",
    password: "",
    role: "organiser",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function setValue(field: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    // Clear a field's error as soon as the user starts fixing it. Re-checking
    // on every keystroke would tell them the email is invalid while they are
    // still typing it.
    if (errors[field]) {
      setErrors((current) => {
        const next = { ...current };
        delete next[field];
        return next;
      });
    }
  }

  function handleBlur(field: keyof typeof values) {
    setTouched((current) => ({ ...current, [field]: true }));
    const message = validateField(registerSchema, { ...values }, field);
    setErrors((current) => ({ ...current, ...(message ? { [field]: message } : {}) }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const clientErrors = validate(registerSchema, values);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      setTouched({ name: true, email: true, password: true, role: true });
      focusFirstError(formRef.current, clientErrors);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await res.json();

      if (!res.ok) {
        const { formError: message, fieldErrors } = readServerError(body, "Registration failed");
        setErrors(fieldErrors);
        setFormError(message);
        focusFirstError(formRef.current, fieldErrors);
        return;
      }

      router.push("/login");
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const errorFor = (field: keyof typeof values) => (touched[field] ? errors[field] : undefined);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Create an account</h1>
      <p className="mt-1.5 text-sm text-ink-2">
        Your role decides what you can see and do in ConnectSphere.
      </p>

      <form ref={formRef} onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        {formError && <Alert variant="error">{formError}</Alert>}

        <Field label="Full name" required error={errorFor("name")}>
          <Input
            name="name"
            autoComplete="name"
            value={values.name}
            onChange={(e) => setValue("name", e.target.value)}
            onBlur={() => handleBlur("name")}
          />
        </Field>

        <Field label="Email" required error={errorFor("email")}>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={(e) => setValue("email", e.target.value)}
            onBlur={() => handleBlur("email")}
          />
        </Field>

        <Field
          label="Password"
          required
          hint="At least 8 characters."
          error={errorFor("password")}
        >
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            value={values.password}
            onChange={(e) => setValue("password", e.target.value)}
            onBlur={() => handleBlur("password")}
          />
        </Field>

        {/* The select shows labels and submits the database keys — a user
            should never meet the string "venue_staff" (UI_DESIGN.md §2). */}
        <Field
          label="Role"
          required
          hint="ConnectSphere staff accounts are created internally, not here."
          error={errorFor("role")}
        >
          <Select
            name="role"
            options={ROLE_OPTIONS}
            value={values.role}
            onChange={(e) => setValue("role", e.target.value)}
            onBlur={() => handleBlur("role")}
          />
        </Field>

        <Button type="submit" loading={loading} loadingText="Creating account…">
          Create account
        </Button>
      </form>

      <p className="mt-6 text-sm text-ink-3">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-ink hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
