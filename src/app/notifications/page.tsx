"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, DataState, PageHeader } from "@/components/ui";
import { RequirePermission } from "@/components/RequirePermission";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { announceNotificationsChanged } from "@/lib/notificationView";
import { authedFetch } from "@/lib/session";
import { loginUrlFor } from "@/lib/useCurrentUser";

// SPM-71 (View Notifications), S-04. The signed-in user's own notifications,
// newest first (AC1, AC7): what happened, which event and when (AC2), unread
// ones marked as such (AC3), marked read one at a time or all at once (AC4),
// and each opening what it is about (AC5).
//
// Every role has Notifications in its sidebar (roles.ts NAV_BY_ROLE), so this
// is the one guarded route with no permission of its own - being signed in is
// the whole requirement. RequirePermission still stands in front of it, so an
// anonymous visitor is sent to log in rather than shown an empty screen.

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  event: { reference: string; title: string | null } | null;
  /// Where selecting it goes - src/lib/notificationView.ts. Null when it is
  /// about no event.
  href: string | null;
}

const PATH = "/notifications";
const UPDATE_FAILED = "Could not update your notifications. Try again.";

export default function NotificationsPage() {
  return (
    <RequirePermission title="Notifications">
      <NotificationsScreen />
    </RequirePermission>
  );
}

function NotificationsScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  /// Numbers each load of the list. Only the latest may show its answer, and
  /// marking something read retires any load still on its way: an answer read
  /// from the database before the mark was saved would otherwise put "Unread"
  /// back (React's development mode loads the page twice, which is how this
  /// was found; a double Retry would do the same).
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++loadSeq.current;
    setError(null);
    try {
      const res = await authedFetch("/api/notifications");
      if (res.status === 401) {
        router.push(loginUrlFor(PATH));
        return;
      }
      if (!res.ok) throw new Error("Could not load your notifications.");
      const list: Notification[] = await res.json();
      if (mine !== loadSeq.current) return;
      setRows(list);
    } catch (err) {
      if (mine !== loadSeq.current) return;
      setRows(null);
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /// Marks one read here and on the server. False when the server refused,
  /// in which case it stays unread on screen too.
  async function markRead(id: string): Promise<boolean> {
    setUpdateError(null);
    try {
      const res = await authedFetch(`/api/notifications/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isRead: true }),
      });
      if (!res.ok) throw new Error(UPDATE_FAILED);
    } catch {
      setUpdateError(UPDATE_FAILED);
      return false;
    }
    loadSeq.current++;
    setRows((current) => current && current.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    announceNotificationsChanged();
    return true;
  }

  async function markAllRead() {
    setUpdateError(null);
    setMarkingAll(true);
    try {
      const res = await authedFetch("/api/notifications/read-all", { method: "POST" });
      if (!res.ok) throw new Error(UPDATE_FAILED);
      loadSeq.current++;
      setRows((current) => current && current.map((n) => ({ ...n, isRead: true })));
      announceNotificationsChanged();
    } catch {
      setUpdateError(UPDATE_FAILED);
    } finally {
      setMarkingAll(false);
    }
  }

  /// AC5: open what it is about. Selecting an unread one also marks it read -
  /// opening it is reading it - but a failure to mark it does not stop it
  /// opening: getting to the event matters more than the badge.
  async function select(note: Notification, href: string) {
    if (!note.isRead) await markRead(note.id);
    router.push(href);
  }

  const anyUnread = rows?.some((n) => !n.isRead) ?? false;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Notifications"
        subtitle="What has happened on your events, newest first."
        actions={
          anyUnread ? (
            <Button variant="secondary" onClick={() => void markAllRead()} loading={markingAll} loadingText="Marking…">
              Mark all as read
            </Button>
          ) : undefined
        }
      />

      {updateError && (
        <Alert variant="error" className="mb-4">
          {updateError}
        </Alert>
      )}

      <DataState
        data={rows}
        error={error}
        onRetry={load}
        empty={{ title: "No notifications", description: "Updates about your events will appear here." }}
      >
        {(list) => (
          <Card>
            <ul aria-label="Your notifications" className="divide-y divide-line">
              {list.map((note) => (
                <NotificationItem key={note.id} note={note} onSelect={select} onMarkRead={markRead} />
              ))}
            </ul>
          </Card>
        )}
      </DataState>
    </div>
  );
}

function NotificationItem({
  note,
  onSelect,
  onMarkRead,
}: {
  note: Notification;
  onSelect: (note: Notification, href: string) => Promise<void>;
  onMarkRead: (id: string) => Promise<boolean>;
}) {
  const unread = !note.isRead;
  const { href } = note;

  return (
    <li className={cn("flex items-start gap-3 px-4 py-4", unread && "bg-brand-50/40")}>
      {/* AC3: a dot beside an unread one, as well as the bold title and the
          "Unread" label - never colour alone. */}
      <span
        aria-hidden="true"
        className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", unread ? "bg-brand-600" : "bg-transparent")}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={cn("text-sm text-ink", unread ? "font-semibold" : "font-normal")}>
            {href ? (
              <Link
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  void onSelect(note, href);
                }}
                className="underline-offset-2 hover:underline"
              >
                {note.title}
              </Link>
            ) : (
              note.title
            )}
          </h2>
          {unread && (
            <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700">Unread</span>
          )}
        </div>
        <p className="mt-1 text-sm text-ink-2">{note.body}</p>
        <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-ink-3">
          {note.event && (
            <span>
              {note.event.title || "Untitled event"} · {note.event.reference}
            </span>
          )}
          <time dateTime={note.createdAt}>{formatDateTime(note.createdAt)}</time>
        </p>
      </div>
      {unread && (
        <Button variant="secondary" size="sm" onClick={() => void onMarkRead(note.id)}>
          Mark as read
        </Button>
      )}
    </li>
  );
}
