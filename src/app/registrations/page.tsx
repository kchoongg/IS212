"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DataState, PageHeader, StatusBadge, Table, type Column } from "@/components/ui";
import { RequirePermission } from "@/components/RequirePermission";
import { eventReference, formatDateTimeRange } from "@/lib/format";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";

// S-27 My Registrations (SPM-51 AC6): the attendee's registrations and each
// one's status, newest first (GET /api/registrations). Withdrawing is a
// separate story (#20), so there is no Withdraw here yet.

interface RegistrationRow {
  id: string;
  status: string;
  registeredAt: string;
  event: { sequenceNumber: number; title: string | null; startsAt: string | null; endsAt: string | null };
}

function MyRegistrations() {
  const router = useRouter();
  const { state } = useCurrentUser();
  const [rows, setRows] = useState<RegistrationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authedFetch("/api/registrations");
      if (res.status === 401) {
        router.push(loginUrlFor("/registrations"));
        return;
      }
      if (!res.ok) throw new Error("Could not load your registrations.");
      setRows(await res.json());
    } catch (err) {
      setRows(null);
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [router]);

  useEffect(() => {
    if (state === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [state, load]);

  const columns: Column<RegistrationRow>[] = [
    {
      key: "event",
      header: "Event",
      hideLabelOnMobile: true,
      render: (row) => <span className="font-medium">{row.event.title || "Untitled event"}</span>,
    },
    { key: "when", header: "When", render: (row) => formatDateTimeRange(row.event.startsAt, row.event.endsAt) },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <div>
      <PageHeader title="My Registrations" subtitle="The events you have registered for, and their status." />
      <DataState
        data={rows}
        error={error}
        onRetry={load}
        empty={{
          title: "You haven't registered for any events yet.",
          description: "Events you register for from Browse Events appear here.",
        }}
      >
        {(list) => (
          <Table
            columns={columns}
            rows={list}
            rowKey={(row) => row.id}
            onRowClick={(row) => router.push(`/events/${eventReference(row.event.sequenceNumber)}`)}
            caption="Your registrations"
          />
        )}
      </DataState>
    </div>
  );
}

export default function RegistrationsPage() {
  return (
    <RequirePermission
      action="registration:create"
      title="My Registrations"
      reason="Registrations belong to an Attendee account."
    >
      <MyRegistrations />
    </RequirePermission>
  );
}
