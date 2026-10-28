/*  Slot ka saara hisaab (business hours, din band hai ya nahi, beet chuka time)
    Sab kuch India time (Asia/Kolkata) me. Dates "YYYY-MM-DD", times "HH:MM" (24-hour).  */

const env = (k: string, d: string) => process.env[k]?.trim() || d;

export const CONFIG = {
  open: env("OPEN_TIME", "10:00"),
  close: env("CLOSE_TIME", "19:00"),
  slotMinutes: Math.max(10, Number(env("SLOT_MINUTES", "30")) || 30),
  closedDays: env("CLOSED_DAYS", "0")
    .split(",")
    .map((d) => Number(d.trim()))
    .filter((d) => d >= 0 && d <= 6),
  maxDaysAhead: Math.max(1, Number(env("MAX_DAYS_AHEAD", "30")) || 30),
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
export const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Abhi India me kya date/time hai */
export function nowIST() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayName(date: string) {
  return DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

export function isValidDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** Us din ke saare slots (booked ho ya nahi) — ya kyun nahi mil sakte */
export function slotsFor(date: string): { slots: string[]; reason?: string } {
  if (!isValidDate(date)) return { slots: [], reason: `"${date}" is not a valid date. Use YYYY-MM-DD.` };
  const today = nowIST();
  if (date < today.date) return { slots: [], reason: `${date} is in the past.` };
  if (date > addDays(today.date, CONFIG.maxDaysAhead)) return { slots: [], reason: `Bookings are open only ${CONFIG.maxDaysAhead} days ahead.` };
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (CONFIG.closedDays.includes(dow)) return { slots: [], reason: `We are closed on ${DAY_NAMES[dow]}.` };

  const out: string[] = [];
  for (let m = toMin(CONFIG.open); m + CONFIG.slotMinutes <= toMin(CONFIG.close); m += CONFIG.slotMinutes) {
    // Aaj ke liye: kam se kam 30 minute baad ka slot hi do
    if (date === today.date && m < today.minutes + 30) continue;
    out.push(toHHMM(m));
  }
  return out.length ? { slots: out } : { slots: [], reason: `No more slots left on ${date}.` };
}

export function hoursText() {
  const closed = CONFIG.closedDays.map((d) => DAY_NAMES[d]).join(", ") || "none";
  return `Open ${CONFIG.open}–${CONFIG.close} IST, ${CONFIG.slotMinutes}-minute meetings. Closed: ${closed}. Bookings up to ${CONFIG.maxDaysAhead} days ahead.`;
}
