"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  DataState,
  PageHeader,
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

// S-28 Coordinator Assignment (SPM-30), design/mockups/AssignmentQueue.dc.html.
//
// Two views, as tabs so each is a URL:
//   Awaiting assignment - submitted events with no coordinator (AC1, AC2).
//                         Assigning one moves it to Under review, which is
//                         why it drops off this list.
//   Assigned            - live events that have one, for reassignment (AC6).
//
// The mockup's "Coordinator workload" panel is deliberately left out: who
// gets an event is the Ops Manager's own SOP, outside the system
// (clarification #93), and there is no cap on concurrent events (#92).

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
  assigned: AssignmentEvent[];
  coordinators: CoordinatorOption[];
}

type View = "awaiting" | "assigned";

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
      reason="Assigning coordinators is the Event Operations Manager's role."
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
  const view: View = searchParams.get("view") === "assigned" ? "assigned" : "awaiting";

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

  const assignedColumns: Column<AssignmentEvent>[] = [
    eventColumn,
    clientColumn,
    whenColumn,
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    { key: "coordinator", header: "Coordinator", render: (row) => orEmpty(row.coordinator?.fullName) },
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
          label="Reassign to"
          onAssigned={(result) => handleAssigned(row, result)}
        />
      ),
    },
  ];

  const rows = data ? (view === "awaiting" ? data.awaiting : data.assigned) : null;

  return (
    <div>
      <PageHeader
        title="Assignments"
        subtitle={
          view === "awaiting"
            ? "Submitted events with no coordinator. Assigning one moves the event to Under review."
            : "Events that already have a coordinator. Reassign one when responsibilities or availability change."
        }
      />

      <Tabs
        items={[
          {
            key: "awaiting",
            label: "Awaiting assignment",
            href: "/assignments",
            badge: data?.awaiting.length,
          },
          { key: "assigned", label: "Assigned", href: "/assignments?view=assigned" },
        ]}
        activeKey={view}
        className="mb-6"
      />

      {notice && (
        <Alert variant="success" className="mb-4">
          {notice}
        </Alert>
      )}

      <DataState
        data={rows}
        error={error}
        onRetry={load}
        empty={
          view === "awaiting"
            ? {
                title: "No events are awaiting assignment",
                description: "Every submitted event has a coordinator. New requests appear here as organisers submit them.",
              }
            : {
                title: "No assigned events",
                description: "Events appear here once a coordinator has been assigned to them.",
              }
        }
      >
        {(list) => (
          <Table
            columns={view === "awaiting" ? awaitingColumns : assignedColumns}
            rows={list}
            rowKey={(row) => row.id}
            caption={view === "awaiting" ? "Events awaiting assignment" : "Assigned events"}
          />
        )}
      </DataState>
    </div>
  );
}
