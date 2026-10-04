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
import { navFor, roleLabel, type NavItem } from "@/lib/roles";
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
  updatedAt: string;
  // Absent for an Attendee (internal planning information).
  coordinatorId?: string | null;
}

/// Which events a role's list is about, beyond their status:
///   mine       - the coordinator's own events (SPM-30: an event assigned to
///                a colleague, or to nobody yet, is not theirs to review)
///   unassigned - no coordinator yet (the Ops Manager's queue)
type Scope = "mine" | "unassigned";

/// One list on the dashboard: a heading, the statuses it gathers, and what to
/// say when it is empty.
interface Section {
  heading: string;
  statuses: string[];
  blurb: string;
  empty?: { title: string; description: string };
  /// Where "View all" goes when the list is cut short. Defaults to the role's
  /// events list.
  all?: NavItem;
}

/// A dashboard is an overview, not the list itself (decided 2026-10-02): a
/// role with several sections sees the few most recently changed events in
/// each - so one that has just been approved, or has just entered planning, is
/// at the top - and a link to the full list.
const OVERVIEW_LIMIT = 5;

/// What "needs attention" means for each role. Kept as data so the dashboard
/// does not become a chain of role conditionals.
const ATTENTION_BY_ROLE: Record<string, Section & { scope?: Scope; more?: Section[]; overview?: boolean }> = {
  // One list per status (decided 2026-10-02), so an organiser can tell at a
  // glance where each request has got to - SPM-54 AC4: "can view that their
  // event has entered planning".
  organiser: {
    overview: true,
    heading: "Drafts",
    statuses: ["draft"],
    blurb: "Requests you have started but not submitted yet.",
    empty: { title: "No drafts", description: "A request you save without submitting appears here." },
    more: [
      {
        heading: "Under review",
        statuses: ["under_review"],
        blurb: "Requests a coordinator is reviewing.",
        empty: { title: "Nothing under review", description: "Requests appear here once a coordinator is assigned." },
      },
      {
        heading: "Approved",
        statuses: ["approved"],
        blurb: "Approved requests waiting for planning to begin.",
        empty: { title: "Nothing waiting to be planned", description: "Requests appear here once they are approved." },
      },
      {
        heading: "Planning",
        statuses: ["planning"],
        blurb: "Events your coordinator is now planning.",
        empty: { title: "Nothing in planning", description: "Events appear here once your coordinator begins planning." },
      },
    ],
  },
  // The coordinator's own events, by where each has got to. "Awaiting your
  // review" is the Under review list - the name it has always had here. A
  // Submitted event has no coordinator yet, so it is nobody's to list.
  coordinator: {
    overview: true,
    heading: "Awaiting your review",
    statuses: ["under_review"],
    blurb: "Requests assigned to you that are under review.",
    empty: { title: "Nothing to review", description: "Requests appear here once they are assigned to you." },
    all: { href: "/queue", label: "Review Queue" },
    scope: "mine",
    more: [
      {
        heading: "Approved",
        statuses: ["approved"],
        blurb: "Your approved events waiting for planning to begin.",
        empty: { title: "Nothing waiting to be planned", description: "Events appear here once you approve them." },
      },
      {
        heading: "Planning",
        statuses: ["planning"],
        blurb: "Your events being planned and not yet confirmed.",
        empty: { title: "Nothing in planning", description: "Events appear here once you begin planning them." },
      },
    ],
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
  const sections = [config, ...(config.more ?? [])];
  const eventsFor = (section: Section) => {
    const matching =
      events?.filter((event) => {
        if (!section.statuses.includes(event.status)) return false;
        if (config.scope === "mine") return event.coordinatorId === user?.id;
        if (config.scope === "unassigned") return !event.coordinatorId;
        return true;
      }) ?? null;
    if (!matching || !config.overview) return { shown: matching, total: matching?.length ?? 0 };
    // Most recently changed first; ISO timestamps sort as text.
    const recent = [...matching].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { shown: recent.slice(0, OVERVIEW_LIMIT), total: matching.length };
  };
  const eventsList = user ? navFor(user.role).find((item) => item.href === "/events") : undefined;
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
          {sections.map((section, index) => {
            const { shown, total } = eventsFor(section);
            const all = section.all ?? eventsList;
            return (
              <div key={section.heading} className={index > 0 ? "mt-8" : undefined}>
                <h2 className="font-display text-lg font-semibold text-ink">{section.heading}</h2>
                <p className="mb-3 mt-0.5 text-sm text-ink-3">{section.blurb}</p>

                <DataState
                  data={shown}
                  error={error}
                  onRetry={load}
                  empty={
                    section.empty ?? {
                      title: "Nothing needs your attention",
                      description: "New items appear here as events move through planning.",
                    }
                  }
                >
                  {(rows) => <EventCards events={rows} />}
                </DataState>

                {shown && total > shown.length && (
                  <p className="mt-3 text-sm text-ink-3">
                    Showing the {shown.length} most recently updated of {total}.
                    {all && (
                      <>
                        {" "}
                        <Link href={all.href} className="font-medium text-brand-700 hover:underline">
                          View all in {all.label}
                        </Link>
                      </>
                    )}
                  </p>
                )}
              </div>
            );
          })}
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

/// One card per event, linking to its hub (or to the editor for a draft).
function EventCards({ events }: { events: EventSummary[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {events.map((event) => (
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
  );
}
