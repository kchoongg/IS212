"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, DataState, PageHeader, StatusBadge, Table, type Column } from "@/components/ui";
import { RequirePermission } from "@/components/RequirePermission";
import { WithdrawRegistrationDialog, type WithdrawTarget } from "@/components/WithdrawRegistrationDialog";
import { eventReference, formatDateTimeRange } from "@/lib/format";
import { canWithdraw } from "@/lib/registrationEligibility";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";

// S-27 My Registrations (SPM-51 AC6): the attendee's registrations and each
// one's status, newest first (GET /api/registrations).
// SPM-52: Withdraw on each registration that holds a seat.

interface RegistrationRow {
  id: string;
  status: string;
  registeredAt: string;
  event: { sequenceNumber: number; title: string | null; status: string; startsAt: string | null; endsAt: string | null };
}

function MyRegistrations() {
  const router = useRouter();
  const { state } = useCurrentUser();
  const [rows, setRows] = useState<RegistrationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<WithdrawTarget | null>(null);
  const [withdrawn, setWithdrawn] = useState<string | null>(null);

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
    {
      key: "actions",
      header: "Actions",
      hideLabelOnMobile: true,
      className: "text-right",
      render: (row) =>
        canWithdraw(row.status, row.event, new Date()) ? (
          <Button
            variant="secondary"
            size="sm"
            // The row opens the event; this button must not do that too. The
            // mobile card listens for Enter/Space, so the keypress is stopped too.
            onClick={(e) => {
              e.stopPropagation();
              setWithdrawn(null);
              setWithdrawing({ id: row.id, eventTitle: row.event.title });
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            Withdraw
          </Button>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader title="My Registrations" subtitle="The events you have registered for, and their status." />
      {withdrawn && (
        <Alert variant="success" className="mb-4">
          You have withdrawn from {withdrawn}.
        </Alert>
      )}
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
      <WithdrawRegistrationDialog
        target={withdrawing}
        onCancel={() => setWithdrawing(null)}
        onWithdrawn={() => {
          setWithdrawn(withdrawing?.eventTitle || "the event");
          setWithdrawing(null);
          void load();
        }}
      />
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
