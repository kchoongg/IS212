import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { POST as login } from "@/app/api/auth/login/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as register } from "@/app/api/auth/register/route";
import { hashPassword, verifyPassword, verifySession } from "@/lib/auth";
import { callArg, db, givenUsers, req, signIn, user } from "@/test/kit";

describe("POST /api/auth/login", () => {
  const PASSWORD = "correct-horse-battery";

  async function account(overrides = {}) {
    return { ...user("organiser"), passwordHash: await hashPassword(PASSWORD), ...overrides };
  }

  it("[SPM-21][AC1] returns a session token and the user for the right password", async () => {
    const row = await account();
    givenUsers(row);

    const res = await login(req("POST", "/api/auth/login", { body: { email: row.email, password: PASSWORD } }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.user).toEqual({ id: row.id, name: row.fullName, email: row.email, role: "organiser" });
    expect(verifySession(body.token)).toMatchObject({ id: row.id, role: "organiser" });
  });

  it("[SPM-21][AC1] matches the email regardless of capitalisation and surrounding spaces", async () => {
    const row = await account();
    givenUsers(row);

    const res = await login(
      req("POST", "/api/auth/login", { body: { email: "  Organiser@Example.COM ", password: PASSWORD } })
    );

    expect(res.status).toBe(200);
  });

  it("[SPM-21][AC2] refuses an unknown email with the same message as a wrong password", async () => {
    givenUsers();

    const res = await login(req("POST", "/api/auth/login", { body: { email: "nobody@example.com", password: "x" } }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid email or password" });
  });

  it("[SPM-21][AC2] refuses a wrong password", async () => {
    const row = await account();
    givenUsers(row);

    const res = await login(req("POST", "/api/auth/login", { body: { email: row.email, password: "wrong" } }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid email or password" });
  });

  it("[SPM-21][AC2] refuses a deactivated account with 403, even with the right password", async () => {
    const row = await account({ isActive: false });
    givenUsers(row);

    const res = await login(req("POST", "/api/auth/login", { body: { email: row.email, password: PASSWORD } }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toMatch(/deactivated/);
    expect(body.token).toBeUndefined();
  });

  it("[SPM-21][AC2] rejects a body that fails validation", async () => {
    const res = await login(req("POST", "/api/auth/login", { body: { email: "not-an-email", password: "" } }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Validation failed");
    expect(body.details.fieldErrors).toHaveProperty("email");
    expect(body.details.fieldErrors).toHaveProperty("password");
  });

  it("[SPM-21] answers 500 when the database fails", async () => {
    db.user.findUnique.mockRejectedValue(new Error("connection lost"));

    const res = await login(req("POST", "/api/auth/login", { body: { email: "a@example.com", password: "x" } }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});

describe("GET /api/auth/me", () => {
  it("[SPM-21][AC3] returns the signed-in user's id, name, email and role", async () => {
    const coordinator = user("coordinator");
    const token = signIn(coordinator);

    const res = await me(req("GET", "/api/auth/me", { token }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: coordinator.id,
      name: coordinator.fullName,
      email: coordinator.email,
      role: "coordinator",
    });
  });

  it("[SPM-21][AC4] is 401 without a session", async () => {
    const res = await me(req("GET", "/api/auth/me"));
    expect(res.status).toBe(401);
  });

  it("[SPM-21][AC4] is 401 for a deactivated account", async () => {
    const token = signIn(user("coordinator", { isActive: false }));
    const res = await me(req("GET", "/api/auth/me", { token }));
    expect(res.status).toBe(401);
  });

  it("[SPM-21] is 404 if the user disappears between the session check and the lookup", async () => {
    const coordinator = user("coordinator");
    const token = signIn(coordinator);
    db.user.findUnique.mockResolvedValueOnce(coordinator).mockResolvedValueOnce(null);

    const res = await me(req("GET", "/api/auth/me", { token }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "User not found" });
  });
});

describe("POST /api/auth/register", () => {
  const valid = { name: "Rachel Ng", email: "rachel@example.com", password: "long-enough-pw", role: "organiser" };

  it("[SPM-21] creates the account with a hashed password and returns it without the hash", async () => {
    givenUsers();
    db.user.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "new-user", ...data }));

    const res = await register(req("POST", "/api/auth/register", { body: valid }));
    const body = await res.json();
    const written = callArg(db.user.create).data;

    expect(res.status).toBe(201);
    expect(body).toEqual({ id: "new-user", name: "Rachel Ng", email: "rachel@example.com", role: "organiser" });
    expect(written.fullName).toBe("Rachel Ng");
    expect(written.passwordHash).not.toBe(valid.password);
    expect(await verifyPassword(valid.password, written.passwordHash)).toBe(true);
  });

  it("[SPM-21] stores the email trimmed and lower-cased", async () => {
    givenUsers();
    db.user.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "new-user", ...data }));

    await register(req("POST", "/api/auth/register", { body: { ...valid, email: " Rachel@Example.COM " } }));

    expect(callArg(db.user.create).data.email).toBe("rachel@example.com");
  });

  it("[SPM-21] refuses an email that is already registered", async () => {
    givenUsers({ id: "existing", email: valid.email });

    const res = await register(req("POST", "/api/auth/register", { body: valid }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "A user with this email already exists" });
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it.each(["coordinator", "ops_manager", "venue_staff", "tech_support"])(
    "[SPM-21] refuses self-registration as internal role %s",
    async (role) => {
      givenUsers();

      const res = await register(req("POST", "/api/auth/register", { body: { ...valid, role } }));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.details.fieldErrors.role[0]).toMatch(/Staff accounts are created by ConnectSphere/);
      expect(db.user.create).not.toHaveBeenCalled();
    }
  );

  it("[SPM-21] allows self-registration as an attendee", async () => {
    givenUsers();
    db.user.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "new-user", ...data }));

    const res = await register(req("POST", "/api/auth/register", { body: { ...valid, role: "attendee" } }));

    expect(res.status).toBe(201);
  });

  it("[SPM-21] rejects a password shorter than 8 characters", async () => {
    const res = await register(req("POST", "/api/auth/register", { body: { ...valid, password: "short" } }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.details.fieldErrors.password).toEqual(["Password must be at least 8 characters"]);
  });

  it("[SPM-21] answers 500 when the database fails", async () => {
    givenUsers();
    db.user.create.mockRejectedValue(new Error("connection lost"));

    const res = await register(req("POST", "/api/auth/register", { body: valid }));

    expect(res.status).toBe(500);
  });
});
