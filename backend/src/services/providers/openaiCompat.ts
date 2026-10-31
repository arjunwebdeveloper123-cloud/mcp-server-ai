import type { Provider, ProviderContext } from "./types.js";

/*  OpenAI-compatible "Chat Completions" format.
    Ye format bahut saari services samajhti hain:
      Groq, Google Gemini, OpenRouter, apinex, aur dusre OpenAI-jaise API providers.
    Isliye ek hi code se sab chal jaate hain — sirf URL, model aur key badalti hai.   */

type OAToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type OAMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OAToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type OAResponse = {
  choices?: { message: { content: string | null; tool_calls?: OAToolCall[] }; finish_reason?: string }[];
  error?: { message?: string } | string;
};

export type CompatTarget = {
  label: string; // error messages me dikhane ke liye ("Free API")
  endpoint: string; // poora URL: .../chat/completions
  model: string;
  apiKey?: string;
  timeoutMs: number;
};

export class CompatError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Ek request bhejo; error ho to saaf message ke saath throw karo */
export async function compatRequest(t: CompatTarget, body: Record<string, unknown>): Promise<OAResponse> {
  let res: Response;
  try {
    res = await fetch(t.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(t.apiKey ? { Authorization: `Bearer ${t.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: t.model, stream: false, ...body }),
      signal: AbortSignal.timeout(t.timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new CompatError(0, timedOut ? `${t.label} did not answer within ${t.timeoutMs / 1000}s` : `${t.label} is not reachable at ${new URL(t.endpoint).origin}`);
  }
  const data = (await res.json().catch(() => ({}))) as OAResponse;
  if (!res.ok) {
    const msg = (typeof data.error === "string" ? data.error : data.error?.message) ?? res.statusText;
    if (res.status === 401 || res.status === 403) throw new CompatError(res.status, `${t.label} rejected the API key (${res.status}): ${msg}`);
    if (res.status === 429) throw new CompatError(429, `${t.label} rate limit reached — wait a bit or check your free quota`);
    throw new CompatError(res.status, `${t.label} error ${res.status}: ${msg}`);
  }
  return data;
}

const toolsUnsupported = new Set<string>(); // jo endpoint+model tools nahi samajhte, unhe yaad rakho

/** Tool-use loop: model → tool_calls → MCP tools → results → model → ... → text */
export async function compatReply(t: CompatTarget, { history, settings, tools, runTool, knowledgeFallback }: ProviderContext) {
  const messages: OAMessage[] = [
    { role: "system", content: settings.systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content }) as OAMessage),
  ];
  const key = `${t.endpoint}|${t.model}`;
  const oaTools = tools.map((x) => ({ type: "function" as const, function: { name: x.name, description: x.description, parameters: x.input_schema } }));

  // Model tools nahi samajhta → Knowledge tool bhi nahi chalega, isliye file ka relevant hissa seedha prompt me jodo
  let fallbackUsed = false;
  const useKnowledgeFallback = async () => {
    if (fallbackUsed || !knowledgeFallback) return;
    fallbackUsed = true;
    const extra = await knowledgeFallback();
    if (extra) messages[0] = { role: "system", content: settings.systemPrompt + extra };
  };
  if (toolsUnsupported.has(key)) await useKnowledgeFallback();

  for (let round = 0; round <= settings.maxToolRounds; round++) {
    const sendTools = oaTools.length > 0 && !toolsUnsupported.has(key);
    let data: OAResponse;
    try {
      data = await compatRequest(t, { messages, max_tokens: settings.maxTokens, ...(sendTools ? { tools: oaTools } : {}) });
    } catch (err) {
      // Kuch free models tools support nahi karte → bina tools ke dobara try
      if (sendTools && err instanceof CompatError && err.status === 400 && /tool|function/i.test(err.message)) {
        toolsUnsupported.add(key);
        console.warn(`[ai] ${t.label} model "${t.model}" does not support tools — continuing without MCP tools`);
        await useKnowledgeFallback();
        round--;
        continue;
      }
      throw err;
    }

    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error(`${t.label} returned an empty response`);
    if (!msg.tool_calls?.length) return (msg.content ?? "").trim();

    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        messages.push({ role: "tool", tool_call_id: call.id, content: "Error: arguments were not valid JSON" });
        continue;
      }
      const r = await runTool(call.function.name, args);
      messages.push({ role: "tool", tool_call_id: call.id, content: (r.isError ? "Error: " : "") + (r.output || "(empty)") });
    }
  }
  return "";
}

/* ───────── "Free API" provider (Groq / Gemini / OpenRouter / koi bhi OpenAI-compatible) ───────── */

export function openaiTarget(baseUrl: string, model: string): CompatTarget {
  return {
    label: "Free API",
    endpoint: `${baseUrl.replace(/\/+$/, "")}/chat/completions`,
    model,
    apiKey: process.env.OPENAI_COMPAT_API_KEY || undefined,
    timeoutMs: 60_000,
  };
}

export const openaiProvider: Provider = {
  name: "openai",
  async reply(ctx) {
    if (!process.env.OPENAI_COMPAT_API_KEY) throw new Error("OPENAI_COMPAT_API_KEY is not set in backend/.env");
    return compatReply(openaiTarget(ctx.settings.openaiBaseUrl, ctx.settings.openaiModel), ctx);
  },
};

/** Settings page ka "Test connection": (1) simple jawab (2) tool calling */
export async function testCompat(t: CompatTarget) {
  const started = Date.now();
  try {
    const plain = await compatRequest(t, { messages: [{ role: "user", content: "Reply with exactly: OK" }], max_tokens: 20 });
    const reply = plain.choices?.[0]?.message?.content?.trim() ?? "";
    const latencyMs = Date.now() - started;

    let toolCalling = false;
    let toolNote = "";
    try {
      const withTool = await compatRequest(t, {
        messages: [{ role: "user", content: "What time is it? Use the get_time tool." }],
        max_tokens: 60,
        tools: [{ type: "function", function: { name: "get_time", description: "Returns the current time", parameters: { type: "object", properties: {} } } }],
      });
      toolCalling = Boolean(withTool.choices?.[0]?.message?.tool_calls?.length);
      if (!toolCalling) toolNote = "Model answered without calling the tool";
    } catch (err) {
      toolNote = err instanceof Error ? err.message : String(err);
    }
    return { ok: true, reply: reply.slice(0, 200), latencyMs, toolCalling, toolNote };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - started, toolCalling: false };
  }
}
