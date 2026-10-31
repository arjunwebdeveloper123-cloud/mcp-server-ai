import type { Provider, ProviderContext } from "./types.js";
import { SERVICES, detectService, serviceLabel } from "../../company.js";

/*  Demo mode — koi AI nahi, koi API key nahi, bilkul free.
    Ek fixed step-by-step flow (state machine) jo keywords samajhta hai aur
    ASLI MCP tools chalata hai (get_services, save_lead, find_lead).
    Isse dashboard, MCP, webhooks, MongoDB — sab end-to-end test ho jata hai.

    Flow:
      services poocha   → get_services
      lead dena         → naam → phone → service → confirm → save_lead
      status poocha     → phone → find_lead
      meeting chahiye   → din → check_slots → time → naam → phone → confirm → book_meeting
      meeting cancel    → phone → my_bookings → confirm → cancel_meeting          */

type Stage =
  | "idle" | "ask_name" | "ask_phone" | "ask_service" | "confirm" | "status_phone"
  | "appt_date" | "appt_time" | "appt_name" | "appt_phone" | "appt_confirm"
  | "appt_cancel_phone" | "appt_cancel_pick" | "appt_cancel_confirm" | "appt_list_phone";
type Lead = { name?: string; phone?: string; service?: string };
type Appt = { date?: string; time?: string; slots?: string[]; name?: string; phone?: string };
type CancelState = { phone?: string; id?: string };
type DemoState = { stage?: Stage; lead?: Lead; appt?: Appt; cancel?: CancelState };

const APPT_STAGES: Stage[] = ["appt_date", "appt_time", "appt_name", "appt_phone", "appt_confirm"];
const CANCEL_STAGES: Stage[] = ["appt_cancel_phone", "appt_cancel_pick", "appt_cancel_confirm"];
const LEAD_STAGES: Stage[] = ["ask_name", "ask_phone", "ask_service", "confirm"];


const RX = {
  greeting: /^(hi+|hello+|hey+|helo|namaste|namaskar|good (morning|afternoon|evening))\b/,
  services: /(service|price|pricing|rate|cost|kitna|kitne|charges?|package|kya karte|kya dete|kya kya|offer)/,
  status: /(status|enquiry|inquiry|meri request|follow ?up|update)/,
  wantsLead: /(banwani|banwana|banana|chahiye|chaiye|want|need|interested|contact|call me)/,
  appointment: /(meeting|appointment|appoint|consultation|book (a )?call|call book|schedule|slot|milna|mulakat|\bdemo\b)/,
  apptCancel: /(\b(cancel|radd)\b.*\b(meeting|appointment|booking)\b|\b(meeting|appointment|booking)\b.*\b(cancel|radd)\b)/,
  myBookings: /\b(meri|my|mere)\b.*\b(meeting|appointment|booking)s?\b/,
  yes: /^(haan|han|ha|hn|yes|yeah|yep|y|ok|okay|theek|thik|sahi|correct|confirm|ji|bilkul|done)\b/,
  no: /^(nahi|nahin|nhi|no|nope|galat|wrong|change|badlo)\b/,
  cancel: /\b(cancel|chhodo|chodo|rehne do|stop|reset)\b/,
};

function findTool(ctx: ProviderContext, suffix: string) {
  return ctx.tools.find((t) => t.name.endsWith(`__${suffix}`))?.name;
}

function extractPhone(text: string) {
  const compact = text.replace(/(\d)[\s-](?=\d)/g, "$1");
  return compact.match(/(?:\+?91)?([6-9]\d{9})(?!\d)/)?.[1];
}

/** Service pehchano — naam se ("whatsapp api") ya list ke number se ("2") */
function extractService(lower: string, byNumber = false) {
  if (byNumber) {
    const n = Number(lower.trim().match(/^(\d)\b/)?.[1]);
    if (n >= 1 && n <= SERVICES.length) return SERVICES[n - 1].id;
  }
  return detectService(lower);
}

function cleanName(raw: string) {
  const n = raw
    .replace(/\s+(hai|hu|hoon|hun|h|here)\s*$/i, "")
    .replace(/[^a-zA-Zऀ-ॿ .]/g, "")
    .trim()
    .replace(/\s+/g, " ");
  if (n.length < 2 || n.length > 40) return undefined;
  return n.replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractName(text: string) {
  const m = text.match(/(?:mera naam|mera name|my name is|my name's|name is|naam|i am|i'm|this is|main)\s+(?:hai\s+)?([a-zA-Zऀ-ॿ][a-zA-Zऀ-ॿ .]{1,40}?)(?=\s+(?:hai|hu|hoon|hun|h)\b|[,.!\d]|$)/i);
  return m ? cleanName(m[1]) : undefined;
}

function formatServices(json: string) {
  try {
    const [data, ...rest] = json.split("\n\n"); // JSON + "All prices + GST…" line
    const list = JSON.parse(data) as { id: string; name: string; startingPrice?: string }[];
    return list.map((s) => `• ${s.name}${s.startingPrice ? ` — ${s.startingPrice}` : ""}`).join("\n") + (rest.length ? `\n\n${rest.join("\n\n")}` : "");
  } catch {
    return json;
  }
}

/* ───────── Date / time samajhna (India time) ───────── */
function todayIST() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const WEEKDAYS: [number, RegExp][] = [
  [0, /\b(sunday|sun|ravivar|raviwar|itvar|itwar)\b/],
  [1, /\b(monday|mon|somvar|somwar)\b/],
  [2, /\b(tuesday|tue|tues|mangalvar|mangalwar)\b/],
  [3, /\b(wednesday|wed|budhvar|budhwar)\b/],
  [4, /\b(thursday|thu|thurs|guruvar|guruwar|brihaspativar)\b/],
  [5, /\b(friday|fri|shukravar|shukrawar)\b/],
  [6, /\b(saturday|sat|shanivar|shaniwar)\b/],
];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function ymd(y: number, m: number, d: number) {
  const s = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const dt = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === s ? s : undefined;
}
/** Saal na diya ho to agla aane wala wahi din */
function upcoming(m: number, d: number, y?: number) {
  const today = todayIST();
  if (y) return ymd(y < 100 ? 2000 + y : y, m, d);
  const thisYear = Number(today.slice(0, 4));
  const a = ymd(thisYear, m, d);
  return a && a >= today ? a : ymd(thisYear + 1, m, d);
}

export function parseDate(lower: string) {
  const today = todayIST();
  if (/\b(parso|parson|day after tomorrow)\b/.test(lower)) return addDays(today, 2);
  if (/\b(kal|tomorrow|tmrw|tmw)\b/.test(lower)) return addDays(today, 1);
  if (/\b(aaj|today|abhi)\b/.test(lower)) return today;
  const iso = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return ymd(+iso[1], +iso[2], +iso[3]);
  const dm = lower.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (dm) return upcoming(+dm[2], +dm[1], dm[3] ? +dm[3] : undefined);
  const named = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  if (named) return upcoming(MONTHS.indexOf(named[2]) + 1, +named[1]);
  for (const [dow, rx] of WEEKDAYS) {
    if (!rx.test(lower)) continue;
    const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
    return addDays(today, (dow - todayDow + 7) % 7 || 7);
  }
  return undefined;
}

/** "4 baje", "4pm", "16:00", "shaam 5", "11:30 am" → "HH:MM". Bina am/pm ke 1–7 = shaam (office time) */
export function parseTime(lower: string, bareNumberOk: boolean) {
  let h: number | undefined;
  let m = 0;
  let mer: "am" | "pm" | undefined;
  const hm = lower.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/);
  const hSuffix = lower.match(/\b(\d{1,2})\s*(am|pm|baje|bje|o'?clock)\b/);
  const part = lower.match(/\b(subah|morning|dopahar|dopehar|afternoon|shaam|sham|evening)\s*(\d{1,2})\b/);
  const bare = bareNumberOk ? lower.match(/^\s*(\d{1,2})\s*$/) : null;
  if (hm) {
    h = +hm[1];
    m = +hm[2];
    mer = hm[3] as "am" | "pm" | undefined;
  } else if (hSuffix) {
    h = +hSuffix[1];
    if (hSuffix[2] === "am" || hSuffix[2] === "pm") mer = hSuffix[2];
  } else if (part) {
    h = +part[2];
    if (/subah|morning/.test(part[1])) mer = "am";
    else mer = "pm";
  } else if (bare) h = +bare[1];
  if (h === undefined || h > 23 || m > 59) return undefined;
  if (/\b(shaam|sham|evening|dopahar|dopehar|afternoon)\b/.test(lower) && h < 12) mer = "pm";
  if (mer === "pm" && h < 12) h += 12;
  else if (mer === "am" && h === 12) h = 0;
  else if (!mer && h >= 1 && h <= 7) h += 12;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function prettyDate(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const label = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(d);
  const today = todayIST();
  return date === today ? `aaj (${label})` : date === addDays(today, 1) ? `kal (${label})` : label;
}
function pretty12(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
/** Maange gaye time ke sabse paas wale slots (time ke order me) */
function nearest(slots: string[], wanted: string, n = 6) {
  const min = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
  return [...slots]
    .sort((a, b) => Math.abs(min(a) - min(wanted)) - Math.abs(min(b) - min(wanted)))
    .slice(0, n)
    .sort();
}
function parseSlots(output: string) {
  const list = output.split("): ")[1];
  return output.startsWith("Free slots") && list ? list.split(",").map((s) => s.trim()).filter(Boolean) : [];
}
function strictName(text: string) {
  const m = text.match(/(?:mera naam|mera name|my name is|my name's|name is)\s+([a-zA-Z\u0900-\u097F][a-zA-Z\u0900-\u097F .]{1,40}?)(?=\s+(?:hai|hu|hoon|hun|h)\b|[,.!\d]|$)/i);
  return m ? cleanName(m[1]) : undefined;
}

const SERVICE_PROMPT = `Aapko kaunsi service chahiye? Number ya naam likhein:\n${SERVICES.map((s, i) => `${i + 1}. ${s.short}`).join("\n")}`;

export const demoProvider: Provider = {
  name: "demo",
  async reply(ctx) {
    const text = ctx.history[ctx.history.length - 1]?.content.trim() ?? "";
    const lower = text.toLowerCase();
    const st = ctx.state as DemoState;
    const stage: Stage = st.stage ?? "idle";
    const lead: Lead = { ...(st.lead ?? {}) };
    const set = (s: Stage, l: Lead = lead) => {
      st.stage = s;
      st.lead = l;
    };
    const resetAll = () => {
      st.stage = "idle";
      st.lead = {};
      st.appt = undefined;
      st.cancel = undefined;
    };

    /* ── Meeting cancel (generic "cancel" se pehle) ── */
    if (CANCEL_STAGES.includes(stage) || RX.apptCancel.test(lower)) return cancelFlow(ctx, text, lower, st, stage, resetAll);

    /* ── Meri bookings ── */
    if (stage === "appt_list_phone" || (RX.myBookings.test(lower) && !LEAD_STAGES.includes(stage) && !APPT_STAGES.includes(stage))) {
      const tool = findTool(ctx, "my_bookings");
      if (!tool) return "Booking check karne wala tool abhi band hai (dashboard → MCP servers me Appointment server on karein).";
      const phone = extractPhone(text);
      if (!phone) {
        st.stage = "appt_list_phone";
        return "Booking jis number se ki thi, wo 10-digit mobile number batayein.";
      }
      resetAll();
      const r = await ctx.runTool(tool, { phone });
      return r.isError ? `Bookings check nahi ho payi: ${r.output}` : /^No upcoming/.test(r.output) ? "Is number par koi upcoming meeting nahi hai." : `Aapki meetings:\n${r.output}`;
    }

    /* ── Meeting book karna ── */
    if (APPT_STAGES.includes(stage) || (RX.appointment.test(lower) && !LEAD_STAGES.includes(stage)))
      return bookingFlow(ctx, text, lower, st, stage, resetAll);

    /* ── Cancel kabhi bhi ── */
    if (RX.cancel.test(lower)) {
      resetAll();
      return "Theek hai, cancel kar diya. Aur kisi cheez me madad chahiye to batayein.";
    }

    /* ── Status lookup ── */
    if (stage === "status_phone" || (RX.status.test(lower) && !["ask_name", "ask_phone", "ask_service", "confirm"].includes(stage))) {
      const phone = extractPhone(text);
      if (!phone) {
        set("status_phone");
        return "Apna 10-digit mobile number batayein, main aapki enquiry check karta hoon.";
      }
      const tool = findTool(ctx, "find_lead");
      set("idle", {});
      if (!tool) return "Enquiry check karne wala tool abhi band hai (dashboard → MCP servers me find_lead on karein).";
      const r = await ctx.runTool(tool, { phone });
      return r.isError ? `Enquiry check nahi ho payi: ${r.output}` : `Aapki enquiries:\n${r.output}`;
    }

    /* ── Confirm step ── */
    if (stage === "confirm") {
      const newPhone = extractPhone(text);
      const newService = extractService(lower);
      const newName = extractName(text);
      if (newPhone || newService || newName) {
        Object.assign(lead, newPhone && { phone: newPhone }, newService && { service: newService }, newName && { name: newName });
        set("confirm");
        return confirmText(lead);
      }
      if (RX.no.test(lower)) {
        set("ask_name", {});
        return "Koi baat nahi, dobara shuru karte hain. Aapka naam kya hai?";
      }
      if (!RX.yes.test(lower)) return `${confirmText(lead)}\n(Sahi ho to "haan" likhein, badalna ho to "nahi")`;

      const tool = findTool(ctx, "save_lead");
      if (!tool) {
        set("idle", {});
        return "Lead save karne wala tool abhi band hai (dashboard → MCP servers me save_lead on karein).";
      }
      const r = await ctx.runTool(tool, { name: lead.name, phone: lead.phone, service: lead.service });
      if (r.isError) {
        if (/phone/i.test(r.output)) {
          set("ask_phone", { ...lead, phone: undefined });
          return "Ye phone number sahi nahi lag raha. 10-digit mobile number dobara batayein.";
        }
        if (/name/i.test(r.output)) {
          set("ask_name", { ...lead, name: undefined });
          return "Naam thoda saaf batayein?";
        }
        set("idle", {});
        return `Lead save nahi ho payi: ${r.output}`;
      }
      set("idle", {});
      return /already exists/i.test(r.output)
        ? `${lead.name} ji, aapki ye enquiry pehle se hamare paas hai. Team jaldi contact karegi. 🙏`
        : `Shukriya ${lead.name} ji! Aapki enquiry save ho gayi. Hamari team 24 ghante me ${lead.phone} par contact karegi. 🙏`;
    }

    /* ── Services / pricing ── */
    const collecting = ["ask_name", "ask_phone", "ask_service"].includes(stage);
    if (RX.services.test(lower) && !extractPhone(text)) {
      const tool = findTool(ctx, "get_services");
      let list = SERVICES.map((s) => `• ${s.name}`).join("\n");
      if (tool) {
        const r = await ctx.runTool(tool, {});
        if (!r.isError) list = formatServices(r.output);
      }
      const tail = collecting ? `\n\n${nextQuestion(lead) ?? ""}` : "\n\nKisi service me interest ho to batayein, main details le leta hoon.";
      return `Hum ye services dete hain:\n${list}${tail}`;
    }

    /* ── Lead collect karna ── */
    const svc = extractService(lower, stage === "ask_service");
    const phone = extractPhone(text);
    let name = extractName(text);
    // "Aapka naam?" ke jawab me sirf naam likha ho
    if (!name && stage === "ask_name" && !phone && !svc && !/\d/.test(text)) name = cleanName(text);

    if (collecting || svc || phone || name || RX.wantsLead.test(lower)) {
      Object.assign(lead, name && { name }, phone && { phone }, svc && { service: svc });
      if (stage === "ask_phone" && !phone && /\d/.test(text)) {
        set("ask_phone");
        return "Ye number sahi nahi lag raha. 10-digit mobile number batayein (jaise 9876543210).";
      }
      const q = nextQuestion(lead);
      if (q) {
        set(!lead.name ? "ask_name" : !lead.phone ? "ask_phone" : "ask_service");
        const prefix = svc && !collecting ? `Bilkul, ${labelOf(svc)} me hum madad karenge! ` : "";
        return prefix + q;
      }
      set("confirm");
      return confirmText(lead);
    }

    /* ── Uploaded files se jawab (knowledge base) ── */
    const top = ctx.knowledge[0];
    if (top && !RX.greeting.test(lower)) {
      const body = top.text.length > 700 ? `${top.text.slice(0, 700).replace(/\s+\S*$/, "")}…` : top.text;
      return `${body}\n\nAur kuch jaanna ho to poochiye. Enquiry ya meeting ke liye "mujhe bulk WhatsApp chahiye" ya "demo book karna hai" likhein.`;
    }

    /* ── Greeting / fallback ── */
    if (RX.greeting.test(lower))
      return `Namaste! 👋 Main ${ctx.settings.botName} hoon. Aap services/pricing pooch sakte hain, apni requirement share kar sakte hain, free demo book kar sakte hain, ya purani enquiry ka status check kar sakte hain.`;

    return 'Main aapki in cheezon me madad kar sakta hoon:\n• Services aur pricing ("aap kya services dete ho?")\n• Nayi enquiry ("mujhe bulk SMS chahiye")\n• Free demo / meeting book karna ("kal 4 baje demo chahiye")\n• Enquiry status ("meri enquiry ka status")';
  },
};

function nextQuestion(lead: Lead) {
  if (!lead.name) return "Aapka naam kya hai?";
  if (!lead.phone) return `Shukriya ${lead.name} ji! Aapka 10-digit mobile number batayein.`;
  if (!lead.service) return SERVICE_PROMPT;
  return undefined;
}

function labelOf(id?: string) {
  return serviceLabel(id);
}

function confirmText(l: Lead) {
  return `Please confirm karein:\nNaam: ${l.name}\nPhone: ${l.phone}\nService: ${labelOf(l.service)}\n\nSab sahi hai? (haan / nahi)`;
}

/* ═════════════════════ Meeting booking flow ═════════════════════ */
async function bookingFlow(ctx: ProviderContext, text: string, lower: string, st: DemoState, stage: Stage, resetAll: () => void) {
  const checkTool = findTool(ctx, "check_slots");
  const bookTool = findTool(ctx, "book_meeting");
  if (!checkTool || !bookTool) {
    resetAll();
    return "Meeting booking abhi available nahi hai. (Dashboard → MCP servers me Appointment server on karein.)";
  }
  const appt: Appt = { ...(st.appt ?? {}) };
  const save = (s: Stage) => {
    st.stage = s;
    st.appt = appt;
  };

  /* Confirm step */
  if (stage === "appt_confirm") {
    if (RX.no.test(lower)) {
      appt.date = appt.time = undefined;
      appt.slots = undefined;
      save("appt_date");
      return "Koi baat nahi. Kis din meeting chahiye?";
    }
    if (!RX.yes.test(lower)) return `${apptConfirm(appt)}\n(Sahi ho to "haan" likhein, badalna ho to "nahi")`;
    const r = await ctx.runTool(bookTool, { name: appt.name, phone: appt.phone, date: appt.date, time: appt.time });
    if (r.isError) {
      if (/taken|not a valid slot/i.test(r.output)) {
        appt.time = undefined;
        appt.slots = undefined;
        save("appt_time");
        const again = await ctx.runTool(checkTool, { date: appt.date });
        appt.slots = parseSlots(again.output);
        st.appt = appt;
        return appt.slots.length
          ? `Ye slot abhi kisi aur ne le liya. ${prettyDate(appt.date!)} ke khaali slots:\n${appt.slots.slice(0, 10).map(pretty12).join(", ")}\nKaunsa chahiye?`
          : "Us din ab koi slot khaali nahi. Koi aur din batayein?";
      }
      if (/phone/i.test(r.output)) {
        appt.phone = undefined;
        save("appt_phone");
        return "Ye phone number sahi nahi lag raha. 10-digit mobile number batayein.";
      }
      resetAll();
      return `Booking nahi ho payi: ${r.output}`;
    }
    resetAll();
    const id = r.output.match(/APT-[A-Z0-9]+/)?.[0];
    if (/already has a meeting/i.test(r.output)) return `${appt.name} ji, is number par us din pehle se ek meeting hai${id ? ` (booking id ${id})` : ""}.`;
    return `Ho gaya ${appt.name} ji! ✅ Meeting ${prettyDate(appt.date!)} ko ${pretty12(appt.time!)} par book hai.\nBooking id: ${id ?? "—"}. Cancel karna ho to ye id aur apna number batayein.`;
  }

  /* Message se jo mila, wo bharo */
  const date = parseDate(lower);
  if (date && date !== appt.date) {
    appt.date = date;
    appt.time = undefined;
    appt.slots = undefined;
  }
  const phone = extractPhone(text);
  if (phone) appt.phone = phone;
  const named = strictName(text);
  if (named) appt.name = named;
  else if (stage === "appt_name" && !phone && !/\d/.test(text)) appt.name = cleanName(text);
  if (!appt.name && st.lead?.name) appt.name = st.lead.name;
  if (!appt.phone && st.lead?.phone) appt.phone = st.lead.phone;

  /* 1. Din */
  if (!appt.date) {
    save("appt_date");
    return stage === "appt_date"
      ? 'Din samajh nahi aaya. "kal", "parso", "monday" ya "28/10" jaise likhein.'
      : "Zaroor! Kis din meeting chahiye? (aaj, kal, parso ya koi date)";
  }

  /* 2. Us din ke khaali slots */
  if (!appt.slots) {
    const r = await ctx.runTool(checkTool, { date: appt.date });
    const slots = parseSlots(r.output);
    if (!slots.length) {
      const reason = /closed on/i.test(r.output) ? "us din office band rehta hai" : /past/i.test(r.output) ? "wo din beet chuka hai" : /days ahead/i.test(r.output) ? "itni aage ki booking abhi nahi hoti" : "us din koi slot khaali nahi hai";
      appt.date = undefined;
      save("appt_date");
      return `Maaf kijiye, ${reason}. Koi aur din batayein?`;
    }
    appt.slots = slots;
  }

  /* 3. Time */
  const time = parseTime(lower, stage === "appt_time");
  if (time) {
    if (appt.slots.includes(time)) appt.time = time;
    else {
      save("appt_time");
      return `${pretty12(time)} khaali nahi hai. Uske aas-paas ke khaali slots:\n${nearest(appt.slots, time).map(pretty12).join(", ")}\nInme se koi chalega?`;
    }
  }
  if (!appt.time) {
    save("appt_time");
    if (stage === "appt_time") return `Time samajh nahi aaya. Inme se ek chuniye:\n${appt.slots.slice(0, 10).map(pretty12).join(", ")}`;
    return `${prettyDate(appt.date)} ko ye slots khaali hain:\n${appt.slots.slice(0, 10).map(pretty12).join(", ")}${appt.slots.length > 10 ? " …" : ""}\nKaunsa time chahiye?`;
  }

  /* 4. Naam, 5. Phone */
  if (!appt.name) {
    save("appt_name");
    return "Meeting kis naam se book karun?";
  }
  if (!appt.phone) {
    save("appt_phone");
    return stage === "appt_phone" && /\d/.test(text)
      ? "Ye number sahi nahi lag raha. 10-digit mobile number batayein (jaise 9876543210)."
      : `Shukriya ${appt.name} ji! Aapka 10-digit mobile number batayein.`;
  }

  /* 6. Confirm */
  save("appt_confirm");
  return apptConfirm(appt);
}

function apptConfirm(a: Appt) {
  return `Please confirm karein:\nNaam: ${a.name}\nPhone: ${a.phone}\nMeeting: ${prettyDate(a.date!)}, ${pretty12(a.time!)}\n\nBook kar dun? (haan / nahi)`;
}

/* ═════════════════════ Meeting cancel flow ═════════════════════ */
async function cancelFlow(ctx: ProviderContext, text: string, lower: string, st: DemoState, stage: Stage, resetAll: () => void) {
  const listTool = findTool(ctx, "my_bookings");
  const cancelTool = findTool(ctx, "cancel_meeting");
  if (!listTool || !cancelTool) {
    resetAll();
    return "Booking cancel karne wala tool abhi band hai. (Dashboard → MCP servers me Appointment server on karein.)";
  }
  const c: CancelState = { ...(st.cancel ?? {}) };
  const save = (s: Stage) => {
    st.stage = s;
    st.cancel = c;
  };

  if (stage === "appt_cancel_confirm" && RX.no.test(lower)) {
    resetAll();
    return "Theek hai, booking cancel nahi ki. Aur kuch madad chahiye?";
  }
  const id = text.match(/APT-[A-Z0-9]{4,8}/i)?.[0]?.toUpperCase();
  if (id) c.id = id;
  const phone = extractPhone(text);
  if (phone) c.phone = phone;

  if (!c.phone) {
    save("appt_cancel_phone");
    return stage === "appt_cancel_phone" ? "10-digit mobile number batayein (jaise 9876543210)." : "Booking jis number se ki thi, wo 10-digit mobile number batayein.";
  }

  if (!c.id) {
    const r = await ctx.runTool(listTool, { phone: c.phone });
    const active = r.output.split("\n").filter((l) => /— booked/.test(l));
    if (r.isError || !active.length) {
      resetAll();
      return "Is number par koi upcoming booking nahi mili.";
    }
    if (active.length > 1) {
      save("appt_cancel_pick");
      return `Kaunsi booking cancel karni hai? Booking id likhein:\n${active.join("\n")}`;
    }
    c.id = active[0].match(/APT-[A-Z0-9]+/)?.[0];
  }

  if (stage !== "appt_cancel_confirm" || !RX.yes.test(lower)) {
    save("appt_cancel_confirm");
    return `Booking ${c.id} cancel kar dun? (haan / nahi)`;
  }

  const r = await ctx.runTool(cancelTool, { bookingId: c.id, phone: c.phone });
  resetAll();
  return r.isError ? `Cancel nahi ho payi: ${r.output}` : `Booking ${c.id} cancel kar di gayi. Dobara book karni ho to bata dijiye. 🙏`;
}
