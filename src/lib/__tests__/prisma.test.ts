// src/lib/prisma.ts: one shared Prisma client, kept on `global` outside
// production so a dev-server reload reuses it instead of opening a new pool.
// Creating a client does not connect, so no database is needed here.
import { afterEach, describe, expect, it, vi } from "vitest";

const stash = global as unknown as { prisma?: unknown };

afterEach(() => {
  delete stash.prisma;
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load() {
  vi.resetModules();
  return (await import("../prisma")).prisma;
}

describe("the shared Prisma client", () => {
  it("is created once and kept on global outside production", async () => {
    const prisma = await load();

    // A real client, not undefined or a stand-in: it has the query API.
    expect(typeof prisma.$queryRaw).toBe("function");
    expect(stash.prisma).toBe(prisma);
    expect(await load()).toBe(prisma);
  });

  it("reuses a client already kept on global", async () => {
    const existing = { kept: true };
    stash.prisma = existing;

    expect(await load()).toBe(existing);
  });

  it("is not kept on global in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const prisma = await load();

    // A real client, not undefined or a stand-in: it has the query API.
    expect(typeof prisma.$queryRaw).toBe("function");
    expect(stash.prisma).toBeUndefined();
  });
});
