import { ButtonLink } from "@/components/ui";

export default function HomePage() {
  return (
    <div>
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">ConnectSphere</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
        Plan events, book venues, and arrange equipment in one place. Log in to see the events you
        are working on.
      </p>
      <div className="mt-6 flex gap-3">
        <ButtonLink href="/login">Log in</ButtonLink>
        <ButtonLink href="/register" variant="secondary">
          Register
        </ButtonLink>
      </div>
    </div>
  );
}
