"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DataState, PageHeader, StatusBadge, Table, type Column } from "@/components/ui";
import { RequirePermission } from "@/components/RequirePermission";
import { eventReference, formatDateTime, formatDateTimeRange, orEmpty } from "@/lib/format";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import type { RegistrationState } from "@/lib/registrationEligibility";

// S-26 Browse Events (SPM-51 AC1): the Confirmed events an Attendee can
// register for, each with whether registration is open now. GET /api/events
// already narrows the list to what an attendee may see (eventListWhere) and
// works out each event's state (registrationState()).

/// A state as it arrives over JSON: its dates are strings.
type StateJson = { kind: RegistrationState["kind"]; opensAt?: string; closesAt?: string };

interface BrowseRow {
  id: string;
  sequenceNumber: number;
  title: string | null;
  startsAt: string | null;
  endsAt: string | null;
  organisation?: { name: string } | null;
  registrationState: StateJson;
}

function RegistrationBadge({ state }: { state: StateJson }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <StatusBadge status={`registration_${state.kind}`} />
      {state.kind === "not_open" && state.opensAt && (
        <span className="text-xs text-ink-3">Opens {formatDateTime(state.opensAt)}</span>
      )}
    </span>
  );
}

const time = (value: string | null) => (value ? new Date(value).getTime() : Number.POSITIVE_INFINITY);

function BrowseEvents() {
  const router = useRouter();
  const { state } = useCurrentUser();
  const [events, setEvents] = useState<BrowseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authedFetch("/api/events");
      if (res.status === 401) {
        router.push(loginUrlFor("/browse"));
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
    if (state === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [state, load]);

  // An attendee holding a place can still see an event whose registration was
  // turned off (SPM-64, #10) - that belongs in My Registrations, not here.
  const rows = useMemo(
    () =>
      events
        ?.filter((e) => e.registrationState.kind !== "disabled")
        .sort((a, b) => time(a.startsAt) - time(b.startsAt)) ?? null,
    [events]
  );

  const columns: Column<BrowseRow>[] = [
    {
      key: "title",
      header: "Event",
      hideLabelOnMobile: true,
      render: (row) => <span className="font-medium">{row.title || "Untitled event"}</span>,
    },
    { key: "when", header: "When", render: (row) => formatDateTimeRange(row.startsAt, row.endsAt) },
    { key: "company", header: "Company", render: (row) => orEmpty(row.organisation?.name) },
    { key: "registration", header: "Registration", render: (row) => <RegistrationBadge state={row.registrationState} /> },
  ];

  return (
    <div>
      <PageHeader title="Browse Events" subtitle="Confirmed events you can register for." />
      <DataState
        data={rows}
        error={error}
        onRetry={load}
        empty={{
          title: "No events are open for registration right now.",
          description: "Confirmed events that take registrations appear here.",
        }}
      >
        {(list) => (
          <Table
            columns={columns}
            rows={list}
            rowKey={(row) => row.id}
            onRowClick={(row) => router.push(`/events/${eventReference(row.sequenceNumber)}`)}
            caption="Events open for registration"
          />
        )}
      </DataState>
    </div>
  );
}

export default function BrowsePage() {
  return (
    <RequirePermission
      action="registration:create"
      title="Browse Events"
      reason="Browsing and registering for events is what an Attendee account is for."
    >
      <BrowseEvents />
    </RequirePermission>
  );
}
