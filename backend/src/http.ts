import type { NextFunction, Request, Response, RequestHandler } from "express";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** async route handler ke errors ko error middleware tak pahunchata hai */
export const asyncH =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  const e = err as { name?: string; message?: string; code?: number };
  if (e?.name === "CastError") return res.status(400).json({ error: "Invalid id" });
  if (e?.name === "ValidationError") return res.status(400).json({ error: e.message });
  if (e?.code === 11000) return res.status(409).json({ error: "Duplicate value" });
  console.error("[backend] error:", err);
  res.status(500).json({ error: "Internal server error" });
}
