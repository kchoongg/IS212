"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Alert, Button, Card, PageHeader, SkeletonRows, StatusBadge, Tabs } from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { eventTabItemsFor } from "@/lib/eventTabs";
import { eventTabsFor } from "@/lib/roles";
import { eventReference, formatDateTime } from "@/lib/format";
import { humanise } from "@/lib/statuses";

// S-18, the Readiness tab (SPM-33, Track Outstanding Arrangements): everything
// that has to be in place before this event can be confirmed, each item
// complete, outstanding or marked as not required.
//
// The page decides nothing. The list, what counts as outstanding, how many
// items block confirmation and whether this user may change anything all come
// from GET /api/events/[id]/arrangements, which builds them with the same rule
// Confirm uses (src/lib/eventConfirmation.ts). An arrangement of a kind this
// page has never heard of - the Operational Safety Check (SPM-86) will be one -
// is listed like any other, and gets a button only if the server says it can
// be marked.
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
        subtitle="What has to be in place before this event can be confirmed."
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
        <div className="flex flex-col gap-4">
          {/* AC11: which arrangements are preventing confirmation. */}
          {data.blocking > 0 ? (
            <Alert
              variant="warning"
              title={
                data.blocking === 1
                  ? "1 arrangement still blocks confirmation"
                  : `${data.blocking} arrangements still block confirmation`
              }
            >
              Each one is shown below with what is missing. An arrangement this event does not
              need can be marked as not required.
            </Alert>
          ) : (
            <Alert variant="success" title="Nothing is blocking confirmation">
              Every arrangement is complete or marked as not required.
            </Alert>
          )}

          {actionError && <Alert variant="error">{actionError}</Alert>}

          <Card>
            <ul aria-label="Arrangements" className="divide-y divide-line">
              {data.arrangements.map((arrangement) => {
                const key = keyOf(arrangement);
                const marked = arrangement.state === "not_required";
                return (
                  <li key={key} className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="text-xs text-ink-3">
                        {humanise(arrangement.kind)}
                        {arrangement.session && <> · {arrangement.session.label ?? "Session"}</>}
                      </p>
                      <p className="font-medium text-ink">{arrangement.name}</p>
                      {arrangement.missing && (
                        <p className="mt-1 text-sm text-ink-2">{sentence(arrangement.missing)}</p>
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

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {/* Its own status, then where it stands for confirmation
                          (AC2, AC7, AC10): two different questions. */}
                      {arrangement.status && <StatusBadge status={arrangement.status} />}
                      <StatusBadge status={arrangement.state} />
                      {data.canManage && arrangement.waivable && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={saving === key}
                          onClick={() => void mark(arrangement, true)}
                        >
                          Mark as not required
                        </Button>
                      )}
                      {data.canManage && marked && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={saving === key}
                          onClick={() => void mark(arrangement, false)}
                        >
                          Mark as required
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
