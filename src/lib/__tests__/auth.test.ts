import { describe, it, expect, beforeAll, vi } from "vitest";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
});

describe("auth helpers", () => {
  it("[SPM-21][AC1] hashes and verifies a password correctly", async () => {
    const { hashPassword, verifyPassword } = await import("../auth");
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(await verifyPassword("correct-horse-battery-staple", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("[SPM-21][AC1] signs and verifies a session token", async () => {
    const { signSession, verifySession } = await import("../auth");
    const token = signSession({ id: "user-1", role: "organiser" });
    const payload = verifySession(token);
    expect(payload?.id).toBe("user-1");
    expect(payload?.role).toBe("organiser");
  });

  it("[SPM-21][AC4] rejects a garbage token", async () => {
    const { verifySession } = await import("../auth");
    expect(verifySession("not-a-real-token")).toBeNull();
  });
});

describe("starting up", () => {
  it("[SPM-21] refuses to load without a JWT_SECRET, rather than signing with nothing", async () => {
    vi.resetModules();
    vi.stubEnv("JWT_SECRET", "");
    try {
      await expect(import("../auth")).rejects.toThrow("Missing JWT_SECRET environment variable");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
