import { describe, it, expect } from "vitest";
import { readServerError, validate, validateField } from "../formErrors";
import { z } from "zod";
import { registerSchema } from "../validation";

// Traces to SPM-7: "validation and error states are considered".

describe("validate", () => {
  it("[SPM-7][AC5] returns nothing for a valid value", () => {
    expect(
      validate(registerSchema, {
        name: "Jordan",
        email: "jordan@example.com",
        password: "password123",
        role: "organiser",
      })
    ).toEqual({});
  });

  it("[SPM-7][AC5] keys errors by field name so they can be shown under the right input", () => {
    const errors = validate(registerSchema, {
      name: "",
      email: "not-an-email",
      password: "short",
      role: "organiser",
    });

    expect(Object.keys(errors).sort()).toEqual(["email", "name", "password"]);
  });

  it("[SPM-7][AC5] keeps one message per field", () => {
    const errors = validate(registerSchema, {
      name: "Jordan",
      email: "nope",
      password: "password123",
      role: "organiser",
    });
    expect(typeof errors.email).toBe("string");
  });
});

describe("validate - where each message goes", () => {
  it("[SPM-7][AC5] files an error that belongs to no field under _form", () => {
    const schema = z.object({ a: z.string(), b: z.string() }).refine((v) => v.a === v.b, "The two must match");
    expect(validate(schema, { a: "x", b: "y" })).toEqual({ _form: "The two must match" });
  });

  it("[SPM-7][AC5] keeps the first of two messages for one field", () => {
    const schema = z.string().min(5, "Too short").regex(/^[0-9]+$/, "Digits only");
    expect(validate(schema, "ab")).toEqual({ _form: "Too short" });
  });
});

describe("validateField", () => {
  it("[SPM-7][AC5] reports only the field that was asked about", () => {
    const value = { name: "", email: "nope", password: "short", role: "organiser" };
    // On blur the user is told about the field they just left, not the three
    // they have not reached yet.
    expect(validateField(registerSchema, value, "email")).toBeTypeOf("string");
    expect(validateField(registerSchema, { ...value, email: "a@b.com" }, "email")).toBeUndefined();
  });
});

describe("readServerError", () => {
  it("[SPM-7][AC5] maps Zod fieldErrors back onto their fields", () => {
    const result = readServerError({
      error: "Validation failed",
      details: {
        formErrors: [],
        fieldErrors: { endsAt: ["endsAt must be after startsAt"] },
      },
    });

    expect(result.fieldErrors).toEqual({ endsAt: "endsAt must be after startsAt" });
  });

  it("[SPM-7][AC5] ignores a field listed with no messages", () => {
    const result = readServerError({ details: { fieldErrors: { endsAt: [], title: undefined } } });
    expect(result.fieldErrors).toEqual({});
  });

  it("[SPM-7][AC5] drops the generic banner when the errors belong to specific fields", () => {
    // "Validation failed" adds nothing above a message already sitting under
    // the offending input.
    const result = readServerError({
      error: "Validation failed",
      details: { fieldErrors: { email: ["Invalid email"] } },
    });

    expect(result.formError).toBeNull();
  });

  it("[SPM-7][AC5] keeps the message when nothing is attributable to a field", () => {
    const result = readServerError({ error: "A user with this email already exists" });
    expect(result.formError).toBe("A user with this email already exists");
    expect(result.fieldErrors).toEqual({});
  });

  it("[SPM-7][AC5] prefers a form-level Zod error over the generic one", () => {
    const result = readServerError({
      error: "Validation failed",
      details: { formErrors: ["At least one change must be proposed"] },
    });
    expect(result.formError).toBe("At least one change must be proposed");
  });

  it("[SPM-7][AC5] falls back when the body carries no message at all", () => {
    expect(readServerError({}).formError).toBe("Something went wrong");
    expect(readServerError({}, "Could not save").formError).toBe("Could not save");
  });
});
