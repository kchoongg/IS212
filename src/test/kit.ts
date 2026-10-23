// Shared setup for API route tests (src/app/api/__tests__).
//
// A route test calls the handler directly - no server, no database:
//
//   vi.mock("@/lib/prisma");                       // must be in the test file
//   import { GET } from "@/app/api/queue/route";
//   import { db, req, signIn, user } from "@/test/kit";
//
//   const token = signIn(user("coordinator"));
//   db.event.findMany.mockResolvedValue([]);
//   const res = await GET(req("GET", "/api/queue", { token }));
//   expect(res.status).toBe(200);
//
// Only the database is faked. Authentication, permissions and validation are
// the real code, so a test fails if any of them stops refusing what it should.

import { beforeEach, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signSession } from "@/lib/auth";
import { resetPrismaMock } from "@/lib/__mocks__/prisma";

type Model = Record<string, Mock>;

/// The mocked Prisma client (src/lib/__mocks__/prisma.ts), typed as mocks.
export const db = prisma as unknown as Record<string, Model> & Record<`$${string}`, Mock>;

beforeEach(() => {
  resetPrismaMock();
  // Routes log the error behind every 500. Tests provoke those on purpose.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

export interface TestUser {
  id: string;
  role: string;
  organisationId: string | null;
  isActive: boolean;
  fullName: string;
  email: string;
}

/// Fixed, valid UUIDs - several schemas reject an id that is not one.
export const ID = {
  user: "11111111-1111-4111-8111-111111111111",
  otherUser: "22222222-2222-4222-8222-222222222222",
  thirdUser: "33333333-3333-4333-8333-333333333333",
  org: "44444444-4444-4444-8444-444444444444",
  otherOrg: "55555555-5555-4555-8555-555555555555",
  event: "66666666-6666-4666-8666-666666666666",
  venue: "77777777-7777-4777-8777-777777777777",
  otherVenue: "78787878-7878-4787-8787-787878787878",
  equipment: "88888888-8888-4888-8888-888888888888",
  request: "99999999-9999-4999-8999-999999999999",
  session: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  otherSession: "abababab-abab-4bab-8bab-abababababab",
  facility: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  booking: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  registration: "edededed-eded-4ded-8ded-edededededed",
} as const;

/// A user of the given role. External roles get a client organisation by
/// default, internal staff do not - the same shape as real accounts.
export function user(role: string, overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: ID.user,
    role,
    organisationId: role === "organiser" ? ID.org : null,
    isActive: true,
    fullName: `Test ${role}`,
    email: `${role}@example.com`,
    ...overrides,
  };
}

/// Makes `users` the only rows in the user table, as far as
/// `prisma.user.findUnique` is concerned (by id or by email).
export function givenUsers(...users: object[]) {
  db.user.findUnique.mockImplementation(async (args: { where: { id?: string; email?: string } }) => {
    const { id, email } = args.where;
    const rows = users as { id?: string; email?: string }[];
    return rows.find((u) => (id !== undefined && u.id === id) || (email !== undefined && u.email === email)) ?? null;
  });
}

/// Signs `actor` in: they exist in the user table (with any `others`), and the
/// returned token is a real session for them, to pass as `req(..., { token })`.
export function signIn(actor: TestUser, ...others: object[]): string {
  givenUsers(actor, ...others);
  return signSession({ id: actor.id, role: actor.role });
}

interface RequestOptions {
  token?: string;
  body?: unknown;
}

/// A request as the route handler receives it. `body` is sent as JSON; pass a
/// string to send it verbatim (e.g. to test a malformed body).
export function req(method: string, path: string, { token, body }: RequestOptions = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

/// The second argument of a dynamic route handler: `{ params }` as a promise.
export function params<T extends Record<string, string>>(values: T): { params: Promise<T> } {
  return { params: Promise.resolve(values) };
}

/// The first argument a mocked Prisma method was called with on its Nth call -
/// the `{ where, data, select }` object, for asserting what a route wrote.
export function callArg(fn: Mock, call = 0) {
  return fn.mock.calls[call]?.[0];
}

/// SPM-82: the order in which the route ran the statement that expires overdue
/// tentative holds (expireDueHolds, src/lib/holdExpiryService.ts), or null if
/// it never did. A route that reads bookings must run it first, so an expired
/// hold is never read as pending - compare with another mock's
/// `invocationCallOrder[0]`.
export function holdExpirySweepOrder(): number | null {
  const calls = db.$queryRaw.mock.calls as unknown[][];
  const index = calls.findIndex(([sql]) => Array.isArray(sql) && (sql as string[]).join("").includes("SET status = 'expired'"));
  return index < 0 ? null : db.$queryRaw.mock.invocationCallOrder[index];
}

/// When sweepWaitingList() (SPM-66) ran its first UPDATE, as a call order, or
/// null if it never did. A route that reads registrations runs it first, so an
/// offer whose time is up is never read as standing.
export function waitingListSweepOrder(): number | null {
  const calls = db.$queryRaw.mock.calls as unknown[][];
  const index = calls.findIndex(([sql]) => Array.isArray(sql) && (sql as string[]).join("").includes("offer_ended_reason = 'event_started'"));
  return index < 0 ? null : db.$queryRaw.mock.invocationCallOrder[index];
}
