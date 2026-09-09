import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("Missing JWT_SECRET environment variable");
}

export interface SessionPayload {
  id: string;
  role: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET!, { expiresIn: "8h" });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET!) as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Reads and verifies the session from the Authorization header
 * (`Authorization: Bearer <token>`) of an incoming API route request.
 * Returns null if there's no valid session - callers decide what to do
 * (usually: return a 401).
 */
export function getSession(req: NextRequest): SessionPayload | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return verifySession(header.slice("Bearer ".length));
}
