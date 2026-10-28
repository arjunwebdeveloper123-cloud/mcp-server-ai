import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Appointment, connectDB, newBookingId } from "./db.js";
import { dayName, hoursText, nowIST, slotsFor } from "./slots.js";

/*  Appointment MCP server
    Tools:
      check_slots    → kisi din ke khaali time slots
      book_meeting   → slot book karo (naam, phone, date, time)
      cancel_meeting → booking id + phone se cancel
      my_bookings    → phone se aane wali bookings
    Resource:
      info://business-hours                                                  */

const server = new McpServer({ name: "appointment-server", version: "1.0.0" });

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], isError });

const PHONE = z.string().regex(/^[6-9]\d{9}$/, "Indian 10-digit mobile number");
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");
const TIME = z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM (24-hour)");

/** Us din ke booked times */
async function bookedTimes(date: string) {
  const rows = await Appointment.find({ date, status: "booked" }).select("time").lean();
  return new Set(rows.map((r) => r.time));
}

/* ───────────── check_slots ───────────── */
server.registerTool(
  "check_slots",
  {
    title: "Check free slots",
    description:
      "List free meeting slots for one date (India time). Call this before booking, and offer the customer a few of the returned times. Date format YYYY-MM-DD.",
    inputSchema: { date: DATE.describe("Day to check, YYYY-MM-DD") },
    annotations: { readOnlyHint: true },
  },
  async ({ date }) => {
    const { slots, reason } = slotsFor(date);
    if (!slots.length) return text(`No slots on ${date}: ${reason}`);
    const taken = await bookedTimes(date);
    const free = slots.filter((s) => !taken.has(s));
    if (!free.length) return text(`All slots on ${date} (${dayName(date)}) are booked. Suggest another day.`);
    return text(`Free slots on ${date} (${dayName(date)}): ${free.join(", ")}`);
  }
);

/* ───────────── book_meeting ───────────── */
server.registerTool(
  "book_meeting",
  {
    title: "Book meeting",
    description:
      "Book a meeting slot. Call ONLY after check_slots showed the time as free AND the customer confirmed name, phone, date and time. Returns a booking id to share with the customer.",
    inputSchema: {
      name: z.string().min(2).describe("Customer full name"),
      phone: PHONE.describe("10-digit mobile number"),
      date: DATE.describe("YYYY-MM-DD"),
      time: TIME.describe("HH:MM, 24-hour, exactly as returned by check_slots"),
      topic: z.string().max(200).optional().describe("What they want to discuss, e.g. new website"),
    },
  },
  async ({ name, phone, date, time, topic }) => {
    const { slots, reason } = slotsFor(date);
    if (!slots.length) return text(`Cannot book: ${reason}`, true);
    if (!slots.includes(time)) return text(`Cannot book: ${time} is not a valid slot on ${date}. Valid slots: ${slots.join(", ")}`, true);
    if ((await bookedTimes(date)).has(time)) return text(`Cannot book: ${date} ${time} was just taken. Call check_slots again.`, true);

    const already = await Appointment.findOne({ phone, date, status: "booked" }).lean();
    if (already) return text(`This phone already has a meeting on ${date} at ${already.time} (booking id ${already.bookingId}). No new booking made.`);

    const appt = await Appointment.create({ bookingId: newBookingId(), name, phone, date, time, topic });
    return text(`Meeting booked. Booking id: ${appt.bookingId}. ${name}, ${dayName(date)} ${date} at ${time} IST${topic ? ` — ${topic}` : ""}.`);
  }
);

/* ───────────── cancel_meeting ───────────── */
server.registerTool(
  "cancel_meeting",
  {
    title: "Cancel meeting",
    description: "Cancel a booking. Needs the booking id (APT-XXXXX) and the same phone number used to book. Ask the customer to confirm before cancelling.",
    inputSchema: {
      bookingId: z.string().regex(/^APT-[A-Z0-9]{4,8}$/i, "Booking id looks like APT-7K2QX").describe("Booking id"),
      phone: PHONE,
    },
    annotations: { destructiveHint: true },
  },
  async ({ bookingId, phone }) => {
    const appt = await Appointment.findOne({ bookingId: bookingId.toUpperCase() });
    if (!appt || appt.phone !== phone) return text("No booking found with this id and phone number.", true);
    if (appt.status === "cancelled") return text(`Booking ${appt.bookingId} was already cancelled.`);
    appt.status = "cancelled";
    await appt.save();
    return text(`Booking ${appt.bookingId} cancelled (${appt.date} at ${appt.time}).`);
  }
);

/* ───────────── my_bookings ───────────── */
server.registerTool(
  "my_bookings",
  {
    title: "My bookings",
    description: "List upcoming meetings for a phone number (today onwards).",
    inputSchema: { phone: PHONE },
    annotations: { readOnlyHint: true },
  },
  async ({ phone }) => {
    const today = nowIST().date;
    const rows = await Appointment.find({ phone, date: { $gte: today } }).sort({ date: 1, time: 1 }).limit(10).lean();
    if (!rows.length) return text("No upcoming meetings for this number.");
    return text(rows.map((r) => `${r.bookingId} — ${r.date} (${dayName(r.date)}) ${r.time} — ${r.status}${r.topic ? ` — ${r.topic}` : ""}`).join("\n"));
  }
);

/* ───────────── Resource ───────────── */
server.registerResource(
  "business-hours",
  "info://business-hours",
  { title: "Business hours", description: "When meetings can be booked", mimeType: "text/plain" },
  async (uri) => ({ contents: [{ uri: uri.href, text: hoursText() }] })
);

/* ───────────── Start ───────────── */
async function main() {
  await connectDB(process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/chatbot");
  await server.connect(new StdioServerTransport());
  console.error(`[appointment-server] running on stdio — ${hoursText()}`);
}

main().catch((err) => {
  console.error("[appointment-server] fatal:", err);
  process.exit(1);
});
