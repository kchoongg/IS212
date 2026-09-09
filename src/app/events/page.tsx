"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/session";

interface EventItem {
  id: string;
  title: string;
  status: string;
  proposedDate: string | null;
  createdAt: string;
}

export default function EventsPage() {
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  async function loadEvents() {
    const res = await authedFetch("/api/events");
    if (!res.ok) {
      setError("Could not load events - are you logged in?");
      return;
    }
    setError(null);
    setEvents(await res.json());
  }

  useEffect(() => {
    // This is the standard "fetch on mount" pattern - loadEvents only sets
    // state after its internal `await`, never synchronously. The
    // react-hooks/set-state-in-effect rule flags any function call here that
    // *contains* a setState anywhere in its body, without checking whether
    // it happens before or after an await, so it can't tell the difference.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadEvents();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await authedFetch("/api/events", {
        method: "POST",
        body: JSON.stringify({ title }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not create event");
      setTitle("");
      await loadEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <h2 className="mb-4 text-xl font-bold">Your events</h2>

      <form onSubmit={handleCreate} className="mb-6 flex gap-2">
        <input
          className="flex-1 rounded border border-gray-300 px-3 py-2"
          placeholder="New event title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <button
          type="submit"
          disabled={creating}
          className="rounded bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {creating ? "Creating..." : "Create draft"}
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {events === null && !error && <p className="text-gray-500">Loading...</p>}
      {events?.length === 0 && <p className="text-gray-500">No events yet - create one above.</p>}

      <ul className="flex flex-col gap-2">
        {events?.map((event) => (
          <li key={event.id} className="rounded border border-gray-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">{event.title}</span>
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs uppercase text-gray-600">
                {event.status}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
