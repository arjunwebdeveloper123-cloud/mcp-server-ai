import crypto from "node:crypto";
import { promisify } from "node:util";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { Settings, User, getSettings } from "../models/index.js";

/*  Dashboard login
    - Password: scrypt hash (Node ka built-in, koi extra package nahi)
    - Session: JWT, httpOnly cookie "sb_session" me (JavaScript se padha nahi ja sakta)
    - Secret: JWT_SECRET env, warna pehli baar random banake DB me save                */

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: string, len: number) => Promise<Buffer>;
export const COOKIE = "sb_session";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 din

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [, salt, hex] = stored.split(":");
  if (!salt || !hex) return false;
  const hash = await scrypt(password, salt, 64);
  const expected = Buffer.from(hex, "hex");
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}

let cachedSecret: string | null = null;
async function secret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (cachedSecret) return cachedSecret;
  await getSettings();
  const doc = await Settings.findById("global").select("+authSecret").lean();
  if (doc?.authSecret) return (cachedSecret = doc.authSecret);
  const fresh = crypto.randomBytes(32).toString("hex");
  await Settings.updateOne({ _id: "global" }, { authSecret: fresh });
  return (cachedSecret = fresh);
}

export async function issueSession(res: Response, req: Request, user: { _id: unknown; email: string }) {
  const token = jwt.sign({ sub: String(user._id), email: user.email }, await secret(), { expiresIn: "7d" });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    maxAge: MAX_AGE_MS,
    path: "/",
  });
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE, { path: "/" });
}

export type AuthedRequest = Request & { user?: { id: string; email: string; name?: string | null } };

/** Cookie (ya Bearer header) se logged-in user — nahi to null */
export async function currentUser(req: Request) {
  const token = req.cookies?.[COOKIE] ?? (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, await secret()) as { sub: string; email: string };
    const user = await User.findById(payload.sub).lean();
    return user ? { id: String(user._id), email: user.email, name: user.name } : null; // user delete ho gaya to token bekaar
  } catch {
    return null;
  }
}

/** /api/admin/* ke aage lagta hai — login nahi to 401 */
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "Please log in" });
  req.user = user;
  next();
}
