// Client-side form error handling. See UI_DESIGN.md §7.1.
//
// The rules themselves live in src/lib/validation.ts and are enforced by the
// server on every request. What happens here is presentation only: run the
// same Zod schema for immediate feedback, and map the server's rejection back
// onto the fields that caused it instead of showing one opaque banner.

import type { ZodType } from "zod";

export type FieldErrors = Record<string, string>;

/// Validates a value against a schema and returns errors keyed by field name.
/// An empty object means valid.
export function validate<T>(schema: ZodType<T>, value: unknown): FieldErrors {
  const result = schema.safeParse(value);
  if (result.success) return {};

  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_form";
    // Keep the first message per field: a stack of messages under one input
    // is harder to act on than the first thing to fix.
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

/// Validates one field by running the whole schema and keeping only that
/// field's error. Used on blur, so the user is told about the field they just
/// left and nothing else.
export function validateField<T>(schema: ZodType<T>, value: unknown, field: string): string | undefined {
  return validate(schema, value)[field];
}

interface ServerErrorBody {
  error?: string;
  /// Zod's flatten() output, as the API routes return it.
  details?: {
    formErrors?: string[];
    fieldErrors?: Record<string, string[] | undefined>;
  };
}

export interface ServerError {
  /// Shown as an Alert at the top of the form.
  formError: string | null;
  /// Merged into the form's field error state.
  fieldErrors: FieldErrors;
}

/// Turns an API error response into something the form can render.
export function readServerError(body: ServerErrorBody, fallback = "Something went wrong"): ServerError {
  const fieldErrors: FieldErrors = {};

  for (const [field, messages] of Object.entries(body.details?.fieldErrors ?? {})) {
    if (messages?.length) fieldErrors[field] = messages[0];
  }

  const formErrors = body.details?.formErrors ?? [];

  // If the failure was attributable to specific fields, those messages are the
  // useful ones and "Validation failed" adds nothing above them.
  const attributed = Object.keys(fieldErrors).length > 0;

  return {
    formError: formErrors[0] ?? (attributed ? null : body.error ?? fallback),
    fieldErrors,
  };
}

/// Focuses the first field with an error and scrolls it into view, so a long
/// form does not fail silently below the fold (§7.1).
export function focusFirstError(form: HTMLFormElement | null, errors: FieldErrors) {
  if (!form) return;
  const firstKey = Object.keys(errors)[0];
  if (!firstKey) return;

  const control = form.querySelector<HTMLElement>(`[name="${firstKey}"]`) ?? form.querySelector<HTMLElement>("[aria-invalid='true']");
  control?.scrollIntoView({ block: "center", behavior: "smooth" });
  control?.focus({ preventScroll: true });
}
