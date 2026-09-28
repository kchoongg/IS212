"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, DataState, PageHeader, StatusBadge, Table, type Column } from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { eventReference, formatDateTimeRange, orEmpty } from "@/lib/format";

// S-25 (queue). "As Technical Support Staff, I want to check whether
// sufficient suitable equipment is available for an event" (SPM-48). This is
// the list of events with equipment requested; opening one shows whether each
// item can be supported (./[id]/page.tsx).

interface RequestRow {
  sequenceNumber: number;
  title: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  requestCount: number;
}

const QUEUE_PATH = "/equipment/requests";

export default function EquipmentRequestsPage() {
  const router = useRouter();
  const { user, state } = useCurrentUser();
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authedFetch("/api/equipment/requests");
      if (res.status === 401) {
        router.push(loginUrlFor(QUEUE_PATH));
        return;
      }
      if (res.status === 403) {
        setError("Only Technical Support Staff can view equipment requests.");
        return;
      }
      if (!res.ok) throw new Error("Could not load equipment requests.");
      setRows(await res.json());
    } catch (err) {
      setRows(null);
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [router]);

  useEffect(() => {
    if (state === "anonymous") {
      router.push(loginUrlFor(QUEUE_PATH));
      return;
    }
    if (state === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [state, load, router]);

  const columns: Column<RequestRow>[] = [
    {
      key: "reference",
      header: "Event",
      hideLabelOnMobile: true,
      render: (row) => (
        <span>
          <span className="font-medium text-ink">{orEmpty(row.title)}</span>{" "}
          <span className="text-ink-3">{eventReference(row.sequenceNumber)}</span>
        </span>
      ),
    },
    {
      key: "when",
      header: "When",
      render: (row) => formatDateTimeRange(row.startsAt, row.endsAt),
    },
    {
      key: "items",
      header: "Equipment lines",
      render: (row) => row.requestCount,
    },
    {
      key: "status",
      header: "Event status",
      render: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Equipment requests"
        subtitle="Events with equipment requested. Open one to see whether each item is available for its dates."
      />

      {user && user.role !== "tech_support" && (
        <Alert variant="info" className="mb-5">
          This queue is for Technical Support Staff.
        </Alert>
      )}

      <DataState
        data={rows}
        error={error}
        onRetry={load}
        empty={{
          title: "No equipment requests yet",
          description: "Events appear here once equipment has been requested for them.",
        }}
      >
        {(data) => (
          <Table
            columns={columns}
            rows={data}
            rowKey={(row) => String(row.sequenceNumber)}
            onRowClick={(row) => router.push(`${QUEUE_PATH}/${eventReference(row.sequenceNumber)}`)}
            caption="Events with equipment requests"
          />
        )}
      </DataState>
    </div>
  );
}
