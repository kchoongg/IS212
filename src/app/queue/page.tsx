"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataState, PageHeader, StatusBadge, Table, type Column } from "@/components/ui";
import { RequirePermission } from "@/components/RequirePermission";
import { authedFetch } from "@/lib/session";
import { loginUrlFor } from "@/lib/useCurrentUser";
import { eventReference, formatDateTimeRange, orEmpty } from "@/lib/format";

// S-12 Event Review Queue (SPM-28). The requests assigned to the signed-in
// coordinator that are still under review (AC1). Each opens the review page,
// where it is approved or rejected and so leaves this list.

interface QueueEvent {
  id: string;
  sequenceNumber: number;
  title: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  submittedAt: string | null;
  organisation: { name: string } | null;
}

/// "Today", "1 day", "4 days" - how long a request has been waiting.
function waitingFor(submittedAt: string | null): string {
  if (!submittedAt) return orEmpty(null);
  const days = Math.floor((Date.now() - new Date(submittedAt).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  return `${days} day${days === 1 ? "" : "s"}`;
}

export default function QueuePage() {
  return (
    <RequirePermission
      action="event:review"
      title="Review Queue"
      reason="Reviewing event requests is the Event Coordinator's role. You can still see events you are involved in from All Events."
    >
      <QueueScreen />
    </RequirePermission>
  );
}

function QueueScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<QueueEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authedFetch("/api/queue");
      if (res.status === 401) {
        router.push(loginUrlFor("/queue"));
        return;
      }
      if (!res.ok) throw new Error("Could not load the review queue.");
      setRows(await res.json());
    } catch (err) {
      setRows(null);
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const columns: Column<QueueEvent>[] = [
    {
      key: "event",
      header: "Event",
      hideLabelOnMobile: true,
      render: (row) => (
        <div className="flex flex-col">
          <Link
            href={`/events/${eventReference(row.sequenceNumber)}/review`}
            className="font-medium text-ink underline-offset-2 hover:underline"
          >
            {row.title || "Untitled event"}
          </Link>
          <span className="text-xs text-ink-3">{eventReference(row.sequenceNumber)}</span>
        </div>
      ),
    },
    { key: "client", header: "Client", render: (row) => orEmpty(row.organisation?.name) },
    { key: "when", header: "When", render: (row) => formatDateTimeRange(row.startsAt, row.endsAt) },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    { key: "waiting", header: "Waiting", render: (row) => waitingFor(row.submittedAt) },
  ];

  return (
    <div>
      <PageHeader
        title="Review Queue"
        subtitle="Requests assigned to you that are waiting for your review. Approve one for planning, or reject it with a reason."
      />

      <DataState
        data={rows}
        error={error}
        onRetry={load}
        empty={{
          title: "Nothing to review",
          description: "Requests appear here once the Event Coordinator Lead assigns them to you.",
        }}
      >
        {(list) => (
          <Table columns={columns} rows={list} rowKey={(row) => row.id} caption="Requests awaiting your review" />
        )}
      </DataState>
    </div>
  );
}
