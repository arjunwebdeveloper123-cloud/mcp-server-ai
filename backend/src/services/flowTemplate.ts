import type { FlowEdge, FlowNode } from "./flow.js";
import { COMPANY, SERVICES } from "../company.js";

/** "Lead + demo" ready-made flow (company.ts ki services ke saath) — Flow builder me "Start from template" */
export function templateFlow(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const X = 320;
  const Y = 150;
  const n = (id: string, type: FlowNode["type"], col: number, row: number, data: Record<string, unknown>): FlowNode => ({
    id,
    type,
    position: { x: col * X, y: row * Y },
    data,
  });

  const nodes: FlowNode[] = [
    n("start", "start", 2, 0, { label: "Start" }),
    n("welcome", "message", 2, 1, {
      label: "Welcome",
      text: `Namaste! 👋 ${COMPANY.name} me aapka swagat hai. Hum Bulk WhatsApp, SMS, RCS, Voice Call aur Email messaging dete hain.`,
    }),
    n("menu", "buttons", 2, 2, {
      label: "Main menu",
      text: "Aap kis cheez me madad chahte hain?",
      variable: "choice",
      fallback: "ai",
      options: [
        { id: "svc", label: "Services ki jaankari" },
        { id: "enq", label: "Enquiry bhejni hai" },
        { id: "mtg", label: "Free demo book karna hai" },
        { id: "ask", label: "Kuch aur poochna hai" },
        { id: "human", label: "Team se baat karni hai" },
      ],
    }),

    // ── Services ──
    n("svc_ai", "ai", 0, 3, {
      label: "Explain services",
      mode: "once",
      responseSource: "knowledge_mcp", // company files + MCP tools (get_services / search_knowledge)
      selectedDocId: "all",
      enableMcp: true,
      instruction:
        "Briefly list our 8 messaging services with their starting prices (use the get_services tool or company knowledge). One short line per service, mention prices are + GST.",
    }),
    n("svc_next", "buttons", 0, 4, {
      label: "Enquiry?",
      text: "Kya aap enquiry bhejna chahenge?",
      options: [
        { id: "yes", label: "Haan, enquiry bhejni hai" },
        { id: "no", label: "Nahi, bas itna hi" },
      ],
    }),
    n("thanks_end", "end", 0, 5, { label: "Thanks", text: "Shukriya! Kabhi bhi \"hi\" likh ke dobara shuru kar sakte hain. 🙏" }),

    // ── Enquiry (lead) ──
    n("q_name", "question", 1, 5, { label: "Ask name", text: "Aapka naam kya hai?", variable: "name", validation: "name", skipIfKnown: true }),
    n("q_phone", "question", 1, 6, { label: "Ask phone", text: "Shukriya {{name}} ji! Aapka 10-digit mobile number batayein.", variable: "phone", validation: "phone", skipIfKnown: true }),
    n("q_service", "buttons", 1, 7, {
      label: "Which service",
      text: "Aapko kaunsi service chahiye?",
      variable: "service",
      options: SERVICES.map((s) => ({ id: s.id, label: s.short, value: s.id })),
    }),
    n("save_lead", "tool", 1, 8, {
      label: "Save lead",
      tool: "leads__save_lead",
      args: '{"name": "{{name}}", "phone": "{{phone}}", "service": "{{service}}"}',
      resultVar: "leadResult",
    }),
    n("lead_ok", "end", 1, 9, { label: "Lead saved", text: "Shukriya {{name}} ji! Aapki enquiry save ho gayi. Hamari team 24 ghante me {{phone}} par contact karegi. 🙏" }),
    n("lead_err", "end", 2, 9, { label: "Lead failed", text: "Maaf kijiye, enquiry save nahi ho payi. Kripya thodi der baad try karein." }),

    // ── Meeting ──
    n("q_date", "question", 3, 3, { label: "Ask day", text: "Free demo kis din chahiye? (aaj, kal, monday ya 28/10)", variable: "date", validation: "date" }),
    n("slots", "tool", 3, 4, { label: "Check slots", tool: "appointments__check_slots", args: '{"date": "{{date}}"}', resultVar: "slots" }),
    n("has_slots", "condition", 3, 5, { label: "Any free slot?", variable: "slots", operator: "contains", value: "Free slots" }),
    n("no_slots", "message", 4, 5, { label: "No slots", text: "Us din koi slot khaali nahi hai. Koi aur din batayein." }),
    n("show_slots", "message", 3, 6, { label: "Show slots", text: "{{slots}}" }),
    n("q_time", "question", 3, 7, { label: "Ask time", text: "Kaunsa time chahiye? (jaise 11 baje ya 16:30)", variable: "time", validation: "time" }),
    n("m_name", "question", 3, 8, { label: "Ask name", text: "Demo kis naam se book karun?", variable: "name", validation: "name", skipIfKnown: true }),
    n("m_phone", "question", 3, 9, { label: "Ask phone", text: "Aapka 10-digit mobile number?", variable: "phone", validation: "phone", skipIfKnown: true }),
    n("book", "tool", 3, 10, {
      label: "Book meeting",
      tool: "appointments__book_meeting",
      args: '{"name": "{{name}}", "phone": "{{phone}}", "date": "{{date}}", "time": "{{time}}", "topic": "Free demo"}',
      resultVar: "booking",
    }),
    n("book_ok", "end", 3, 11, { label: "Booked", text: "✅ Ho gaya! {{booking}}" }),
    n("book_err", "message", 4, 10, { label: "Slot problem", text: "Ye time book nahi ho paya. {{booking}}" }),

    // ── Free questions (AI + knowledge) ──
    n("ask_ai", "ai", 4, 3, {
      label: "Answer questions",
      mode: "chat",
      responseSource: "knowledge_mcp",
      selectedDocId: "all",
      enableMcp: true,
      exitKeywords: "menu",
      intro: "Zaroor! Apna sawaal likhiye. (Menu par wapas jaane ke liye \"menu\" likhein)",
      instruction: "Answer the customer's questions using the company knowledge. Keep it short. Tell them they can type 'menu' to see options again.",
    }),

    // ── Human ──
    n("handoff", "handoff", 5, 3, { label: "Hand to team", text: "Main aapko hamari team se jod raha hoon. Wo jaldi aapse baat karenge. 🙏" }),
  ];

  const e = (source: string, target: string, sourceHandle?: string): FlowEdge => ({
    id: `e-${source}-${sourceHandle ?? "next"}-${target}`,
    source,
    target,
    sourceHandle: sourceHandle ?? null,
  });

  const edges: FlowEdge[] = [
    e("start", "welcome"),
    e("welcome", "menu"),
    e("menu", "svc_ai", "svc"),
    e("menu", "q_name", "enq"),
    e("menu", "q_date", "mtg"),
    e("menu", "ask_ai", "ask"),
    e("menu", "handoff", "human"),
    e("svc_ai", "svc_next"),
    e("svc_next", "q_name", "yes"),
    e("svc_next", "thanks_end", "no"),
    e("q_name", "q_phone"),
    e("q_phone", "q_service"),
    ...SERVICES.map((sv) => e("q_service", "save_lead", sv.id)),
    e("save_lead", "lead_ok", "success"),
    e("save_lead", "lead_err", "error"),
    e("q_date", "slots"),
    e("slots", "has_slots", "success"),
    e("slots", "no_slots", "error"),
    e("has_slots", "show_slots", "true"),
    e("has_slots", "no_slots", "false"),
    e("no_slots", "q_date"),
    e("show_slots", "q_time"),
    e("q_time", "m_name"),
    e("m_name", "m_phone"),
    e("m_phone", "book"),
    e("book", "book_ok", "success"),
    e("book", "book_err", "error"),
    e("book_err", "q_time"),
    e("ask_ai", "menu"),
  ];
  return { nodes, edges };
}

/** Naya khaali flow — sirf Start box */
export function blankFlow(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  return { nodes: [{ id: "start", type: "start", position: { x: 0, y: 0 }, data: { label: "Start" } }], edges: [] };
}
