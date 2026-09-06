import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const SALT_ROUNDS = 10;
const SESSION_EXPIRY = "7d";

export interface SessionPayload {
  userId: string;
  email: string;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set");
  }
  return secret;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: SESSION_EXPIRY });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as SessionPayload;
  } catch {
    return null;
  }
}
