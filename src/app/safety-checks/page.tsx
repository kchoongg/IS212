"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataState, PageHeader, Table, type Column } from "@/components/ui";
import { RequirePermission } from "@/components/RequirePermission";
import { authedFetch } from "@/lib/session";
import { loginUrlFor } from "@/lib/useCurrentUser";
import { eventReference, formatDate, formatDateTimeRange, orEmpty } from "@/lib/format";

// SPM-85, the Safety Officer's work list (Week 7 change #6): the events a
// coordinator has submitted for an Operational Safety Check (SPM-86). Each
// opens the event, whose Overview and Equipment tabs hold what a safety
// review reads. SPM-87 adds the Safety Officer's decision.

interface AwaitingCheck {
  id: string;
  sequenceNumber: number;
  title: string | null;
  startsAt: string | null;
  endsAt: string | null;
  expectedAttendance: number | null;
  organisation: { name: string } | null;
  submittedAt: string | null;
  submittedBy: string | null;
}

/// "10 Oct 2026 by Daniel Tan" - when the coordinator submitted it, and who.
function submitted(row: AwaitingCheck): string {
  if (!row.submittedAt) return orEmpty(null);
  const on = formatDate(row.submittedAt);
  return row.submittedBy ? `${on} by ${row.submittedBy}` : on;
}

export default function SafetyChecksPage() {
  return (
    <RequirePermission
      action="event:safety_check"
      title="Safety Checks"
      reason="The Operational Safety Check is the Safety Officer's role. You can still see the events you are involved in from your Dashboard."
    >
      <SafetyChecksScreen />
    </RequirePermission>
  );
}

function SafetyChecksScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<AwaitingCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authedFetch("/api/safety-checks");
      if (res.status === 401) {
        router.push(loginUrlFor("/safety-checks"));
        return;
      }
      if (!res.ok) throw new Error("Could not load the safety checks.");
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

  const columns: Column<AwaitingCheck>[] = [
    {
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
    },
    { key: "client", header: "Client", render: (row) => orEmpty(row.organisation?.name) },
    { key: "when", header: "When", render: (row) => formatDateTimeRange(row.startsAt, row.endsAt) },
    { key: "attendance", header: "Expected attendance", render: (row) => orEmpty(row.expectedAttendance) },
    { key: "submitted", header: "Submitted", render: submitted },
  ];

  return (
    <div>
      <PageHeader
        title="Safety Checks"
        subtitle="Events submitted for an Operational Safety Check. Open one to review its attendance, sessions, venues, accessibility needs and equipment."
      />

      <DataState
        data={rows}
        error={error}
        onRetry={load}
        empty={{
          title: "Nothing to check",
          description: "Events appear here once a coordinator submits them for a safety check.",
        }}
      >
        {(list) => (
          <Table columns={columns} rows={list} rowKey={(row) => row.id} caption="Events awaiting a safety check" />
        )}
      </DataState>
    </div>
  );
}
