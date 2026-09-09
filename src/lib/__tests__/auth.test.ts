import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
});

describe("auth helpers", () => {
  it("hashes and verifies a password correctly", async () => {
    const { hashPassword, verifyPassword } = await import("../auth");
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(await verifyPassword("correct-horse-battery-staple", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("signs and verifies a session token", async () => {
    const { signSession, verifySession } = await import("../auth");
    const token = signSession({ id: "user-1", role: "organiser" });
    const payload = verifySession(token);
    expect(payload?.id).toBe("user-1");
    expect(payload?.role).toBe("organiser");
  });

  it("rejects a garbage token", async () => {
    const { verifySession } = await import("../auth");
    expect(verifySession("not-a-real-token")).toBeNull();
  });
});
