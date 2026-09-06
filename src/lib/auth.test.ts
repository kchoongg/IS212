import { describe, expect, it, beforeAll } from "vitest";
import { hashPassword, verifyPassword, signSession, verifySession } from "./auth";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
});

describe("password hashing", () => {
  it("verifies a correct password against its hash", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    await expect(verifyPassword("correct-horse-battery-staple", hash)).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });
});

describe("session tokens", () => {
  it("round-trips a signed session payload", () => {
    const token = signSession({ userId: "user_1", email: "a@example.com" });
    const payload = verifySession(token);
    expect(payload).toMatchObject({ userId: "user_1", email: "a@example.com" });
  });

  it("returns null for an invalid token", () => {
    expect(verifySession("not-a-real-token")).toBeNull();
  });
});
