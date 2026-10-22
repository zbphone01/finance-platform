import bcrypt from "bcryptjs";
import { getDb } from "../queries/connection";
import { sessions, users } from "@db/schema";
import { eq } from "drizzle-orm";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(userId: number): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await getDb().insert(sessions).values({
    userId,
    token,
    expiresAt,
  });

  return token;
}

export async function deleteSession(token: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.token, token));
}

export async function getUserFromToken(token: string) {
  const session = await getDb().query.sessions.findFirst({
    where: eq(sessions.token, token),
  });

  if (!session || session.expiresAt < new Date()) {
    return null;
  }

  const user = await getDb().query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  return user || null;
}
