"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ButtonLink,
  DataState,
  PageHeader,
  Select,
  StatusBadge,
  Table,
  type Column,
} from "@/components/ui";
import { eventReference, formatDateTimeRange, orEmpty } from "@/lib/format";
import { statusLabel } from "@/lib/statuses";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { can } from "@/lib/permissions";

// S-07. Drafts stay visibly separate from submitted requests: the customer's
// complaint is not knowing whether something has actually been sent
// (briefing §2, "unsure whether an event has been approved or confirmed").

interface EventRow {
  id: string;
  sequenceNumber: number;
  title: string | null;
  status: string;
  category: string | null;
  startsAt: string | null;
  endsAt: string | null;
  expectedAttendance: number | null;
  // Absent for an Attendee (internal planning information).
  coordinatorId?: string | null;
}

// SPM-30 AC2: the Ops Manager can filter to events with no coordinator yet,
// as well as working from the Assignments screen.
const COORDINATOR_FILTER_OPTIONS = [
  { value: "all", label: "Any coordinator" },
  { value: "unassigned", label: "Not yet assigned" },
  { value: "assigned", label: "Assigned" },
];

const ALL_STATUSES = [
  "draft", "submitted", "under_review", "approved", "planning", "safety_review", "safety_cleared", "confirmed", "completed", "rejected",
  "cancelled",
  // SPM-38: a postponed event can be filtered on too.
  "postponed",
  // SPM-59 (AC3): a withdrawn request is a status of its own, so it can be
  // filtered on like the others.
  "withdrawn",
];

export default function EventsPage() {
  const router = useRouter();
  const { user, state } = useCurrentUser();
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [coordinatorFilter, setCoordinatorFilter] = useState("all");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authedFetch("/api/events");
      if (res.status === 401) {
        router.push(loginUrlFor("/events"));
        return;
      }
      if (!res.ok) throw new Error("Could not load events.");
      setEvents(await res.json());
    } catch (err) {
      setEvents(null);
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [router]);

  const isAttendee = user?.role === "attendee";

  useEffect(() => {
    if (state === "anonymous") {
      router.push(loginUrlFor("/events"));
      return;
    }
    // An Attendee's list is Browse Events; this page's title, columns and
    // status filter are for organisers and staff. Their event page
    // (/events/<ref>) is unaffected.
    if (isAttendee) {
      router.replace("/browse");
      return;
    }
    if (state === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [state, isAttendee, load, router]);

  const isOrganiser = user?.role === "organiser";
  const mayAssign = user ? can(user.role, "event:assign_coordinator") : false;

  // Non-organiser roles never receive draft events from the API (they stay
  // private to their owning organiser - docs/PERMISSIONS.md), so offering
  // "Draft" as a filter to a coordinator or ops manager is a dead option
  // that always shows zero results.
  const statusFilterOptions = useMemo(() => {
    const statuses = isOrganiser ? ALL_STATUSES : ALL_STATUSES.filter((s) => s !== "draft");
    return [
      { value: "all", label: "All statuses" },
      ...statuses.map((status) => ({ value: status, label: statusLabel(status) })),
    ];
  }, [isOrganiser]);

  const { filtered, drafts, submitted } = useMemo(() => {
    const filtered =
      events?.filter(
        (event) =>
          (statusFilter === "all" || event.status === statusFilter) &&
          (coordinatorFilter === "all" ||
            (coordinatorFilter === "unassigned" ? !event.coordinatorId : Boolean(event.coordinatorId)))
      ) ?? null;
    return {
      filtered,
      drafts: filtered?.filter((event) => event.status === "draft") ?? null,
      submitted: filtered?.filter((event) => event.status !== "draft") ?? null,
    };
  }, [events, statusFilter, coordinatorFilter]);

  const columns: Column<EventRow>[] = [
    {
      key: "reference",
      header: "Reference",
      render: (row) => <span className="text-ink-3">{eventReference(row.sequenceNumber)}</span>,
    },
    {
      key: "title",
      header: "Event",
      hideLabelOnMobile: true,
      render: (row) => (
        <span className="font-medium">{row.title || "Untitled event"}</span>
      ),
    },
    {
      key: "when",
      header: "When",
      render: (row) => formatDateTimeRange(row.startsAt, row.endsAt),
    },
    {
      key: "attendance",
      header: "Attendance",
      render: (row) => orEmpty(row.expectedAttendance),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
  ];

  if (isAttendee) return null;

  return (
    <div>
      <PageHeader
        title={isOrganiser ? "My events" : "All events"}
        subtitle={
          isOrganiser
            ? "Drafts are only visible to you until you submit them."
            : "Every event across client organisations."
        }
        actions={
          isOrganiser ? (
            <ButtonLink href="/events/new" variant="accent">
              New event request
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="mb-5 flex flex-wrap gap-4">
        <div className="w-full max-w-xs">
          <label htmlFor="status-filter" className="mb-1.5 block text-sm font-medium text-ink">
            Filter by status
          </label>
          <Select
            id="status-filter"
            options={statusFilterOptions}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          />
        </div>
        {mayAssign && (
          <div className="w-full max-w-xs">
            <label htmlFor="coordinator-filter" className="mb-1.5 block text-sm font-medium text-ink">
              Coordinator
            </label>
            <Select
              id="coordinator-filter"
              options={COORDINATOR_FILTER_OPTIONS}
              value={coordinatorFilter}
              onChange={(e) => setCoordinatorFilter(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Drafts first and under their own heading — an unsent request is the
          thing most likely to be forgotten. */}
      {isOrganiser && drafts && drafts.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 font-display text-lg font-semibold text-ink">
            Drafts — not yet submitted ({drafts.length})
          </h2>
          <Table
            columns={columns}
            rows={drafts}
            rowKey={(row) => row.id}
            onRowClick={(row) => router.push(`/events/${eventReference(row.sequenceNumber)}/edit`)}
            caption="Draft event requests"
          />
        </section>
      )}

      <section>
        {isOrganiser && (
          <h2 className="mb-3 font-display text-lg font-semibold text-ink">Submitted</h2>
        )}
        <DataState
          data={isOrganiser ? submitted : filtered}
          error={error}
          onRetry={load}
          empty={{
            title: isOrganiser ? "No submitted requests yet" : "No events yet",
            description: isOrganiser
              ? "Requests you submit to ConnectSphere appear here with their current status."
              : "Events appear here once organisers submit them.",
            action: isOrganiser ? (
              <ButtonLink href="/events/new" variant="accent">
                Create your first request
              </ButtonLink>
            ) : undefined,
          }}
        >
          {(rows) => (
            <Table
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              onRowClick={(row) => router.push(`/events/${eventReference(row.sequenceNumber)}`)}
              caption="Events"
            />
          )}
        </DataState>
      </section>
    </div>
  );
}
