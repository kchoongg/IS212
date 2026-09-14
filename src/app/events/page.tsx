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
import { formatDateTimeRange, orEmpty } from "@/lib/format";
import { statusLabel } from "@/lib/statuses";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";

// S-07. Drafts stay visibly separate from submitted requests: the customer's
// complaint is not knowing whether something has actually been sent
// (briefing §2, "unsure whether an event has been approved or confirmed").

interface EventRow {
  id: string;
  title: string | null;
  status: string;
  category: string | null;
  startsAt: string | null;
  endsAt: string | null;
  expectedAttendance: number | null;
}

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  ...["draft", "submitted", "under_review", "approved", "planning", "confirmed", "completed", "rejected", "cancelled"].map(
    (status) => ({ value: status, label: statusLabel(status) })
  ),
];

export default function EventsPage() {
  const router = useRouter();
  const { user, state } = useCurrentUser();
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");

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

  useEffect(() => {
    if (state === "anonymous") {
      router.push(loginUrlFor("/events"));
      return;
    }
    if (state === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [state, load, router]);

  const isOrganiser = user?.role === "organiser";

  const { drafts, submitted } = useMemo(() => {
    const filtered =
      events?.filter((event) => statusFilter === "all" || event.status === statusFilter) ?? null;
    return {
      drafts: filtered?.filter((event) => event.status === "draft") ?? null,
      submitted: filtered?.filter((event) => event.status !== "draft") ?? null,
    };
  }, [events, statusFilter]);

  const columns: Column<EventRow>[] = [
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

      <div className="mb-5 max-w-xs">
        <label htmlFor="status-filter" className="mb-1.5 block text-sm font-medium text-ink">
          Filter by status
        </label>
        <Select
          id="status-filter"
          options={STATUS_FILTER_OPTIONS}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        />
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
            onRowClick={(row) => router.push(`/events/${row.id}/edit`)}
            caption="Draft event requests"
          />
        </section>
      )}

      <section>
        {isOrganiser && (
          <h2 className="mb-3 font-display text-lg font-semibold text-ink">Submitted</h2>
        )}
        <DataState
          data={isOrganiser ? submitted : events}
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
              onRowClick={(row) => router.push(`/events/${row.id}`)}
              caption="Events"
            />
          )}
        </DataState>
      </section>
    </div>
  );
}
