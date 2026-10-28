import { Router } from "express";
import { User } from "../models/index.js";
import { clearSession, currentUser, hashPassword, issueSession, requireAuth, verifyPassword, type AuthedRequest } from "../services/auth.js";
import { asyncH, HttpError } from "../http.js";
import { rateLimit } from "./core.js";

export const authRouter = Router();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Dashboard pehle yahi poochta hai: setup chahiye? login hai? */
authRouter.get(
  "/status",
  asyncH(async (req, res) => {
    const needsSetup = (await User.countDocuments()) === 0;
    const user = needsSetup ? null : await currentUser(req);
    res.json({ needsSetup, user });
  })
);

/** Pehli baar: admin account banao (sirf tab jab koi user na ho) */
authRouter.post(
  "/setup",
  rateLimit(10, 60_000),
  asyncH(async (req, res) => {
    if ((await User.countDocuments()) > 0) throw new HttpError(403, "Admin account already exists — please log in");
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const name = String(req.body?.name ?? "").trim().slice(0, 60);
    if (!EMAIL.test(email)) throw new HttpError(400, "Enter a valid email");
    if (password.length < 8) throw new HttpError(400, "Password must be at least 8 characters");
    const user = await User.create({ email, name, passwordHash: await hashPassword(password) });
    await issueSession(res, req, user);
    res.status(201).json({ user: { id: user._id, email: user.email, name: user.name } });
  })
);

authRouter.post(
  "/login",
  rateLimit(10, 60_000), // password guess karne se bachav
  asyncH(async (req, res) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const user = await User.findOne({ email }).select("+passwordHash");
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new HttpError(401, "Email or password is wrong");
    await issueSession(res, req, user);
    res.json({ user: { id: user._id, email: user.email, name: user.name } });
  })
);

authRouter.post("/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

/** Password badalna (login ke baad) */
authRouter.post(
  "/password",
  requireAuth,
  asyncH(async (req: AuthedRequest, res) => {
    const current = String(req.body?.current ?? "");
    const next = String(req.body?.next ?? "");
    if (next.length < 8) throw new HttpError(400, "New password must be at least 8 characters");
    const user = await User.findById(req.user!.id).select("+passwordHash");
    if (!user || !(await verifyPassword(current, user.passwordHash))) throw new HttpError(400, "Current password is wrong");
    user.passwordHash = await hashPassword(next);
    await user.save();
    res.json({ ok: true });
  })
);
