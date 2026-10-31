import { Router, type Response } from "express";
import { AppointmentRead, Conversation, LeadRead } from "../models/index.js";
import { serviceLabel } from "../company.js";
import { emit } from "../services/webhooks.js";
import { asyncH, HttpError } from "../http.js";

/*  Leads, Appointments ke dashboard pages + CSV export
    Data leads aur appointments MCP servers (backend/src/mcp-servers/) likhte hain (leads / appointments collections). */

export const dataRouter = Router();

const PAGE = 25;
const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD → createdAt filter (India time) */
function dateRange(q: Record<string, unknown>, field = "createdAt") {
  const f: Record<string, Date> = {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(q.from ?? ""))) f.$gte = new Date(`${q.from}T00:00:00+05:30`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(q.to ?? ""))) f.$lte = new Date(`${q.to}T23:59:59.999+05:30`);
  return Object.keys(f).length ? { [field]: f } : {};
}

/* ════════════ Leads ════════════ */
function leadQuery(q: Record<string, unknown>) {
  const filter: Record<string, unknown> = { ...dateRange(q) };
  if (["new", "contacted", "converted"].includes(String(q.status))) filter.status = String(q.status);
  const search = String(q.q ?? "").trim();
  if (search) {
    const rx = new RegExp(escapeRx(search), "i");
    filter.$or = [{ name: rx }, { phone: rx }, { email: rx }, { company: rx }, { service: rx }];
  }
  return filter;
}

dataRouter.get(
  "/leads",
  asyncH(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const filter = leadQuery(req.query);
    const [total, items, counts] = await Promise.all([
      LeadRead.countDocuments(filter),
      LeadRead.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE).limit(PAGE).lean(),
      LeadRead.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    ]);
    res.json({ total, page, pages: Math.max(1, Math.ceil(total / PAGE)), items, counts: Object.fromEntries(counts.map((c) => [c._id ?? "new", c.n])) });
  })
);

dataRouter.patch(
  "/leads/:id",
  asyncH(async (req, res) => {
    const status = String(req.body?.status ?? "");
    if (!["new", "contacted", "converted"].includes(status)) throw new HttpError(400, "Status must be new, contacted or converted");
    const r = await LeadRead.updateOne({ _id: req.params.id }, { $set: { status, updatedAt: new Date() } });
    if (!r.matchedCount) throw new HttpError(404, "Lead not found");
    res.json({ ok: true });
  })
);

/* ════════════ Appointments ════════════ */
const todayIST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

function apptQuery(q: Record<string, unknown>) {
  const filter: Record<string, unknown> = {};
  const when = String(q.when ?? "upcoming");
  if (when === "upcoming") filter.date = { $gte: todayIST() };
  if (when === "past") filter.date = { $lt: todayIST() };
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(q.from ?? "")) || /^\d{4}-\d{2}-\d{2}$/.test(String(q.to ?? ""))) {
    const d: Record<string, string> = {};
    if (q.from) d.$gte = String(q.from);
    if (q.to) d.$lte = String(q.to);
    filter.date = d;
  }
  if (["booked", "cancelled"].includes(String(q.status))) filter.status = String(q.status);
  const search = String(q.q ?? "").trim();
  if (search) {
    const rx = new RegExp(escapeRx(search), "i");
    filter.$or = [{ name: rx }, { phone: rx }, { bookingId: rx }, { topic: rx }];
  }
  return filter;
}

dataRouter.get(
  "/appointments",
  asyncH(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const filter = apptQuery(req.query);
    const upcoming = String(req.query.when ?? "upcoming") !== "past";
    const [total, items] = await Promise.all([
      AppointmentRead.countDocuments(filter),
      AppointmentRead.find(filter)
        .sort(upcoming ? { date: 1, time: 1 } : { date: -1, time: -1 })
        .skip((page - 1) * PAGE)
        .limit(PAGE)
        .lean(),
    ]);
    res.json({ total, page, pages: Math.max(1, Math.ceil(total / PAGE)), items });
  })
);

dataRouter.patch(
  "/appointments/:id",
  asyncH(async (req, res) => {
    const status = String(req.body?.status ?? "");
    if (!["booked", "cancelled"].includes(status)) throw new HttpError(400, "Status must be booked or cancelled");
    const appt = await AppointmentRead.findById(req.params.id).lean<{ bookingId?: string; date?: string; time?: string; phone?: string; status?: string }>();
    if (!appt) throw new HttpError(404, "Appointment not found");
    await AppointmentRead.updateOne({ _id: req.params.id }, { $set: { status, updatedAt: new Date() } });
    if (status === "cancelled" && appt.status !== "cancelled")
      emit("appointment.cancelled", { channel: "dashboard", bookingId: appt.bookingId, phone: appt.phone, date: appt.date, time: appt.time });
    res.json({ ok: true });
  })
);

/* ════════════ CSV export ════════════ */
function csvCell(v: unknown) {
  const s = v instanceof Date ? v.toISOString() : v == null ? "" : String(v);
  // Excel formula injection se bachav: = + - @ se shuru hone wali cell ke aage '
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
const istTime = (d?: unknown) =>
  d ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" }).format(new Date(String(d instanceof Date ? d.toISOString() : d))) : "";

function sendCsv(res: Response, filename: string, header: string[], rows: unknown[][]) {
  // ﻿ (BOM) → Excel Hindi / ₹ sahi dikhata hai
  const body = "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
}

const MAX_ROWS = 50_000;

dataRouter.get(
  "/export/:kind",
  asyncH(async (req, res) => {
    const kind = String(req.params.kind).replace(/\.csv$/, "");
    const stamp = todayIST();

    if (kind === "leads") {
      const rows = await LeadRead.find(leadQuery(req.query)).sort({ createdAt: -1 }).limit(MAX_ROWS).lean<Record<string, unknown>[]>();
      return sendCsv(
        res,
        `leads-${stamp}.csv`,
        ["Name", "Phone", "Email", "Company", "Service", "Monthly volume", "Message", "Status", "Created (IST)"],
        rows.map((l) => [l.name, l.phone, l.email, l.company, serviceLabel(l.service as string), l.volume, l.message, l.status ?? "new", istTime(l.createdAt)])
      );
    }

    if (kind === "appointments") {
      const rows = await AppointmentRead.find(apptQuery({ ...req.query, when: req.query.when ?? "all" })).sort({ date: -1, time: -1 }).limit(MAX_ROWS).lean<Record<string, unknown>[]>();
      return sendCsv(
        res,
        `appointments-${stamp}.csv`,
        ["Booking ID", "Name", "Phone", "Date", "Time (IST)", "Topic", "Status", "Booked at (IST)"],
        rows.map((a) => [a.bookingId, a.name, a.phone, a.date, a.time, a.topic, a.status, istTime(a.createdAt)])
      );
    }

    const convFilter: Record<string, unknown> = { ...dateRange(req.query) };
    if (["widget", "playground", "webhook"].includes(String(req.query.channel))) convFilter.channel = String(req.query.channel);

    if (kind === "conversations") {
      const rows = await Conversation.find(convFilter).sort({ createdAt: -1 }).limit(MAX_ROWS).lean();
      return sendCsv(
        res,
        `conversations-${stamp}.csv`,
        ["Session ID", "Channel", "Started (IST)", "Last active (IST)", "Messages", "First message", "Last message", "Lead saved", "Meeting booked", "Needs human"],
        rows.map((c) => {
          const msgs = c.messages ?? [];
          const tools = c.toolCalls ?? [];
          return [
            c.sessionId,
            c.channel,
            istTime(c.createdAt),
            istTime(c.updatedAt),
            msgs.length,
            msgs.find((m) => m.role === "user")?.content ?? "",
            msgs[msgs.length - 1]?.content ?? "",
            tools.some((t) => t.name?.endsWith("__save_lead") && !t.isError && /saved/i.test(t.output ?? "")) ? "yes" : "no",
            tools.some((t) => t.name?.endsWith("__book_meeting") && !t.isError && /booked/i.test(t.output ?? "")) ? "yes" : "no",
            c.needsHuman ? "yes" : "no",
          ];
        })
      );
    }

    if (kind === "messages") {
      // Har message ek row — poori chat history
      const rows = await Conversation.find(convFilter).sort({ createdAt: -1 }).limit(5000).lean();
      const out: unknown[][] = [];
      for (const c of rows) for (const m of c.messages ?? []) out.push([c.sessionId, c.channel, istTime(m.at), m.role === "user" ? "Customer" : "Bot", m.content]);
      return sendCsv(res, `chat-history-${stamp}.csv`, ["Session ID", "Channel", "Time (IST)", "From", "Message"], out.slice(0, MAX_ROWS));
    }

    throw new HttpError(404, "Unknown export. Use leads, appointments, conversations or messages");
  })
);
