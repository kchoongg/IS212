"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
  /// Why it is flagged for review, in words. "" when it is not flagged.
  flagReason?: string;
  waivable: boolean;
  /// Marked as not required by the Coordinator (registration that is off is
  /// not required too, but nobody can mark it as required again here).
  waived: boolean;
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
  /// SPM-68: the assigned coordinator, whatever the event's status - a flagged
  /// arrangement is theirs to keep or replace on the Flagged Arrangements page.
  canReviewFlags?: boolean;
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

/// SPM-68: what POST /api/flagged-arrangements calls each kind, and what its
/// Keep button says.
const KEEP: Record<string, { kind: string; button: string; what: string }> = {
  venue: { kind: "venue_booking", button: "Keep booking", what: "booking" },
  equipment: { kind: "equipment_request", button: "Keep reservation", what: "reservation" },
};

/// SPM-68: how a flagged arrangement stands against the event now - the same
/// result the Flagged Arrangements page shows, from the same request.
interface FlagReview {
  fits: boolean;
  unmet: string[];
}

interface FlaggedList {
  venueBookings: { id: string; suitability: { ok: boolean; unmet: string[] }; availability: { ok: boolean; unmet: string[] } }[];
  equipmentRequests: { id: string; availability: { ok: boolean; summary: string } }[];
}

/// SPM-68: which tab of the Flagged Arrangements page lists a flagged
/// arrangement of each kind. Registration setup is never flagged here - it is
/// the event's registrations that are, and they do not block confirmation.
const FLAGGED_TAB: Record<string, string> = { venue: "venue", equipment: "equipment" };

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
  /// SPM-68: each flagged arrangement's current result, by "kind:id". Empty
  /// until it has been read - and Keep is offered only on one that fits.
  const [reviews, setReviews] = useState<Record<string, FlagReview>>({});
  /// SPM-68: what was just kept.
  const [notice, setNotice] = useState<string | null>(null);

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
      const loaded: Readiness = await res.json();
      setData(loaded);

      // SPM-68: a flagged arrangement can be kept from here too, but only
      // while it still meets the event's requirements - which is worked out
      // live, by the same request the Flagged Arrangements page makes. If it
      // cannot be read, the rows keep their link to that page and no Keep.
      if (loaded.canReviewFlags && loaded.arrangements.some((a) => a.flagReason)) {
        const flagged = await authedFetch("/api/flagged-arrangements").catch(() => null);
        const next: Record<string, FlagReview> = {};
        if (flagged?.ok) {
          const list: FlaggedList = await flagged.json();
          for (const b of list.venueBookings) {
            next[`venue:${b.id}`] = {
              fits: b.suitability.ok && b.availability.ok,
              unmet: [...b.suitability.unmet, ...b.availability.unmet],
            };
          }
          for (const r of list.equipmentRequests) {
            next[`equipment:${r.id}`] = { fits: r.availability.ok, unmet: r.availability.ok ? [] : [r.availability.summary] };
          }
        }
        setReviews(next);
      }
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

  /// SPM-68: keeps a flagged booking or reservation as it is. The server
  /// clears the flag and nothing else, or says what it no longer meets.
  async function keep(arrangement: Arrangement) {
    setSaving(keyOf(arrangement));
    setActionError(null);
    setNotice(null);
    try {
      const res = await authedFetch("/api/flagged-arrangements", {
        method: "POST",
        body: JSON.stringify({ kind: KEEP[arrangement.kind].kind, id: arrangement.id }),
      });
      if (res.status === 401) {
        router.push(loginUrl);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setActionError(body?.error ?? "Could not clear the flag. Try again.");
        return;
      }
      setNotice(`${arrangement.name} was kept as it is.`);
      await load();
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

          {notice && (
            <Alert variant="success" title="Flag cleared">
              {notice}
            </Alert>
          )}
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
                        // SPM-68: a flagged arrangement is kept here or on the
                        // Flagged Arrangements page, and replaced from there -
                        // not resolved by marking it as not required. Shown to
                        // the assigned coordinator for as long as it is flagged,
                        // whether or not it has been marked as not required.
                        const flaggedTab = FLAGGED_TAB[arrangement.kind];
                        const flagged = Boolean(data.canReviewFlags && arrangement.flagReason && flaggedTab);
                        const reviewHref = flagged ? `/flagged?tab=${flaggedTab}` : null;
                        const review = flagged ? reviews[`${arrangement.kind}:${arrangement.id}`] : undefined;
                        const keepButton =
                          review?.fits ? (
                            <Button size="sm" disabled={saving === key} onClick={() => void keep(arrangement)}>
                              {KEEP[arrangement.kind].button}
                            </Button>
                          ) : null;
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
                          ) : data.canManage && arrangement.waived ? (
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
                              {review && !review.fits && (
                                <div className="mt-1 text-sm text-tone-warning-fg">
                                  {review.unmet.map((line, i) => (
                                    <p key={i}>{line}</p>
                                  ))}
                                  <p className="font-medium">
                                    This {KEEP[arrangement.kind].what} can&apos;t be kept while it doesn&apos;t meet the
                                    event&apos;s requirements.
                                  </p>
                                </div>
                              )}
                              {reviewHref && (
                                <p className="mt-1 text-sm">
                                  <Link href={reviewHref} className="font-medium text-ink underline underline-offset-2">
                                    Review in Flagged Arrangements
                                  </Link>
                                </p>
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

                            {(keepButton || action) && (
                              <div className="col-start-2 flex flex-wrap gap-2 sm:col-start-auto sm:flex-col sm:items-end sm:justify-self-end">
                                {keepButton}
                                {action}
                              </div>
                            )}
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
