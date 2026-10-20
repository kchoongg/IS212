import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { forbidden, getActor, hidden, resolveEventId, unauthenticated } from "../apiAuth";
import { signSession } from "../auth";
import { callArg, db, givenUsers, req, signIn, user } from "@/test/kit";

describe("getActor", () => {
  it("[SPM-21][AC3] returns the user's id, role and organisation for a valid session", async () => {
    const organiser = user("organiser");
    const token = signIn(organiser);

    const actor = await getActor(req("GET", "/api/anything", { token }));

    expect(actor).toEqual({ id: organiser.id, role: "organiser", organisationId: organiser.organisationId });
  });

  it("[SPM-21][AC4] returns null without an Authorization header, and does not query the database", async () => {
    expect(await getActor(req("GET", "/api/anything"))).toBeNull();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("[SPM-21][AC4] returns null for a token that was not signed by this app", async () => {
    givenUsers(user("organiser"));
    expect(await getActor(req("GET", "/api/anything", { token: "not-a-real-token" }))).toBeNull();
  });

  it("[SPM-21][AC4] returns null when the header is not a Bearer token", async () => {
    const token = signIn(user("organiser"));
    const request = req("GET", "/api/anything");
    request.headers.set("authorization", `Basic ${token}`);
    expect(await getActor(request)).toBeNull();
  });

  it("[SPM-21][AC4] returns null when the user in the token no longer exists", async () => {
    givenUsers();
    const token = signSession({ id: "deleted-user", role: "organiser" });
    expect(await getActor(req("GET", "/api/anything", { token }))).toBeNull();
  });

  it("[SPM-21][AC4] returns null for a deactivated account, even with a valid token", async () => {
    const token = signIn(user("coordinator", { isActive: false }));
    expect(await getActor(req("GET", "/api/anything", { token }))).toBeNull();
  });

  it("[SPM-21][AC3] takes the role from the database, not from the token", async () => {
    // Signed in as an organiser, since demoted in the database to attendee.
    const token = signSession({ id: user("organiser").id, role: "organiser" });
    givenUsers(user("attendee"));

    const actor = await getActor(req("GET", "/api/anything", { token }));

    expect(actor?.role).toBe("attendee");
  });
});

describe("refusal responses", () => {
  it("[SPM-21][AC4] unauthenticated() is a 401", async () => {
    const res = unauthenticated();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not authenticated" });
  });

  it("[SPM-21][AC4] forbidden() is a 403 with a default message", async () => {
    const res = forbidden();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You do not have access to this" });
  });

  it("[SPM-21][AC4] forbidden() carries the caller's message", async () => {
    expect(await forbidden("Venue Staff only").json()).toEqual({ error: "Venue Staff only" });
  });

  it("[SPM-22][AC4] hidden() is a 404 that does not confirm the event exists", async () => {
    const res = hidden();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Event not found" });
  });
});

describe("resolveEventId", () => {
  it("[SPM-31] looks the event up by the number in its reference", async () => {
    db.event.findUnique.mockResolvedValue({ id: "event-uuid" });

    expect(await resolveEventId("EVT-000123")).toBe("event-uuid");
    expect(callArg(db.event.findUnique).where).toEqual({ sequenceNumber: 123 });
  });

  it("[SPM-31] returns null for a malformed reference without querying", async () => {
    expect(await resolveEventId("not-a-reference")).toBeNull();
    expect(db.event.findUnique).not.toHaveBeenCalled();
  });

  it("[SPM-31] returns null when no event has that reference", async () => {
    db.event.findUnique.mockResolvedValue(null);
    expect(await resolveEventId("EVT-000999")).toBeNull();
  });
});
