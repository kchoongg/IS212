"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Alert,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  DataState,
  PageHeader,
  StatusBadge,
} from "@/components/ui";
import { eventReference, formatDateTimeRange } from "@/lib/format";
import { navFor, roleLabel } from "@/lib/roles";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";

// S-03. Every role lands here. The chrome and the components are identical
// across roles (UI_DESIGN.md §5); what changes is which events are surfaced
// and what the role is being asked to do about them.

interface EventSummary {
  id: string;
  sequenceNumber: number;
  title: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  expectedAttendance: number | null;
  // Absent for an Attendee (internal planning information).
  coordinatorId?: string | null;
}

/// Which events a role's list is about, beyond their status:
///   mine       - the coordinator's own events (SPM-30: an event assigned to
///                a colleague, or to nobody yet, is not theirs to review)
///   unassigned - no coordinator yet (the Ops Manager's queue)
type Scope = "mine" | "unassigned";

/// What "needs attention" means for each role. Kept as data so the dashboard
/// does not become a chain of role conditionals.
const ATTENTION_BY_ROLE: Record<
  string,
  { heading: string; statuses: string[]; blurb: string; scope?: Scope }
> = {
  organiser: {
    heading: "Needs your attention",
    statuses: ["draft", "under_review"],
    blurb: "Drafts you have not submitted, and requests where a coordinator has asked you something.",
  },
  coordinator: {
    heading: "Awaiting your review",
    statuses: ["submitted", "under_review", "approved", "planning"],
    blurb: "Events assigned to you that are not yet confirmed.",
    scope: "mine",
  },
  ops_manager: {
    heading: "Awaiting assignment",
    statuses: ["submitted"],
    blurb: "Submitted events with no coordinator yet.",
    scope: "unassigned",
  },
  venue_staff: {
    heading: "Upcoming events",
    statuses: ["approved", "planning", "confirmed"],
    blurb: "Events with venue arrangements in progress or confirmed.",
  },
  tech_support: {
    heading: "Upcoming events",
    statuses: ["approved", "planning", "confirmed"],
    blurb: "Events that may need equipment or on-site support.",
  },
  attendee: {
    heading: "Open for registration",
    statuses: ["confirmed"],
    blurb: "Confirmed events you can register for.",
  },
};

export default function DashboardPage() {
  const router = useRouter();
  const { user, state } = useCurrentUser();
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authedFetch("/api/events");
      if (res.status === 401) {
        router.push(loginUrlFor("/dashboard"));
        return;
      }
      if (!res.ok) throw new Error("Could not load your events.");
      setEvents(await res.json());
    } catch (err) {
      setEvents(null);
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [router]);

  useEffect(() => {
    if (state === "anonymous") {
      router.push(loginUrlFor("/dashboard"));
      return;
    }
    if (state === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [state, load, router]);

  const config = ATTENTION_BY_ROLE[user?.role ?? ""] ?? ATTENTION_BY_ROLE.organiser;
  const attention =
    events?.filter((event) => {
      if (!config.statuses.includes(event.status)) return false;
      if (config.scope === "mine") return event.coordinatorId === user?.id;
      if (config.scope === "unassigned") return !event.coordinatorId;
      return true;
    }) ?? null;
  const links = user ? navFor(user.role).filter((item) => item.href !== "/dashboard") : [];

  return (
    <div>
      <PageHeader
        title={user ? `Welcome, ${user.name}` : "Dashboard"}
        subtitle={user ? roleLabel(user.role) : undefined}
        actions={
          user?.role === "organiser" ? (
            <ButtonLink href="/events/new" variant="accent">
              New event request
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="font-display text-lg font-semibold text-ink">{config.heading}</h2>
          <p className="mb-3 mt-0.5 text-sm text-ink-3">{config.blurb}</p>

          <DataState
            data={attention}
            error={error}
            onRetry={load}
            empty={{
              title: "Nothing needs your attention",
              description: "New items appear here as events move through planning.",
            }}
          >
            {(rows) => (
              <ul className="flex flex-col gap-3">
                {rows.map((event) => (
                  <li key={event.id}>
                    <Link
                      href={
                        event.status === "draft"
                          ? `/events/${eventReference(event.sequenceNumber)}/edit`
                          : `/events/${eventReference(event.sequenceNumber)}`
                      }
                      className="block rounded-lg border border-line bg-surface p-4 shadow-card transition-colors hover:border-brand-200 hover:bg-brand-50/40"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <span className="font-medium text-ink">
                          {event.title || "Untitled event"}
                        </span>
                        <StatusBadge status={event.status} />
                      </div>
                      <p className="mt-1 text-sm text-ink-3">
                        {formatDateTimeRange(event.startsAt, event.endsAt)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </DataState>
        </section>

        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Go to" />
            <CardBody className="py-2">
              <ul className="flex flex-col">
                {links.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="-mx-2 block rounded px-2 py-2 text-sm text-ink-2 hover:bg-surface-2"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          {user && !["organiser", "attendee"].includes(user.role) && (
            <Alert variant="info" title="Internal view">
              You can see events across client organisations. External users only ever see their
              own.
            </Alert>
          )}
        </aside>
      </div>
    </div>
  );
}
