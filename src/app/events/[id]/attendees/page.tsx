"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Alert, Button, ConfirmDialog, EmptyState, PageHeader, SkeletonRows, StatusBadge, Table, Tabs } from "@/components/ui";
import type { Column } from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { eventTabItemsFor } from "@/lib/eventTabs";
import { eventCrumbs } from "@/lib/breadcrumbs";
import { eventTabsFor } from "@/lib/roles";
import { eventReference, formatDateTime } from "@/lib/format";
import type { RegistrationCounts } from "@/lib/registrationEligibility";
import { offerStands } from "@/lib/waitingList";

// S-11, the Attendees tab (SPM-65, View Registration List): who has registered
// for this event, for the Organiser responsible for it and the Coordinator
// assigned to it. Who may see it is decided by GET /api/events/[id]/registrations
// (canViewRegistrationList()). The tab bar on the other event screens offers
// the tab only where that rule allows it (eventTabs.ts); typing the address
// anyway gets "Not authorised" here.
//
// AC6: the list is read again every 15 seconds while the tab is open and in
// view, and as soon as it comes back into view, so registrations, withdrawals
// and waiting-list changes appear without a reload.
//
// SPM-66: each waiting attendee's position, and any place under offer to
// them. The assigned coordinator can give a place under offer to a chosen
// waiting attendee instead (AC9, "Offer place").

/// How often the list is read again while in view (AC6, decided 2026-10-15).
const REFRESH_MS = 15_000;

interface Registration {
  id: string;
  status: string;
  registeredAt: string;
  withdrawnAt: string | null;
  attendee: { name: string; email: string; phone: string | null };
  /// AC4: who added it on the Organiser's behalf; null if self-registered.
  addedBy: { name: string } | null;
  /// SPM-66 (AC3): position on the waiting list, counting from 1.
  waitingListPosition?: number | null;
  /// SPM-66: when the place under offer to them was offered, and until when.
  offeredAt?: string | null;
  offerExpiresAt?: string | null;
}

interface RegistrationList {
  event: { sequenceNumber: number; title: string | null; status: string };
  registrationEnabled: boolean;
  registrationCapacity: number | null;
  counts: RegistrationCounts;
  registrations: Registration[];
  /// SPM-66 (AC9): the assigned coordinator, while places can be offered.
  canOfferPlaces?: boolean;
}

/// SPM-66: "Number 2 in the queue", or the place under offer and until when.
function waitingLine(r: Registration): string {
  if (offerStands(r.offerExpiresAt, new Date())) return `Place offered until ${formatDateTime(r.offerExpiresAt as string)}`;
  return `Number ${r.waitingListPosition ?? "-"} in the queue`;
}

/// AC5: active registrations against the capacity, and the waiting list.
function placesLine(counts: RegistrationCounts, capacity: number | null): string {
  const taken =
    capacity == null ? `${counts.taken} registered (no capacity limit)` : `${counts.taken} of ${capacity} places taken`;
  return `${taken} · ${counts.waitlisted} on the waiting list`;
}

const COLUMNS: Column<Registration>[] = [
  {
    key: "attendee",
    header: "Attendee",
    hideLabelOnMobile: true,
    render: (r) => (
      <div>
        <p className="font-medium text-ink">{r.attendee.name}</p>
        {r.addedBy && <p className="mt-0.5 text-xs text-ink-3">Added by {r.addedBy.name}</p>}
      </div>
    ),
  },
  {
    key: "contact",
    header: "Contact",
    render: (r) => (
      <div className="text-sm">
        <p>{r.attendee.email}</p>
        {r.attendee.phone && <p className="text-ink-3">{r.attendee.phone}</p>}
      </div>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (r) => (
      <div className="flex flex-col items-start gap-1">
        <StatusBadge status={r.status} />
        {r.status === "waitlisted" && <span className="text-xs text-ink-3">{waitingLine(r)}</span>}
      </div>
    ),
  },
  {
    key: "registeredAt",
    header: "Registered",
    render: (r) => (
      <div className="text-sm">
        <p>{formatDateTime(r.registeredAt)}</p>
        {r.withdrawnAt && <p className="text-ink-3">Withdrew {formatDateTime(r.withdrawnAt)}</p>}
      </div>
    ),
  },
];

export default function EventAttendeesPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const { user, state } = useCurrentUser();

  const [data, setData] = useState<RegistrationList | null>(null);
  const [error, setError] = useState<string | null>(null);
  /// The server refused (AC8, AC9): no point asking again every 15 seconds.
  const [refused, setRefused] = useState(false);
  /// Whether a list is on screen, so a failed background refresh leaves it
  /// there instead of replacing it with an error.
  const shown = useRef(false);
  // SPM-66 (AC9): the waiting attendee the coordinator is giving a place to.
  const [offering, setOffering] = useState<Registration | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Registrations are personal: the same roles that are shown the tab
  // (roles.ts). The server checks the event relationship.
  const canView = user ? eventTabsFor(user.role).includes("attendees") : false;
  const loginUrl = loginUrlFor(`/events/${eventId}/attendees`);

  const load = useCallback(async () => {
    try {
      const res = await authedFetch(`/api/events/${eventId}/registrations`);
      if (res.status === 401) {
        router.push(loginUrl);
        return;
      }
      if (res.status === 404) {
        setError("This event doesn't exist, or you don't have access to it.");
        return;
      }
      if (res.status === 403) {
        setRefused(true);
        return;
      }
      if (!res.ok) throw new Error("Could not load this event's registrations.");
      setData(await res.json());
      setError(null);
      shown.current = true;
    } catch (err) {
      if (shown.current) return;
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [eventId, router, loginUrl]);

  useEffect(() => {
    if (state === "anonymous") {
      router.push(loginUrl);
      return;
    }
    if (state !== "authenticated" || !canView || refused) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // AC6: again every 15 seconds while in view, and on coming back into view.
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [state, canView, refused, load, router, loginUrl]);

  /// SPM-66 (AC9): give the place under offer to the chosen attendee.
  async function offerPlace() {
    // v8 ignore next -- the dialog only opens with an attendee chosen
    if (!offering) return;
    setSaving(true);
    setActionError(null);
    setNotice(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}/waiting-list/offers`, {
        method: "POST",
        body: JSON.stringify({ registrationId: offering.id }),
      });
      if (!res.ok) {
        setActionError((await res.json().catch(() => ({}))).error ?? "Could not offer the place.");
        return;
      }
      setNotice(`${offering.attendee.name} has been offered the place.`);
      void load();
    } catch {
      setActionError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
      setOffering(null);
    }
  }

  if (state === "loading" || (state === "authenticated" && !user)) {
    return null;
  }

  // SPM-66 (AC9): the offer that "Offer place" moves - the one made last, as
  // the server picks it.
  const holder =
    data?.registrations
      .filter((r) => r.status === "waitlisted" && offerStands(r.offerExpiresAt, new Date()))
      .sort((a, b) => String(b.offeredAt).localeCompare(String(a.offeredAt)))[0] ?? null;
  const columns: Column<Registration>[] =
    data?.canOfferPlaces && holder
      ? [
          ...COLUMNS,
          {
            key: "offer",
            header: "Offer",
            hideLabelOnMobile: true,
            className: "text-right",
            render: (r) =>
              r.status === "waitlisted" && !offerStands(r.offerExpiresAt, new Date()) ? (
                <Button variant="secondary" size="sm" onClick={() => setOffering(r)}>
                  Offer place
                </Button>
              ) : null,
          },
        ]
      : COLUMNS;

  const crumbs = eventCrumbs(user?.role, eventId, data?.event.title, { label: "Attendees" });

  if (!user || !canView || refused) {
    return (
      <div className="max-w-5xl">
        <PageHeader title="Event" breadcrumbs={crumbs} />
        <Alert variant="error" title="Not authorised">
          You can only view the registrations for events you are responsible for.
        </Alert>
      </div>
    );
  }

  // Past the refusal above, so Attendees is offered - it is this screen.
  const tabs = eventTabItemsFor(user.role, eventId, true);

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={data?.event.title || (error ? "Event" : "Loading…")}
        subtitle="Who has registered for this event."
        meta={
          data && (
            <>
              <span className="text-xs text-ink-3">{eventReference(data.event.sequenceNumber)}</span>
              <StatusBadge status={data.event.status} />
            </>
          )
        }
        breadcrumbs={crumbs}
      />

      {tabs.length > 0 && <Tabs items={tabs} activeKey="attendees" className="mb-6" />}

      {error ? (
        <Alert
          variant="error"
          title="Could not load this"
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      ) : !data ? (
        <SkeletonRows rows={3} />
      ) : (
        <div className="flex flex-col gap-5">
          {notice && <Alert variant="success">{notice}</Alert>}
          {actionError && <Alert variant="error">{actionError}</Alert>}
          {/* AC7: said in words, never an empty list. Registrations made
              before it was turned off are still listed below. */}
          {!data.registrationEnabled && (
            <Alert variant="info" title="Registration is not enabled for this event">
              Attendees can&apos;t register until the coordinator turns registration on.
            </Alert>
          )}

          {(data.registrationEnabled || data.registrations.length > 0) && (
            <p className="text-sm font-medium text-ink" aria-label="Places">
              {placesLine(data.counts, data.registrationCapacity)}
            </p>
          )}

          {data.registrations.length > 0 ? (
            <Table
              columns={columns}
              rows={data.registrations}
              rowKey={(r) => r.id}
              caption="Registrations for this event"
            />
          ) : (
            data.registrationEnabled && (
              <EmptyState title="No one has registered yet" description="Registrations appear here as they come in." />
            )
          )}
        </div>
      )}

      <ConfirmDialog
        open={offering !== null}
        title={`Offer the place to ${offering?.attendee.name ?? "this attendee"}?`}
        confirmLabel="Offer place"
        cancelLabel="Not now"
        loading={saving}
        onConfirm={() => void offerPlace()}
        onCancel={() => setOffering(null)}
      >
        The place now offered to {holder?.attendee.name ?? "another attendee"} moves to{" "}
        {offering?.attendee.name ?? "this attendee"}, who has 3 days to accept it.{" "}
        {holder?.attendee.name ?? "They"} stays on the waiting list in the same position, and both are notified.
      </ConfirmDialog>
    </div>
  );
}
