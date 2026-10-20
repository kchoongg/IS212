// src/lib/session.ts on the server: these helpers are imported by client
// pages that Next.js also renders on the server, where there is no
// localStorage. (The browser behaviour is in client.test.tsx.)
import { describe, expect, it } from "vitest";
import { getToken } from "../session";

describe("getToken on the server", () => {
  it("[SPM-21][AC1] has no token, and does not touch localStorage", () => {
    expect(typeof window).toBe("undefined");
    expect(getToken()).toBeNull();
  });
});
