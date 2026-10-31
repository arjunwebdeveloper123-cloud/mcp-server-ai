import { Conversation, Flow, getSettings } from "../models/index.js";
import { runFlow, type FlowDoc } from "./flow.js";
import { callTool, getClaudeTools } from "../mcp/manager.js";
import { emit, emitToolEvents } from "./webhooks.js";
import { getProvider } from "./providers/index.js";
import { executeNodeAi } from "./providers/nodeAi.js";
import { KNOWLEDGE_TOOL_PREFIX, knowledgeBlock, knowledgeToolPrompt, resolveKnowledgeMode, searchKnowledge, type KnowledgeHit } from "./knowledge.js";
import type { ChatTurn, RunTool } from "./providers/types.js";

export type ToolLog = { name: string; input: unknown; output: string; isError: boolean; durationMs?: number; at?: Date };

function nowLine() {
  const now = new Date();
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", ...o }).format(now);
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now); // YYYY-MM-DD
  return `Current date and time (India, IST): ${fmt({ weekday: "long" })}, ${ymd}, ${fmt({ hour: "2-digit", minute: "2-digit", hour12: false })}. Use YYYY-MM-DD dates and 24-hour HH:MM times when calling tools.`;
}

const HISTORY_LIMIT = 30; // AI ko last 30 messages bhejte hain

/*  Ek user message handle karo:
    conversation load → relevant knowledge → (published Flow  ya  AI provider) → MCP tools → reply → save → webhooks
    - Flow builder me koi flow "Published" hai to bot usi ke boxes follow karta hai (AI box me LLM)
    - Warna seedha AI provider (Claude / Free API / Demo) — Bot settings se            */
export async function handleMessage(sessionId: string, text: string, channel = "widget", opts: { testFlowId?: string; initialVars?: Record<string, string>; startNodeId?: string } = {}) {
  const settings = await getSettings();
  const provider = getProvider(settings.provider);

  let convo = await Conversation.findOne({ sessionId });
  const isNew = !convo;
  if (!convo) convo = new Conversation({ sessionId, channel, messages: [], toolCalls: [], state: {} });

  convo.messages.push({ role: "user", content: text, at: new Date() });
  if (isNew) emit("conversation.started", { sessionId, channel });
  emit("message.received", { sessionId, channel, text });

  const history: ChatTurn[] = convo.messages
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content ?? "" }));
  // History hamesha user message se shuru honi chahiye
  while (history.length && history[0].role !== "user") history.shift();

  const toolLog: ToolLog[] = [];

  // Provider jab bhi tool chalaye: MCP call + log + webhooks — sab yahin
  const runTool: RunTool = async (name, input) => {
    const at = new Date();
    let log: ToolLog;
    try {
      const out = await callTool(name, input);
      log = { name, input, output: out.text, isError: out.isError, durationMs: out.durationMs, at };
    } catch (err) {
      log = { name, input, output: err instanceof Error ? err.message : String(err), isError: true, at };
    }
    toolLog.push(log);
    // tool.called / tool.failed + lead.created / appointment.booked / appointment.cancelled
    emitToolEvents(name, input, log.output, log.isError, { sessionId, channel, durationMs: log.durationMs });
    return { output: log.output, isError: log.isError };
  };

  /* ── Knowledge: sirf is sawaal se jude tukde (poori file kabhi nahi) ──
     Lazy: tabhi search hota hai jab AI ko sach me jawab dena ho (flow ke question/buttons box par nahi) */
  const knowledgeCache = new Map<string, KnowledgeHit[]>();
  const getKnowledge = async (filterDocId?: string): Promise<KnowledgeHit[]> => {
    const cacheKey = filterDocId || "all";
    if (knowledgeCache.has(cacheKey)) return knowledgeCache.get(cacheKey)!;
    if (!settings.knowledgeEnabled && !filterDocId) return [];
    const userTurns = history.filter((m) => m.role === "user").map((m) => m.content);
    // Chhota follow-up ("aur price?") ho to pichhla sawaal bhi search me jodo
    const query = text.split(/\s+/).length < 4 && userTurns.length > 1 ? `${userTurns[userTurns.length - 2]} ${text}` : text;
    const hits = await searchKnowledge(query, {
      topK: settings.knowledgeTopK,
      maxChars: settings.knowledgeMaxChars,
      docId: filterDocId !== "all" ? filterDocId : undefined,
    });
    knowledgeCache.set(cacheKey, hits);
    if (hits.length)
      toolLog.push({
        name: "knowledge_search",
        input: { query, docId: filterDocId },
        output: `Sent ${hits.length} relevant part(s) from ${hits.map((k) => k.docName).join(", ")}: ${hits.map((k) => k.title).join(" | ")}`,
        isError: false,
        at: new Date(),
      });
    return hits;
  };

  const state = { ...((convo.state as Record<string, unknown>) ?? {}) };
  const allTools = getClaudeTools().map((t) => ({ name: t.name, description: t.description ?? t.name, input_schema: t.input_schema as Record<string, unknown> }));

  /* ── Files ka data AI tak kaise jaaye (Knowledge page → "How the AI gets your files") ──
     tool   → AI khud Knowledge MCP server ke tools call karke data maangta hai (agentic RAG)
     inject → backend har sawaal ke saath relevant hissa khud bhejta hai (purana tarika, har model ke saath chalta hai) */
  const knowledgeMode = resolveKnowledgeMode(settings.knowledgeMode, provider.name, {
    enabled: settings.knowledgeEnabled,
    toolAvailable: allTools.some((t) => t.name === `${KNOWLEDGE_TOOL_PREFIX}search_knowledge`),
  });
  // "tool" mode ke alawa knowledge tools AI ko mat dikhao — data do baar na jaaye
  const tools = knowledgeMode === "tool" ? allTools : allTools.filter((t) => !t.name.startsWith(KNOWLEDGE_TOOL_PREFIX));
  const toolHint = knowledgeMode === "tool" ? await knowledgeToolPrompt() : "";
  // Model tools hi nahi samajhta → backend khud relevant hissa bhej de (backup)
  const knowledgeFallback = async () => {
    const hits = await getKnowledge();
    toolLog.push({ name: "knowledge_fallback", input: {}, output: "This AI model can't use tools — file parts were sent automatically instead", isError: false, at: new Date() });
    return knowledgeBlock(hits);
  };
  const baseSettings = {
    model: settings.model,
    maxTokens: settings.maxTokens,
    maxToolRounds: settings.maxToolRounds,
    openaiBaseUrl: settings.openaiBaseUrl,
    openaiModel: settings.openaiModel,
    botName: settings.botName,
  };
  // Aaj ki date/time + sirf relevant knowledge — "kal 4 baje" aur company ke sawaal dono samajh sake
  const promptWith = (knowledge: KnowledgeHit[]) => `${settings.systemPrompt}\n\n${nowLine()}${knowledgeBlock(knowledge)}${toolHint}`;
  // inject mode me hi backend search kare; tool mode me AI khud maangega
  const injected = async () => (knowledgeMode === "inject" ? getKnowledge() : []);

  let reply = "";
  let quickReplies: string[] | undefined;
  // Flow builder ka "Test" panel draft flow chala sakta hai; warna published flow
  const flowId = opts.testFlowId ?? settings.activeFlowId;
  const flow = flowId ? await Flow.findById(flowId).lean() : null;

  try {
    if (flow) {
      /* ── Flow builder ka published flow ── */
      const result = await runFlow({
        flow: flow as unknown as FlowDoc,
        text,
        state,
        sessionId,
        channel,
        initialVars: opts.initialVars,
        startNodeId: opts.startNodeId,
        runTool,
        emitHandoff: (vars) => emit("conversation.handoff", { sessionId, channel, variables: vars, lastMessage: text }),
        // Flow ka "AI reply" box
        askAI: async (instruction, vars, nodeData) => {
          /* AI box ka "Response source":
             prompt_only   → sirf box ka prompt — na files, na MCP tools
             knowledge_mcp → company files + MCP tools
               · ek specific file chuni ho, ya box me MCP band ho → backend us file ka relevant hissa khud bhejta hai
               · "All files" + MCP on → Knowledge page ki setting (Auto / AI asks via MCP tool / Send automatically) */
          const responseSource = (nodeData?.responseSource as string) || "prompt_only";
          const isKnowledgeMcp = responseSource === "knowledge_mcp";
          const selectedDocId = (nodeData?.selectedDocId as string) || "all";
          const enableMcp = nodeData?.enableMcp !== false;

          let knowledge: KnowledgeHit[] = [];
          let mcpToolsDesc = "";
          let activeTools = enableMcp ? tools : [];
          let boxToolHint = "";
          let boxFallback: (() => Promise<string>) | undefined;

          if (isKnowledgeMcp) {
            const oneFile = selectedDocId !== "all";
            if (oneFile || !enableMcp) {
              // Ek file ka data (ya MCP band) → backend khud bhejta hai; knowledge tools AI ko nahi dikhte
              knowledge = await getKnowledge(oneFile ? selectedDocId : undefined);
              activeTools = activeTools.filter((t) => !t.name.startsWith(KNOWLEDGE_TOOL_PREFIX));
            } else {
              knowledge = await injected(); // tool mode me [] — AI khud search_knowledge call karega
              boxToolHint = toolHint;
              boxFallback = knowledgeFallback;
            }
            if (enableMcp && activeTools.length) {
              mcpToolsDesc = `\n\nConnected MCP Server Tools and capabilities:\n${activeTools.map((t) => `- ${t.name}: ${t.description}`).join("\n")}`;
            }
          } else {
            // Mode 1: Prompt Only — no knowledge base, no MCP tools
            knowledge = [];
            activeTools = [];
          }

          const known = Object.entries(vars).filter(([k, v]) => v && k !== "lastMessage");
          const extra =
            (instruction ? `\n\nInstruction / What to do: ${instruction}` : "") +
            (known.length ? `\n\nWhat we already know about the customer: ${known.map(([k, v]) => `${k}=${v}`).join(", ")}` : "") +
            mcpToolsDesc;

          const fullPrompt = isKnowledgeMcp
            ? `${settings.systemPrompt}\n\n${nowLine()}${knowledgeBlock(knowledge)}${boxToolHint}${extra}`
            : `${instruction || settings.systemPrompt}\n\n${nowLine()}${extra}`;

          // If this AI node has its own API key configured, use it directly!
          const nodeApiKey = typeof nodeData?.aiApiKey === "string" ? nodeData.aiApiKey.trim() : "";
          if (nodeApiKey) {
            // Box ki apni key wala AI MCP tools nahi chalata — isliye "knowledge_mcp" me files ka data backend khud bhejta hai
            const nodeKnowledge = isKnowledgeMcp ? await getKnowledge(selectedDocId !== "all" ? selectedDocId : undefined) : [];
            const nodePrompt = isKnowledgeMcp
              ? `${settings.systemPrompt}\n\n${nowLine()}${knowledgeBlock(nodeKnowledge)}${extra}`
              : fullPrompt;
            try {
              const r = await executeNodeAi({
                provider: typeof nodeData?.aiProvider === "string" ? nodeData.aiProvider : "gemini",
                apiKey: nodeApiKey,
                model: typeof nodeData?.aiModel === "string" ? nodeData.aiModel : undefined,
                baseUrl: typeof nodeData?.aiBaseUrl === "string" ? nodeData.aiBaseUrl : undefined,
                systemPrompt: nodePrompt,
                history,
              });
              if (r.trim()) return r;
            } catch (err) {
              console.error(`[chat] node AI error (${nodeData?.aiProvider}):`, err);
              toolLog.push({
                name: `${nodeData?.aiProvider || "ai"}_node_error`,
                input: {},
                output: err instanceof Error ? err.message : String(err),
                isError: true,
                at: new Date(),
              });
            }
          }

          if (provider.name === "demo") {
            // Demo me LLM nahi — box ka prompt (instruction) AI ke liye hai, customer ko KABHI nahi bhejna.
            // "Knowledge + MCP" box → files ka sabse milta hissa; warna team ko bata do.
            const top = (isKnowledgeMcp && !knowledge.length ? await getKnowledge(selectedDocId !== "all" ? selectedDocId : undefined) : knowledge)[0];
            if (top) return top.text.length > 700 ? `${top.text.slice(0, 700).replace(/\s+\S*$/, "")}…` : top.text;
            toolLog.push({
              name: "demo_no_ai",
              input: { responseSource },
              output: "Demo mode me AI nahi hai — AI box ka prompt use nahi hota. Bot settings me Claude ya Free API chuno.",
              isError: false,
              at: new Date(),
            });
            return "Is sawaal ka jawab hamari team degi — wo jaldi aapse contact karenge. 🙏";
          }
          try {
            const r = await provider.reply({
              history,
              settings: { ...baseSettings, systemPrompt: fullPrompt },
              tools: activeTools,
              runTool,
              state: {},
              knowledge,
              knowledgeFallback: boxFallback,
            });
            if (r.trim()) return r;
          } catch (err) {
            console.error(`[chat] ${provider.name} error in flow AI box:`, err);
            toolLog.push({ name: `${provider.name}_error`, input: {}, output: err instanceof Error ? err.message : String(err), isError: true, at: new Date() });
          }
          // AI na chale to bhi flow na toote
          return 'Maaf kijiye, abhi main iska jawab nahi de pa raha. Thodi der baad try karein, ya "menu" likh ke options dekhein.';
        },
      });
      reply = result.reply;
      quickReplies = result.quickReplies;
      if (result.needsHuman) convo.needsHuman = true;
      toolLog.push({ name: "flow", input: { flow: flow.name }, output: result.trace.join(" → "), isError: false, at: new Date() });
    } else {
      /* ── Sirf AI (ya Demo mode) ── */
      const knowledge = await injected();
      reply = await provider.reply({ history, settings: { ...baseSettings, systemPrompt: promptWith(knowledge) }, tools, runTool, state, knowledge, knowledgeFallback });
    }
  } catch (err) {
    console.error(`[chat] ${provider.name} error:`, err);
    toolLog.push({ name: `${provider.name}_error`, input: {}, output: err instanceof Error ? err.message : String(err), isError: true });
  }

  if (!reply) reply = "Sorry, abhi jawab dene me dikkat aa rahi hai. Thodi der baad try karein.";

  convo.messages.push({ role: "assistant", content: reply, at: new Date() });
  for (const { at, ...t } of toolLog) convo.toolCalls.push({ ...t, at: at ?? new Date() });
  convo.state = state;
  convo.markModified("state");
  await convo.save();
  emit("message.sent", { sessionId, channel, text: reply });

  const flowVars = (convo.state as any)?.flow?.vars as Record<string, string> | undefined;
  const recipientId = flowVars?.recipientId || flowVars?.phone || flowVars?.to;

  return {
    reply,
    quickReplies,
    provider: flow ? `flow` : provider.name,
    knowledgeMode,
    toolLog: toolLog.map(({ at: _at, ...t }) => t),
    recipientId,
    variables: flowVars,
  };
}
