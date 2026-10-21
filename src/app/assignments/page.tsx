"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  DataState,
  PageHeader,
  Select,
  StatusBadge,
  Table,
  Tabs,
  type Column,
} from "@/components/ui";
import { RequirePermission } from "@/components/RequirePermission";
import { AssignCoordinator, type AssignResult, type CoordinatorOption } from "@/components/AssignCoordinator";
import { authedFetch } from "@/lib/session";
import { loginUrlFor } from "@/lib/useCurrentUser";
import { eventReference, formatDateTimeRange, orEmpty } from "@/lib/format";
import { statusLabel } from "@/lib/statuses";
import {
  ACTIVE_EVENT_STATUSES,
  LEAD_ONLY_REASON,
  filterActiveEvents,
  type ActiveEventFilters,
  type CoordinatorWorkload,
} from "@/lib/coordinatorAssignments";

// S-28 Coordinator Assignment (SPM-30), design/mockups/AssignmentQueue.dc.html,
// and the Event Coordinator Lead's oversight (SPM-84).
//
// Three views, as tabs so each is a URL:
//   Awaiting assignment - submitted events with no coordinator (SPM-30 AC1, AC2).
//                         Assigning one moves it to Under review, which is
//                         why it drops off this list.
//   Active events       - SPM-84 (AC5-AC9): every active event, with its
//                         coordinator or "Not yet assigned", filterable by
//                         coordinator and status (kept in the address), with
//                         Assign / Reassign on each row. Replaced SPM-30's
//                         "Assigned" tab; its old address still opens here.
//   Coordinators        - SPM-84 (AC4, AC10): each coordinator with their
//                         number of active events, zero included.
//
// Who gets an event is still the Lead's own SOP, outside the system
// (clarification #93), and there is no cap on concurrent events (#92): the
// counts inform the choice, they don't make it.

interface AssignmentEvent {
  id: string;
  sequenceNumber: number;
  title: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  submittedAt: string | null;
  organisation: { name: string } | null;
  coordinator: CoordinatorOption | null;
}

interface AssignmentsData {
  awaiting: AssignmentEvent[];
  active: AssignmentEvent[];
  coordinators: CoordinatorOption[];
  workload: CoordinatorWorkload[];
}

type View = "awaiting" | "active" | "coordinators";

/// The tab in the address. SPM-30's "?view=assigned" is now Active events.
function viewFrom(param: string | null): View {
  if (param === "coordinators") return "coordinators";
  if (param === "active" || param === "assigned") return "active";
  return "awaiting";
}

/// The Active events filters in the address; one left out is any.
function filtersFrom(params: { get(name: string): string | null }): ActiveEventFilters {
  return { coordinator: params.get("coordinator") ?? "all", status: params.get("status") ?? "all" };
}

/// "/assignments?view=active&coordinator=c1&status=planning", leaving out a
/// filter that is set to any.
function activeHref(filters: ActiveEventFilters): string {
  const query = new URLSearchParams({ view: "active" });
  if (filters.coordinator !== "all") query.set("coordinator", filters.coordinator);
  if (filters.status !== "all") query.set("status", filters.status);
  return `/assignments?${query.toString()}`;
}

const STATUS_OPTIONS = [
  { value: "all", label: "Any status" },
  ...ACTIVE_EVENT_STATUSES.map((status) => ({ value: status, label: statusLabel(status) })),
];

const SUBTITLES: Record<View, string> = {
  awaiting: "Submitted events with no coordinator. Assigning one moves the event to Under review.",
  active: "Every active event and its coordinator. Reassign one when responsibilities or availability change.",
  coordinators: "Every Event Coordinator and the number of active events assigned to them.",
};

/// "Today", "1 day", "4 days" - how long a request has sat unassigned.
function waitingFor(submittedAt: string | null): string {
  if (!submittedAt) return orEmpty(null);
  const days = Math.floor((Date.now() - new Date(submittedAt).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  return `${days} day${days === 1 ? "" : "s"}`;
}

export default function AssignmentsPage() {
  return (
    <RequirePermission
      action="event:assign_coordinator"
      title="Assignments"
      reason={LEAD_ONLY_REASON}
    >
      {/* useSearchParams needs a Suspense boundary above it. */}
      <Suspense fallback={null}>
        <AssignmentsScreen />
      </Suspense>
    </RequirePermission>
  );
}

function AssignmentsScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = viewFrom(searchParams.get("view"));
  // SPM-84 (AC7): the Active events filters live in the address, so a reload
  // or a shared link keeps them. They are read again whenever the address
  // changes while the page stays open - a coordinator's name on the
  // Coordinators tab, or the Active events tab itself - and written back on
  // each change.
  const query = searchParams.toString();
  const [filters, setFilters] = useState<ActiveEventFilters>(() => filtersFrom(searchParams));
  const [filtersQuery, setFiltersQuery] = useState(query);
  if (filtersQuery !== query) {
    setFiltersQuery(query);
    setFilters(filtersFrom(searchParams));
  }

  const [data, setData] = useState<AssignmentsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authedFetch("/api/assignments");
      if (res.status === 401) {
        router.push(loginUrlFor("/assignments"));
        return;
      }
      if (!res.ok) throw new Error("Could not load assignments.");
      setData(await res.json());
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function handleAssigned(event: AssignmentEvent, result: AssignResult) {
    const title = event.title || "Untitled event";
    setNotice(
      result.previousCoordinator
        ? `"${title}" has been reassigned from ${result.previousCoordinator.fullName} to ${result.coordinator.fullName}.`
        : `${result.coordinator.fullName} is now the coordinator for "${title}". It has moved to ${statusLabel(result.status)}.`
    );
    void load();
  }

  const coordinators = data?.coordinators ?? [];

  // Everyone who holds an active event or could be given one, A to Z.
  const coordinatorOptions = useMemo(() => {
    const people = new Map<string, string>();
    for (const c of data?.workload ?? []) people.set(c.id, c.fullName);
    for (const c of data?.coordinators ?? []) people.set(c.id, c.fullName);
    return [
      { value: "all", label: "Any coordinator" },
      { value: "unassigned", label: "Not yet assigned" },
      ...[...people]
        .map(([value, label]) => ({ value, label }))
        .sort((x, y) => x.label.localeCompare(y.label)),
    ];
  }, [data]);
  // A filter value the lists do not offer (a stale link) reads as any.
  const applied: ActiveEventFilters = {
    coordinator: coordinatorOptions.some((o) => o.value === filters.coordinator) ? filters.coordinator : "all",
    status: STATUS_OPTIONS.some((o) => o.value === filters.status) ? filters.status : "all",
  };
  const filtering = applied.coordinator !== "all" || applied.status !== "all";

  function changeFilter(change: Partial<ActiveEventFilters>) {
    const next = { ...applied, ...change };
    setFilters(next);
    router.replace(activeHref(next));
  }

  const eventColumn: Column<AssignmentEvent> = {
    key: "event",
    header: "Event",
    hideLabelOnMobile: true,
    render: (row) => (
      <div className="flex flex-col">
        <Link
          href={`/events/${eventReference(row.sequenceNumber)}`}
          className="font-medium text-ink underline-offset-2 hover:underline"
        >
          {row.title || "Untitled event"}
        </Link>
        <span className="text-xs text-ink-3">{eventReference(row.sequenceNumber)}</span>
      </div>
    ),
  };
  const clientColumn: Column<AssignmentEvent> = {
    key: "client",
    header: "Client",
    render: (row) => orEmpty(row.organisation?.name),
  };
  const whenColumn: Column<AssignmentEvent> = {
    key: "when",
    header: "When",
    render: (row) => formatDateTimeRange(row.startsAt, row.endsAt),
  };

  const awaitingColumns: Column<AssignmentEvent>[] = [
    eventColumn,
    clientColumn,
    whenColumn,
    { key: "waiting", header: "Waiting", render: (row) => waitingFor(row.submittedAt) },
    {
      key: "assign",
      header: "Assign to",
      className: "w-[22rem]",
      render: (row) => (
        <AssignCoordinator
          eventRef={eventReference(row.sequenceNumber)}
          eventTitle={row.title || "Untitled event"}
          current={null}
          coordinators={coordinators}
          onAssigned={(result) => handleAssigned(row, result)}
        />
      ),
    },
  ];

  const activeColumns: Column<AssignmentEvent>[] = [
    eventColumn,
    clientColumn,
    whenColumn,
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    { key: "coordinator", header: "Coordinator", render: (row) => row.coordinator?.fullName ?? "Not yet assigned" },
    {
      key: "reassign",
      header: "Reassign to",
      className: "w-[22rem]",
      render: (row) => (
        <AssignCoordinator
          eventRef={eventReference(row.sequenceNumber)}
          eventTitle={row.title || "Untitled event"}
          current={row.coordinator}
          coordinators={coordinators}
          label={row.coordinator ? "Reassign to" : "Assign to"}
          onAssigned={(result) => handleAssigned(row, result)}
        />
      ),
    },
  ];

  const workloadColumns: Column<CoordinatorWorkload>[] = [
    {
      key: "coordinator",
      header: "Coordinator",
      hideLabelOnMobile: true,
      render: (row) => (
        <div className="flex flex-col">
          <Link
            href={activeHref({ coordinator: row.id, status: "all" })}
            className="font-medium text-ink underline-offset-2 hover:underline"
          >
            {row.fullName}
          </Link>
          {!row.isActive && <span className="text-xs text-ink-3">Account inactive</span>}
        </div>
      ),
    },
    { key: "count", header: "Active events", render: (row) => row.activeEvents },
  ];

  return (
    <div>
      <PageHeader title="Assignments" subtitle={SUBTITLES[view]} />

      <Tabs
        items={[
          {
            key: "awaiting",
            label: "Awaiting assignment",
            href: "/assignments",
            badge: data?.awaiting.length,
          },
          { key: "active", label: "Active events", href: "/assignments?view=active" },
          { key: "coordinators", label: "Coordinators", href: "/assignments?view=coordinators" },
        ]}
        activeKey={view}
        className="mb-6"
      />

      {notice && (
        <Alert variant="success" className="mb-4">
          {notice}
        </Alert>
      )}

      {view === "active" && (
        <div className="mb-5 flex flex-wrap gap-4">
          <div className="w-full max-w-xs">
            <label htmlFor="assignments-coordinator" className="mb-1.5 block text-sm font-medium text-ink">
              Coordinator
            </label>
            <Select
              id="assignments-coordinator"
              options={coordinatorOptions}
              value={applied.coordinator}
              onChange={(e) => changeFilter({ coordinator: e.target.value })}
            />
          </div>
          <div className="w-full max-w-xs">
            <label htmlFor="assignments-status" className="mb-1.5 block text-sm font-medium text-ink">
              Status
            </label>
            <Select
              id="assignments-status"
              options={STATUS_OPTIONS}
              value={applied.status}
              onChange={(e) => changeFilter({ status: e.target.value })}
            />
          </div>
        </div>
      )}

      {view === "coordinators" ? (
        <DataState
          data={data ? data.workload : null}
          error={error}
          onRetry={load}
          empty={{
            title: "No Event Coordinators",
            description: "Coordinators appear here once their accounts exist.",
          }}
        >
          {(list) => (
            <Table
              columns={workloadColumns}
              rows={list}
              rowKey={(row) => row.id}
              caption="Coordinators and their active events"
            />
          )}
        </DataState>
      ) : (
        <DataState
          data={data ? (view === "awaiting" ? data.awaiting : filterActiveEvents(data.active, applied)) : null}
          error={error}
          onRetry={load}
          empty={
            view === "awaiting"
              ? {
                  title: "No events are awaiting assignment",
                  description: "Every submitted event has a coordinator. New requests appear here as organisers submit them.",
                }
              : filtering
                ? { title: "No active events match these filters", description: "Try another coordinator or status." }
                : { title: "No active events", description: "Events appear here once an organiser submits a request." }
          }
        >
          {(list) => (
            <Table
              columns={view === "awaiting" ? awaitingColumns : activeColumns}
              rows={list}
              rowKey={(row) => row.id}
              caption={view === "awaiting" ? "Events awaiting assignment" : "Active events"}
            />
          )}
        </DataState>
      )}
    </div>
  );
}
