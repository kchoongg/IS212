"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardBody,
  ConfirmDialog,
  EmptyState,
  Field,
  PageHeader,
  SkeletonRows,
  StatusBadge,
  Tabs,
  Textarea,
} from "@/components/ui";
import { RequirePermission } from "@/components/RequirePermission";
import { registrationCountLine } from "@/lib/flaggedArrangements";
import { formatDateTimeRange, formatVenue } from "@/lib/format";
import { authedFetch } from "@/lib/session";
import { statusLabel } from "@/lib/statuses";
import { loginUrlFor } from "@/lib/useCurrentUser";
import { layoutLabel } from "@/lib/venueSuitability";

// SPM-68, the Coordinator's Flagged Arrangements page (S-30). Every venue
// booking, equipment reservation and registration list on their events that a
// change has flagged for review - an event's date, attendance or requirements
// (SPM-62), its registration settings (SPM-64), the venue (SPM-39, SPM-45) or
// the equipment (SPM-55) - with why, and how it stands against the event now.
//
// Each one is kept as it is (the flag is cleared; the server refuses if it no
// longer meets the event's requirements, and says what is unmet) or, for a
// venue booking, replaced: search for another room, request it, and release
// or withdraw this one (SPM-67). Nothing here changes an arrangement on its
// own - that is the point of flagging.
//
// The same flags make a booking or equipment line Outstanding on the event's
// Readiness tab (SPM-33); this page is where they are resolved.
//
// One tab per kind of arrangement - /flagged?tab=venue, ?tab=equipment,
// ?tab=registrations - each with how many are flagged. Opened without a tab,
// the page shows the first kind that has something, so a coordinator with only
// registrations to review does not land on an empty Venue bookings tab.

const SELF = "/flagged";

interface EventRef {
  reference: string;
  title: string | null;
  status: string;
}

interface Verdict {
  ok: boolean;
  unmet: string[];
}

interface FlaggedBooking {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  layoutName: string | null;
  reasons: string[];
  event: EventRef;
  session: { id: string; label: string | null } | null;
  venue: { id: string; code: string; name: string };
  suitability: Verdict;
  availability: Verdict;
}

interface FlaggedEquipment {
  id: string;
  status: string;
  reasons: string[];
  event: EventRef;
  session: { id: string; label: string | null } | null;
  equipment: { id: string; name: string };
  availability: { ok: boolean; summary: string };
}

interface FlaggedRegistrations {
  event: EventRef & { id: string };
  registered: number;
  waitlisted: number;
  reasons: string[];
}

interface Flagged {
  venueBookings: FlaggedBooking[];
  equipmentRequests: FlaggedEquipment[];
  registrations: FlaggedRegistrations[];
}

/// The tabs, in the order a coordinator works through an event: the rooms,
/// the kit, then who is coming.
const KINDS = [
  { key: "venue", label: "Venue bookings", nothing: "No venue bookings are flagged" },
  { key: "equipment", label: "Equipment reservations", nothing: "No equipment reservations are flagged" },
  { key: "registrations", label: "Registrations", nothing: "No registrations are flagged" },
] as const;
type Kind = (typeof KINDS)[number]["key"];

type ClearKind = "venue_booking" | "equipment_request" | "registrations";
type ChangeAction = "withdraw" | "release";

/// SPM-67's wording for taking a booking back, as on the event's Venue tab.
/// Two differences here: the question's other button is "Cancel" (on this
/// page "Keep booking" is the button that clears the flag), and what follows
/// does not point at a venue list below.
const CHANGE = {
  withdraw: {
    button: "Withdraw request",
    title: "Withdraw this request?",
    consequence: "will no longer be requested, and Venue Staff will no longer see it on their Booking Requests list.",
    done: "Request withdrawn",
    status: "withdrawn",
    afterwards: "",
  },
  release: {
    button: "Release booking",
    title: "Release this booking?",
    consequence: "will be freed for other events, and Venue Staff will be notified.",
    done: "Booking released",
    status: "released",
    afterwards: " Venue Staff have been notified.",
  },
} as const;

const titleOf = (event: EventRef) => event.title || "Untitled event";

/// "Hall A (HALL-A) on 4 Mar 2027, 13:30–17:00", with the session if it has one.
function describeBooking(b: FlaggedBooking): string {
  const session = b.session ? ` for ${b.session.label ?? "Session"}` : "";
  return `${formatVenue(b.venue.name, b.venue.code)}${session} on ${formatDateTimeRange(b.startsAt, b.endsAt)}`;
}

export default function FlaggedArrangementsPage() {
  return (
    <RequirePermission
      action="event:confirm"
      title="Flagged Arrangements"
      reason="Reviewing flagged arrangements is the Event Coordinator's role. You can still see the events you are involved in from your Dashboard."
    >
      {/* useSearchParams needs a Suspense boundary above it. */}
      <Suspense fallback={null}>
        <FlaggedArrangementsScreen />
      </Suspense>
    </RequirePermission>
  );
}

function FlaggedArrangementsScreen() {
  const router = useRouter();
  const requestedTab = useSearchParams().get("tab");
  const [data, setData] = useState<Flagged | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /// What was just kept, reviewed, withdrawn or released.
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  /// A refusal, shown inside the item it is about.
  const [refusal, setRefusal] = useState<{ key: string; message: string } | null>(null);
  /// The item whose flag is being cleared.
  const [busy, setBusy] = useState<string | null>(null);
  /// The booking being withdrawn or released, while the question is open.
  const [changing, setChanging] = useState<{ booking: FlaggedBooking; action: ChangeAction } | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await authedFetch("/api/flagged-arrangements");
      if (res.status === 401) {
        router.push(loginUrlFor(SELF));
        return;
      }
      if (!res.ok) throw new Error("Could not load the flagged arrangements.");
      setData(await res.json());
    } catch (err) {
      setData(null);
      setLoadError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /// Keep a booking or reservation, or mark registrations as reviewed. The
  /// server decides: it clears the flag, or says what is no longer met (AC7).
  async function clearFlag(kind: ClearKind, id: string, key: string, done: string) {
    const failed = "Could not clear the flag. Try again.";
    setNotice(null);
    setRefusal(null);
    setBusy(key);
    try {
      const res = await authedFetch("/api/flagged-arrangements", {
        method: "POST",
        body: JSON.stringify({ kind, id }),
      });
      if (res.status === 401) {
        router.push(loginUrlFor(SELF));
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setRefusal({ key, message: body?.error ?? failed });
        return;
      }
      setNotice({ title: "Flag cleared", body: done });
      await load();
    } catch {
      setRefusal({ key, message: failed });
    } finally {
      setBusy(null);
    }
  }

  function startChange(booking: FlaggedBooking, action: ChangeAction) {
    setReason("");
    setNotice(null);
    setRefusal(null);
    setChanging({ booking, action });
  }

  /// AC12: withdraw or release the flagged booking, through SPM-67's route.
  async function confirmChange() {
    if (!changing) return;
    const { booking, action } = changing;
    const failed = "Could not save the change. Please try again.";
    const key = `booking:${booking.id}`;
    setSaving(true);
    try {
      const res = await authedFetch(`/api/events/${booking.event.reference}/venue-bookings/${booking.id}`, {
        method: "PATCH",
        body: JSON.stringify(reason.trim() ? { action, reason: reason.trim() } : { action }),
      });
      if (res.status === 401) {
        router.push(loginUrlFor(SELF));
        return;
      }
      if (!res.ok) {
        // The refusal says what to do instead (e.g. release a request Venue
        // Staff approved meanwhile), and the reload below shows why.
        const body = await res.json().catch(() => null);
        setRefusal({ key, message: body?.error ?? failed });
      } else {
        const words = CHANGE[action];
        setNotice({
          title: words.done,
          body: `${describeBooking(booking)} is now ${statusLabel(words.status)}.${words.afterwards}`,
        });
      }
      setChanging(null);
      await load();
    } catch {
      setRefusal({ key, message: failed });
      setChanging(null);
    } finally {
      setSaving(false);
    }
  }

  const refusalFor = (key: string) =>
    refusal?.key === key ? <Alert variant="error">{refusal.message}</Alert> : null;

  const counts: Record<Kind, number> = {
    venue: data?.venueBookings.length ?? 0,
    equipment: data?.equipmentRequests.length ?? 0,
    registrations: data?.registrations.length ?? 0,
  };
  const nothingFlagged = KINDS.every((kind) => counts[kind.key] === 0);
  // The tab asked for, or else the first with something in it.
  const tab: Kind =
    KINDS.find((kind) => kind.key === requestedTab)?.key ?? KINDS.find((kind) => counts[kind.key] > 0)?.key ?? "venue";
  const nothingHere = KINDS.find((kind) => kind.key === tab)!.nothing;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Flagged Arrangements"
        subtitle="Venue bookings, equipment reservations and registrations on your events that a change has flagged for review. Keep each one, or replace it."
      />

      {notice && (
        <Alert variant="success" title={notice.title} className="mb-6">
          {notice.body}
        </Alert>
      )}

      {loadError ? (
        <Alert
          variant="error"
          title="Could not load this"
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {loadError}
        </Alert>
      ) : data === null ? (
        <SkeletonRows rows={3} />
      ) : nothingFlagged ? (
        <EmptyState
          title="Nothing is flagged"
          description="Arrangements appear here when a change to an event, a venue or equipment means they need another look."
        />
      ) : (
        <div className="flex flex-col gap-6">
          <Tabs
            items={KINDS.map((kind) => ({
              key: kind.key,
              label: kind.label,
              href: `${SELF}?tab=${kind.key}`,
              badge: counts[kind.key],
            }))}
            activeKey={tab}
          />

          {counts[tab] === 0 && (
            <EmptyState title={nothingHere} description="Nothing of this kind needs another look right now." />
          )}

          {tab === "venue" && data.venueBookings.length > 0 && (
            <Section label="Flagged venue bookings">
              {data.venueBookings.map((b) => {
                const key = `booking:${b.id}`;
                const change: ChangeAction = b.status === "pending" ? "withdraw" : "release";
                return (
                  <Item
                    key={b.id}
                    event={b.event}
                    reasons={b.reasons}
                    aside={<StatusBadge status={b.status} />}
                    name={formatVenue(b.venue.name, b.venue.code)}
                    detail={[
                      b.session && (b.session.label ?? "Session"),
                      formatDateTimeRange(b.startsAt, b.endsAt),
                      b.layoutName && layoutLabel(b.layoutName),
                    ]}
                  >
                    <Result label="Suitability" verdict={b.suitability} good="Suitable" bad="Not suitable" />
                    <Result label="Availability" verdict={b.availability} good="Available" bad="Not available" />
                    {refusalFor(key)}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        loading={busy === key}
                        onClick={() =>
                          void clearFlag("venue_booking", b.id, key, `${b.venue.name} for ${titleOf(b.event)} was kept as it is.`)
                        }
                      >
                        Keep booking
                      </Button>
                      <ButtonLink
                        href={`/venues/search?event=${b.event.reference}&booking=${b.id}`}
                        variant="secondary"
                        size="sm"
                      >
                        Find a replacement venue
                      </ButtonLink>
                      <Button variant="secondary" size="sm" onClick={() => startChange(b, change)}>
                        {CHANGE[change].button}
                      </Button>
                    </div>
                  </Item>
                );
              })}
            </Section>
          )}

          {tab === "equipment" && data.equipmentRequests.length > 0 && (
            <Section label="Flagged equipment reservations">
              {data.equipmentRequests.map((r) => {
                const key = `equipment:${r.id}`;
                return (
                  <Item
                    key={r.id}
                    event={r.event}
                    reasons={r.reasons}
                    aside={<StatusBadge status={r.status} />}
                    name={r.equipment.name}
                    detail={[r.session && (r.session.label ?? "Session")]}
                  >
                    <p className={r.availability.ok ? "text-ink-2" : "text-tone-warning-fg"}>
                      <span className="font-medium text-ink">Availability:</span> {r.availability.summary}
                    </p>
                    {refusalFor(key)}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        loading={busy === key}
                        onClick={() =>
                          void clearFlag(
                            "equipment_request",
                            r.id,
                            key,
                            `${r.equipment.name} for ${titleOf(r.event)} was kept as it is.`
                          )
                        }
                      >
                        Keep reservation
                      </Button>
                    </div>
                  </Item>
                );
              })}
            </Section>
          )}

          {tab === "registrations" && data.registrations.length > 0 && (
            <Section label="Flagged registrations">
              {data.registrations.map((r) => {
                const key = `registrations:${r.event.id}`;
                return (
                  <Item
                    key={r.event.id}
                    event={r.event}
                    reasons={r.reasons}
                    name={registrationCountLine(r.registered, r.waitlisted)}
                  >
                    {refusalFor(key)}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        loading={busy === key}
                        onClick={() =>
                          void clearFlag(
                            "registrations",
                            r.event.id,
                            key,
                            `Registrations for ${titleOf(r.event)} were marked as reviewed. No registration was changed.`
                          )
                        }
                      >
                        Mark as reviewed
                      </Button>
                    </div>
                  </Item>
                );
              })}
            </Section>
          )}
        </div>
      )}

      <ConfirmDialog
        open={changing !== null}
        title={changing ? CHANGE[changing.action].title : ""}
        confirmLabel={changing ? CHANGE[changing.action].button : ""}
        loading={saving}
        onConfirm={() => void confirmChange()}
        onCancel={() => setChanging(null)}
      >
        {changing && (
          <div className="flex flex-col gap-3">
            <p>
              {describeBooking(changing.booking)} {CHANGE[changing.action].consequence}
            </p>
            <Field label="Reason (optional)">
              <Textarea value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}

/// One tab's flagged arrangements: a card whose body is a labelled list. The
/// tab names the kind, so the card needs no heading of its own.
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardBody>
        <ul aria-label={label} className="flex flex-col divide-y divide-line">
          {children}
        </ul>
      </CardBody>
    </Card>
  );
}

/// One flagged arrangement (AC2): its event, the arrangement itself (`name`
/// and a line of `detail`), why it was flagged, then its current result and
/// what can be done about it (`children`).
function Item({
  event,
  reasons,
  aside,
  name,
  detail = [],
  children,
}: {
  event: EventRef;
  reasons: string[];
  aside?: React.ReactNode;
  name: string;
  detail?: (string | null | false | undefined)[];
  children: React.ReactNode;
}) {
  const details = detail.filter(Boolean);
  return (
    <li className="flex flex-col gap-2 py-4 text-sm first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col">
          <Link href={`/events/${event.reference}`} className="font-medium text-ink underline-offset-2 hover:underline">
            {titleOf(event)}
          </Link>
          <span className="text-xs text-ink-3">{event.reference}</span>
        </div>
        {aside}
      </div>
      <div>
        <p className="font-medium text-ink">{name}</p>
        {details.length > 0 && <p className="text-xs text-ink-3">{details.join(" · ")}</p>}
      </div>
      <p className="text-ink-2">
        <span className="font-medium text-ink">Flagged because:</span> {reasons.join("; ")}
      </p>
      {children}
    </li>
  );
}

/// AC4: one line of a booking's current result, with what is unmet under it.
/// Paragraphs, not a nested list: each unmet requirement is a sentence.
function Result({ label, verdict, good, bad }: { label: string; verdict: Verdict; good: string; bad: string }) {
  return (
    <div className={verdict.ok ? "text-ink-2" : "text-tone-warning-fg"}>
      <p>
        <span className="font-medium text-ink">{label}:</span> {verdict.ok ? good : bad}
      </p>
      {verdict.unmet.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
    </div>
  );
}
