"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Alert, Button, Card, PageHeader, SkeletonRows, StatusBadge, Tabs } from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { eventTabItemsFor } from "@/lib/eventTabs";
import { eventTabsFor } from "@/lib/roles";
import { eventReference, formatDateTime } from "@/lib/format";
import { humanise, statusLabel } from "@/lib/statuses";

// S-18, the Readiness tab (SPM-33, Track Outstanding Arrangements): everything
// that has to be in place before this event can be confirmed, each item
// complete, outstanding or marked as not required.
//
// The page decides nothing. The list, what counts as outstanding, how many
// items block confirmation and whether this user may change anything all come
// from GET /api/events/[id]/arrangements, which builds them with the same rule
// Confirm uses (src/lib/eventConfirmation.ts). An arrangement of a kind this
// page has never heard of is listed in a section of its own, and gets a button
// only if the server says it can be marked.
//
// Layout (cleaned up 2026-10-12, for a first-time user): one section per kind
// of arrangement, and every row the same three columns - where it stands
// (Complete / Outstanding / Not required) always first, then what it is, then
// the action. The arrangement's OWN status (a booking's "Pending", a request's
// "Reserved") is written out with what it is the status of, so it is never
// read as the answer to "is this done?". A key under the summary says what the
// three states mean.
//
// Confirming stays on the Overview (SPM-34).

interface Arrangement {
  kind: string;
  id: string | null;
  name: string;
  session: { id: string; label: string | null } | null;
  status: string | null;
  state: string;
  missing: string;
  waivable: boolean;
  notRequiredBy: string | null;
  notRequiredAt: string | null;
  /// False for the Operational Safety Check until SPM-88: shown, not counted.
  blocksConfirmation: boolean;
  note: string;
}

interface Readiness {
  event: { sequenceNumber: number; title: string | null; status: string };
  /// The assigned coordinator, while the event is in Planning.
  canManage: boolean;
  /// How many arrangements are required and not complete.
  blocking: number;
  arrangements: Arrangement[];
}

/// A list key that holds for rows with no id of their own ("No venue booked",
/// registration), which are unique per kind and session.
const keyOf = (a: Arrangement) => `${a.kind}:${a.id ?? a.name}:${a.session?.id ?? ""}`;

/// The rule's reasons are written to follow "cannot be confirmed yet: ...", so
/// they start in lower case. On its own line a reason is a sentence.
const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

/// The sections of the list, in the order a coordinator works through them.
/// `empty` is shown when the event has nothing of that kind.
const SECTIONS: { kind: string; title: string; empty?: string }[] = [
  { kind: "venue", title: "Venue bookings" },
  { kind: "equipment", title: "Equipment", empty: "No equipment has been recorded for this event." },
  { kind: "registration", title: "Registration", empty: "Registration is not enabled for this event." },
  { kind: "safety_check", title: "Safety check" },
];

/// What an arrangement's own status is the status of.
const OWN_STATUS: Record<string, string> = {
  venue: "Booking status",
  equipment: "Request status",
  safety_check: "Safety check status",
};

/// The key under the summary: what the three states mean.
const STATES: [state: string, meaning: string][] = [
  ["complete", "In place."],
  ["outstanding", "Still to be done."],
  ["not_required", "Marked as not needed for this event."],
];

/// The known sections, then one per kind the page has not been taught.
function sectionsFor(arrangements: Arrangement[]) {
  const unknown = [...new Set(arrangements.map((a) => a.kind))].filter(
    (kind) => !SECTIONS.some((section) => section.kind === kind)
  );
  return [...SECTIONS, ...unknown.map((kind) => ({ kind, title: humanise(kind), empty: undefined }))].map(
    (section) => ({ ...section, rows: arrangements.filter((a) => a.kind === section.kind) })
  );
}

export default function EventReadinessPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const { user, state } = useCurrentUser();

  const [data, setData] = useState<Readiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /// The row being saved, so only its button waits.
  const [saving, setSaving] = useState<string | null>(null);

  // Readiness is internal planning information: the same list of roles that
  // decides who is shown the tab (roles.ts). The server checks again.
  const canView = user ? eventTabsFor(user.role).includes("readiness") : false;
  const loginUrl = loginUrlFor(`/events/${eventId}/readiness`);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}/arrangements`);
      if (res.status === 401) {
        router.push(loginUrl);
        return;
      }
      if (res.status === 404) {
        setError("This event doesn't exist, or you don't have access to it.");
        return;
      }
      if (!res.ok) throw new Error("Could not load this event's arrangements.");
      setData(await res.json());
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [eventId, router, loginUrl]);

  useEffect(() => {
    if (state === "anonymous") {
      router.push(loginUrl);
      return;
    }
    if (state === "authenticated" && canView) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [state, canView, load, router, loginUrl]);

  /// Marks one arrangement as not required, or as required again. One click,
  /// no dialog: it is undone the same way, and the server records who and when.
  async function mark(arrangement: Arrangement, notRequired: boolean) {
    setSaving(keyOf(arrangement));
    setActionError(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}/arrangements`, {
        method: "PATCH",
        body: JSON.stringify(
          arrangement.id === null
            ? { kind: arrangement.kind, notRequired }
            : { kind: arrangement.kind, id: arrangement.id, notRequired }
        ),
      });
      if (res.status === 401) {
        router.push(loginUrl);
        return;
      }
      if (!res.ok) {
        setActionError((await res.json()).error ?? "Could not update this arrangement.");
        return;
      }
      // The answer is the list as it now stands.
      setData(await res.json());
    } catch {
      setActionError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(null);
    }
  }

  if (state === "loading" || (state === "authenticated" && !user)) {
    return null;
  }

  if (!canView) {
    return (
      <Alert variant="error" title="Not authorised">
        You don&apos;t have access to this event.
      </Alert>
    );
  }

  const tabs = user ? eventTabItemsFor(user.role, eventId) : [];

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={data?.event.title || (error ? "Event" : "Loading…")}
        subtitle={
          data?.event.status === "confirmed"
            ? "What this event was confirmed with."
            : "What has to be in place before this event can be confirmed."
        }
        meta={
          data && (
            <>
              <span className="text-xs text-ink-3">{eventReference(data.event.sequenceNumber)}</span>
              <StatusBadge status={data.event.status} />
            </>
          )
        }
        breadcrumbs={[
          { label: "Events", href: "/events" },
          { label: data?.event.title || "Event", href: `/events/${eventId}` },
          { label: "Readiness" },
        ]}
      />

      {tabs.length > 0 && <Tabs items={tabs} activeKey="readiness" className="mb-6" />}

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
          {/* AC11: which arrangements are preventing confirmation. A confirmed
              event is past that question, so it is told so instead. */}
          {data.event.status === "confirmed" ? (
            <Alert variant="success" title="This event is confirmed">
              These are the arrangements it was confirmed with. Nothing can be marked as not required
              while it is confirmed.
            </Alert>
          ) : data.blocking > 0 ? (
            <Alert
              variant="warning"
              title={
                data.blocking === 1
                  ? "1 arrangement still blocks confirmation"
                  : `${data.blocking} arrangements still block confirmation`
              }
            >
              Each one is marked Outstanding below, with what is missing. An arrangement this event
              does not need can be marked as not required.
            </Alert>
          ) : (
            <Alert variant="success" title="Nothing is blocking confirmation">
              Every arrangement is complete or marked as not required.
            </Alert>
          )}

          {/* What the three states mean, for someone seeing them for the first time. */}
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-2">
            {STATES.map(([state, meaning]) => (
              <div key={state} className="flex items-center gap-2">
                <dt>
                  <StatusBadge status={state} />
                </dt>
                <dd>{meaning}</dd>
              </div>
            ))}
          </dl>

          {actionError && <Alert variant="error">{actionError}</Alert>}

          <section aria-label="Arrangements" className="flex flex-col gap-5">
            {sectionsFor(data.arrangements)
              .filter((section) => section.rows.length > 0 || section.empty)
              .map((section) => (
                <Card key={section.kind}>
                  <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">
                    {section.title}
                  </h2>
                  {section.rows.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-ink-3">{section.empty}</p>
                  ) : (
                    <ul aria-label={section.title} className="divide-y divide-line">
                      {section.rows.map((arrangement) => {
                        const key = keyOf(arrangement);
                        const marked = arrangement.state === "not_required";
                        const ownStatus = arrangement.status
                          ? `${OWN_STATUS[arrangement.kind] ?? "Status"}: ${statusLabel(arrangement.status)}`
                          : null;
                        const session = arrangement.session
                          ? `Session: ${arrangement.session.label ?? "unnamed session"}`
                          : null;
                        const action =
                          data.canManage && arrangement.waivable ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={saving === key}
                              onClick={() => void mark(arrangement, true)}
                            >
                              Mark as not required
                            </Button>
                          ) : data.canManage && marked ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={saving === key}
                              onClick={() => void mark(arrangement, false)}
                            >
                              Mark as required
                            </Button>
                          ) : null;
                        return (
                          <li
                            key={key}
                            className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto]"
                          >
                            {/* Always first, always in the same place: where it stands. */}
                            <div className="pt-0.5">
                              <StatusBadge status={arrangement.state} />
                            </div>

                            <div className="min-w-0">
                              <p className="font-medium text-ink">{arrangement.name}</p>
                              {(session || ownStatus) && (
                                <p className="mt-0.5 text-sm text-ink-3">
                                  {[session, ownStatus].filter(Boolean).join(" · ")}
                                </p>
                              )}
                              {arrangement.missing && (
                                <p className="mt-1 text-sm text-ink-2">{sentence(arrangement.missing)}</p>
                              )}
                              {arrangement.note && <p className="mt-1 text-sm text-ink-3">{arrangement.note}</p>}
                              {/* The Operational Safety Check, until SPM-88 makes
                                  Confirm wait for it: why it is not in the count. */}
                              {arrangement.state === "outstanding" && !arrangement.blocksConfirmation && (
                                <p className="mt-1 text-sm text-ink-3">Confirm event does not wait for it yet.</p>
                              )}
                              {/* Briefing 8f: who decided, and when. */}
                              {marked && arrangement.notRequiredAt && (
                                <p className="mt-1 text-sm text-ink-3">
                                  Marked as not required
                                  {arrangement.notRequiredBy && <> by {arrangement.notRequiredBy}</>} on{" "}
                                  {formatDateTime(arrangement.notRequiredAt)}
                                </p>
                              )}
                            </div>

                            {action && <div className="col-start-2 sm:col-start-auto sm:justify-self-end">{action}</div>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              ))}
          </section>
        </div>
      )}
    </div>
  );
}
