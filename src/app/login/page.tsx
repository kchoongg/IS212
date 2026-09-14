"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { saveToken } from "@/lib/session";
import { Alert, Button, Field, Input } from "@/components/ui";

// S-01. See UI_DESIGN.md §6.3.

export default function LoginPage() {
  return (
    // useSearchParams needs a Suspense boundary above it.
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Where the user was heading before the session expired (§7.4).
  const next = searchParams.get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Login failed");
      saveToken(body.token);
      // Back to where they were, or to the role dashboard.
      router.push(next || "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Log in</h1>
      <p className="mt-1.5 text-sm text-ink-2">Sign in to plan and manage your events.</p>

      {next && (
        <Alert variant="info" className="mt-4">
          Your session expired. Log in to continue where you left off.
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        {/* Not attributable to one field: the server deliberately does not say
            which of email or password was wrong. */}
        {error && <Alert variant="error">{error}</Alert>}

        <Field label="Email" required>
          <Input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>

        <Field label="Password" required>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>

        <Button type="submit" loading={loading} loadingText="Logging in…">
          Log in
        </Button>
      </form>

      <p className="mt-6 text-sm text-ink-3">
        No account?{" "}
        <Link href="/register" className="font-medium text-ink hover:underline">
          Register
        </Link>
      </p>
    </div>
  );
}
