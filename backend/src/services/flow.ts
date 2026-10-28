import { parseDate, parseTime } from "./providers/demo.js";

/*  Flow engine — dashboard ke Flow builder (boxes + arrows) ko chalata hai.

    Box types:
      start      → yahin se shuru
      message    → bot ka fixed message
      question   → kuch poochho, validate karo, variable me save ({{name}})
      buttons    → options dikhao; jo chuna us arrow par jao
      condition  → variable check karo; "true" / "false" arrow
      ai         → LLM se jawab (uploaded knowledge + MCP tools ke saath)
      tool       → koi MCP tool chalao; "success" / "error" arrow
      webhook    → kisi URL par variables POST karo
      handoff    → baat team ko saunp do (conversation "Needs human")
      end        → khatam; agla message flow dobara shuru karega

    Conversation ka state (kaunse box par ruke hain, variables) MongoDB me conversation.state.flow me rehta hai. */

export type NodeType = "start" | "message" | "question" | "buttons" | "condition" | "ai" | "tool" | "webhook" | "handoff" | "end";
export type FlowNode = { id: string; type: NodeType; position?: { x: number; y: number }; data: Record<string, unknown> };
export type FlowEdge = { id: string; source: string; target: string; sourceHandle?: string | null };
export type FlowDoc = { _id: unknown; name: string; nodes: FlowNode[]; edges: FlowEdge[] };

type ButtonOption = { id: string; label: string; value?: string };
type FlowState = {
  flowId: string;
  nodeId?: string;
  waiting?: "question" | "buttons" | "ai";
  vars: Record<string, string>;
  handoff?: boolean;
};

export type FlowRunContext = {
  flow: FlowDoc;
  text: string;
  state: Record<string, unknown>; // conversation.state (isme "flow" key)
  sessionId: string;
  channel: string;
  askAI: (instruction: string, vars: Record<string, string>) => Promise<string>;
  runTool: (name: string, input: Record<string, unknown>) => Promise<{ output: string; isError: boolean }>;
  emitHandoff: (vars: Record<string, string>) => void;
};

export type FlowResult = { reply: string; quickReplies?: string[]; needsHuman?: boolean; trace: string[] };

const MAX_STEPS = 30; // galti se bana loop (A → B → A) atak na jaaye

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export function interpolate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => vars[k] ?? "");
}

/* ───────────── Question validation ───────────── */
const VALIDATORS: Record<string, { check: (t: string) => string | null; error: string }> = {
  text: { check: (t) => (t.trim() ? t.trim().slice(0, 500) : null), error: "Kripya jawab likhein." },
  name: {
    check: (t) => {
      const n = t
        .replace(/^(mera naam|my name is|name is|i am|main)\s+/i, "")
        .replace(/\s+(hai|hu|hoon|h)\s*$/i, "")
        .replace(/[^a-zA-Zऀ-ॿ .]/g, "")
        .trim()
        .replace(/\s+/g, " ");
      return n.length >= 2 && n.length <= 40 ? n.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
    },
    error: "Naam samajh nahi aaya. Kripya apna naam likhein.",
  },
  phone: {
    check: (t) => t.replace(/(\d)[\s-](?=\d)/g, "$1").match(/(?:\+?91)?([6-9]\d{9})(?!\d)/)?.[1] ?? null,
    error: "Ye number sahi nahi lag raha. 10-digit mobile number likhein (jaise 9876543210).",
  },
  email: { check: (t) => t.match(/[^\s@]+@[^\s@]+\.[^\s@]+/)?.[0]?.toLowerCase() ?? null, error: "Sahi email likhein (jaise naam@gmail.com)." },
  number: { check: (t) => t.match(/-?\d+(\.\d+)?/)?.[0] ?? null, error: "Kripya ek number likhein." },
  date: { check: (t) => parseDate(t.toLowerCase()) ?? null, error: 'Din samajh nahi aaya. "kal", "monday" ya "28/10" jaise likhein.' },
  time: { check: (t) => parseTime(t.toLowerCase(), true) ?? null, error: 'Time samajh nahi aaya. "4 baje" ya "16:30" jaise likhein.' },
};

function matchOption(options: ButtonOption[], text: string) {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  const idx = Number(t);
  if (Number.isInteger(idx) && idx >= 1 && idx <= options.length) return options[idx - 1];
  return (
    options.find((o) => o.label.toLowerCase() === t) ??
    options.find((o) => (o.value ?? "").toLowerCase() === t) ??
    options.find((o) => o.label.toLowerCase().startsWith(t) || t.includes(o.label.toLowerCase()))
  );
}

function evalCondition(data: Record<string, unknown>, vars: Record<string, string>) {
  const left = (vars[str(data.variable)] ?? "").trim();
  const right = interpolate(str(data.value), vars).trim();
  switch (str(data.operator) || "equals") {
    case "equals":
      return left.toLowerCase() === right.toLowerCase();
    case "not_equals":
      return left.toLowerCase() !== right.toLowerCase();
    case "contains":
      return left.toLowerCase().includes(right.toLowerCase());
    case "is_set":
      return left.length > 0;
    case "is_empty":
      return left.length === 0;
    default:
      return false;
  }
}

/* ───────────── Run ───────────── */
export async function runFlow(ctx: FlowRunContext): Promise<FlowResult> {
  const { flow } = ctx;
  const nodes = new Map(flow.nodes.map((n) => [n.id, n]));
  const flowId = String(flow._id);
  const trace: string[] = [];
  const out: string[] = [];
  let quickReplies: string[] | undefined;

  let fs = ctx.state.flow as FlowState | undefined;
  if (!fs || fs.flowId !== flowId || (fs.nodeId && !nodes.has(fs.nodeId))) fs = { flowId, vars: {} };
  ctx.state.flow = fs;
  fs.vars.lastMessage = ctx.text;

  const label = (n: FlowNode) => str(n.data.label) || n.type;
  const nextOf = (id: string, handle?: string) =>
    flow.edges.find((e) => e.source === id && (handle ? e.sourceHandle === handle : !e.sourceHandle || e.sourceHandle === "next"))?.target;
  const finish = (r: Omit<FlowResult, "trace">): FlowResult => ({ ...r, reply: out.join("\n\n").trim() || r.reply, trace });
  const resetFlow = () => {
    fs!.nodeId = undefined;
    fs!.waiting = undefined;
    fs!.vars = {};
  };

  /* Team ko saunp diya tha → bot chup, sirf ek line */
  if (fs.handoff) return { reply: "Aapka message team tak pahunch gaya hai. Hamari team jaldi aapse baat karegi. 🙏", trace: ["handoff (waiting for team)"] };

  let current: string | undefined;

  /* 1. Pichhle message par kisi box par ruke the? */
  const waitingNode = fs.nodeId ? nodes.get(fs.nodeId) : undefined;
  if (fs.waiting && waitingNode) {
    const d = waitingNode.data;
    if (fs.waiting === "question") {
      const v = VALIDATORS[str(d.validation) || "text"] ?? VALIDATORS.text;
      const value = v.check(ctx.text);
      if (value === null) {
        trace.push(`${label(waitingNode)}: invalid answer`);
        return { reply: str(d.errorMessage) || v.error, trace };
      }
      if (str(d.variable)) fs.vars[str(d.variable)] = value;
      trace.push(`${label(waitingNode)}: saved {{${str(d.variable)}}} = ${value}`);
      current = nextOf(waitingNode.id);
    } else if (fs.waiting === "buttons") {
      const options = (d.options as ButtonOption[] | undefined) ?? [];
      const picked = matchOption(options, ctx.text);
      if (!picked) {
        // Customer ne button ki jagah apna sawaal likha → AI jawab de, phir wahi buttons
        if (str(d.fallback) === "ai") {
          trace.push(`${label(waitingNode)}: no option matched → AI answer`);
          const answer = await ctx.askAI("The customer typed a question instead of choosing an option. Answer it briefly.", fs.vars);
          return {
            reply: `${answer}\n\n${interpolate(str(d.text) || "Aage kya karna chahenge?", fs.vars)}`,
            quickReplies: options.map((o) => o.label),
            trace,
          };
        }
        trace.push(`${label(waitingNode)}: no option matched`);
        return { reply: "Kripya neeche diye options me se ek chuniye:", quickReplies: options.map((o) => o.label), trace };
      }
      if (str(d.variable)) fs.vars[str(d.variable)] = picked.value || picked.label;
      trace.push(`${label(waitingNode)}: picked "${picked.label}"`);
      current = nextOf(waitingNode.id, picked.id);
    } else if (fs.waiting === "ai") {
      // "Keep chatting" mode: exit words par agle box par jao, warna AI jawab dega
      const exits = str(d.exitKeywords)
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (exits.some((w) => ctx.text.trim().toLowerCase() === w || ctx.text.toLowerCase().includes(w)) && nextOf(waitingNode.id)) {
        trace.push(`${label(waitingNode)}: exit keyword`);
        current = nextOf(waitingNode.id);
      } else {
        trace.push(`${label(waitingNode)}: AI reply`);
        out.push(await ctx.askAI(interpolate(str(d.instruction), fs.vars), fs.vars));
        return finish({ reply: "" });
      }
    }
    fs.waiting = undefined;
    fs.nodeId = undefined;
  } else {
    /* 2. Naya flow — Start box se */
    const start = flow.nodes.find((n) => n.type === "start");
    if (!start) return { reply: "", trace: ["no start box"] };
    trace.push("Start");
    current = nextOf(start.id);
  }

  /* 3. Boxes chalao jab tak koi box jawab ka intezaar na kare */
  for (let step = 0; current && step < MAX_STEPS; step++) {
    const node = nodes.get(current);
    if (!node) break;
    const d = node.data;
    trace.push(label(node));

    switch (node.type) {
      case "start":
        current = nextOf(node.id);
        break;

      case "message":
        if (str(d.text)) out.push(interpolate(str(d.text), fs.vars));
        current = nextOf(node.id);
        break;

      case "question":
        // Pehle se pata hai aur "skip if known" on hai → aage badho
        if (d.skipIfKnown && str(d.variable) && fs.vars[str(d.variable)]) {
          current = nextOf(node.id);
          break;
        }
        out.push(interpolate(str(d.text) || "Kripya batayein:", fs.vars));
        fs.waiting = "question";
        fs.nodeId = node.id;
        return finish({ reply: "" });

      case "buttons": {
        const options = (d.options as ButtonOption[] | undefined) ?? [];
        out.push(interpolate(str(d.text) || "Chuniye:", fs.vars));
        quickReplies = options.map((o) => o.label);
        fs.waiting = "buttons";
        fs.nodeId = node.id;
        return finish({ reply: "", quickReplies });
      }

      case "condition":
        current = nextOf(node.id, evalCondition(d, fs.vars) ? "true" : "false");
        break;

      case "ai": {
        // "Keep chatting" + intro: pehle intro dikhao, customer ke sawaal ka intezaar karo
        if (str(d.mode) === "chat" && str(d.intro)) {
          out.push(interpolate(str(d.intro), fs.vars));
          fs.waiting = "ai";
          fs.nodeId = node.id;
          return finish({ reply: "" });
        }
        out.push(await ctx.askAI(interpolate(str(d.instruction), fs.vars), fs.vars));
        if (str(d.mode) === "chat") {
          fs.waiting = "ai";
          fs.nodeId = node.id;
          return finish({ reply: "" });
        }
        current = nextOf(node.id);
        break;
      }

      case "tool": {
        const tool = str(d.tool);
        let args: Record<string, unknown> = {};
        try {
          const raw = interpolate(str(d.args) || "{}", fs.vars);
          args = JSON.parse(raw);
        } catch {
          fs.vars[str(d.resultVar) || "toolResult"] = "Tool arguments are not valid JSON";
          current = nextOf(node.id, "error") ?? nextOf(node.id);
          break;
        }
        const r = tool ? await ctx.runTool(tool, args) : { output: "No tool selected in this box", isError: true };
        fs.vars[str(d.resultVar) || "toolResult"] = r.output;
        trace.push(`${tool} → ${r.isError ? "error" : "success"}`);
        current = nextOf(node.id, r.isError ? "error" : "success") ?? nextOf(node.id);
        break;
      }

      case "webhook": {
        const url = interpolate(str(d.url), fs.vars);
        let status = "skipped";
        if (/^https?:\/\//.test(url)) {
          try {
            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json", "User-Agent": "MCP-Chatbot-Flow/1.0" },
              body: JSON.stringify({ event: "flow.webhook", box: label(node), sessionId: ctx.sessionId, channel: ctx.channel, variables: fs.vars, at: new Date().toISOString() }),
              signal: AbortSignal.timeout(8000),
            });
            status = String(res.status);
          } catch {
            status = "failed";
          }
        }
        fs.vars.webhookStatus = status;
        trace.push(`webhook → ${status}`);
        current = nextOf(node.id);
        break;
      }

      case "handoff":
        out.push(interpolate(str(d.text) || "Main aapko hamari team se jod raha hoon. Wo jaldi aapse baat karenge. 🙏", fs.vars));
        fs.handoff = true;
        ctx.emitHandoff(fs.vars);
        return finish({ reply: "", needsHuman: true });

      case "end":
        if (str(d.text)) out.push(interpolate(str(d.text), fs.vars));
        resetFlow();
        return finish({ reply: "" });
    }
  }

  // Aage koi arrow nahi → flow khatam, agla message phir Start se
  resetFlow();
  return finish({ reply: "" });
}

/* ───────────── Publish se pehle check ───────────── */
export function validateFlow(nodes: FlowNode[], edges: FlowEdge[], toolNames: string[]) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const starts = nodes.filter((n) => n.type === "start");
  if (starts.length !== 1) errors.push(starts.length ? "Only one Start box is allowed." : "Add a Start box.");
  const outgoing = (id: string) => edges.filter((e) => e.source === id);
  const incoming = (id: string) => edges.some((e) => e.target === id);
  for (const n of nodes) {
    const name = str(n.data.label) || n.type;
    if (n.type === "start" && !outgoing(n.id).length) errors.push("Connect the Start box to the first step.");
    if (n.type === "question" && !str(n.data.variable)) errors.push(`"${name}": choose a variable name to save the answer in.`);
    if (n.type === "buttons") {
      const opts = (n.data.options as ButtonOption[] | undefined) ?? [];
      if (!opts.length) errors.push(`"${name}": add at least one button.`);
      for (const o of opts) if (!edges.some((e) => e.source === n.id && e.sourceHandle === o.id)) warnings.push(`"${name}": button "${o.label}" is not connected.`);
    }
    if (n.type === "tool") {
      if (!str(n.data.tool)) errors.push(`"${name}": choose a tool.`);
      else if (!toolNames.includes(str(n.data.tool))) warnings.push(`"${name}": tool ${str(n.data.tool)} is not connected right now.`);
      try {
        JSON.parse(str(n.data.args).replace(/\{\{\s*[\w.]+\s*\}\}/g, "x") || "{}");
      } catch {
        errors.push(`"${name}": arguments must be valid JSON.`);
      }
    }
    if (n.type === "condition" && !str(n.data.variable)) errors.push(`"${name}": choose a variable to check.`);
    if (n.type !== "start" && !incoming(n.id)) warnings.push(`"${name}" is not connected from any box — it will never run.`);
  }
  return { errors, warnings };
}
