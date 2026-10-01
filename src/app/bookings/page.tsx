"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataState, PageHeader, StatusBadge, Table, type Column } from "@/components/ui";
import { RequirePermission } from "@/components/RequirePermission";
import { authedFetch } from "@/lib/session";
import { loginUrlFor } from "@/lib/useCurrentUser";
import { formatVenue } from "@/lib/format";
import { layoutLabel } from "@/lib/venueSuitability";
import { requestSlotsLabel, setupAndTurnaround, slotCellLabel } from "@/lib/venueBookingRequest";

// S-22, Booking Requests. SPM-42 AC7: the pending venue booking requests
// coordinators have submitted, for Venue Staff to review. Read-only for now -
// Approve and Reject belong to the Venue Booking Approval story.

interface Request {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  layoutName: string | null;
  requirementsNote: string | null;
  requester: { fullName: string };
  event: { reference: string; title: string | null };
  session: { label: string | null } | null;
  venue: { code: string; name: string; setupMinutes: number; teardownMinutes: number };
}

export default function BookingsPage() {
  return (
    <RequirePermission
      action="venue_booking:decide"
      title="Booking Requests"
      reason="Reviewing venue bookings is Venue Staff's role."
    >
      <BookingRequests />
    </RequirePermission>
  );
}

function BookingRequests() {
  const router = useRouter();
  const [rows, setRows] = useState<Request[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authedFetch("/api/venue-bookings");
      if (res.status === 401) {
        router.push(loginUrlFor("/bookings"));
        return;
      }
      if (!res.ok) throw new Error("Could not load booking requests.");
      setRows(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const columns: Column<Request>[] = [
    {
      key: "event",
      header: "Event",
      render: (r) => (
        <div>
          <Link href={`/events/${r.event.reference}`} className="font-medium text-ink hover:underline">
            {r.event.reference}
          </Link>
          <p className="text-ink-2">{r.event.title ?? "Untitled event"}</p>
          {r.session && <p className="text-xs text-ink-3">Session: {r.session.label ?? "Session"}</p>}
        </div>
      ),
    },
    {
      key: "venue",
      header: "Venue and slots",
      render: (r) => {
        const window = { startsAt: new Date(r.startsAt), endsAt: new Date(r.endsAt) };
        const holds = setupAndTurnaround(window, r.venue);
        return (
          <div>
            <p>{formatVenue(r.venue.name, r.venue.code)}</p>
            <p className="text-ink-2">{requestSlotsLabel(window)}</p>
            {holds.setup && <p className="text-xs text-ink-3">Setup: {slotCellLabel(holds.setup)}</p>}
            {holds.turnaround && <p className="text-xs text-ink-3">Turnaround: {slotCellLabel(holds.turnaround)}</p>}
          </div>
        );
      },
    },
    {
      key: "requirements",
      header: "Requirements",
      render: (r) => (
        <div>
          <p>Layout: {r.layoutName ? layoutLabel(r.layoutName) : "Not set"}</p>
          <p className="text-ink-2">{r.requirementsNote ?? "None given"}</p>
        </div>
      ),
    },
    { key: "requester", header: "Requested by", render: (r) => r.requester.fullName },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader title="Booking Requests" subtitle="Venue bookings requested by coordinators, waiting for review." />
      <DataState data={rows} error={error} onRetry={() => void load()} empty={{ title: "No pending booking requests" }}>
        {(data) => <Table columns={columns} rows={data} rowKey={(r) => r.id} />}
      </DataState>
    </div>
  );
}
