/* Node-specific AI provider execution and real-time live testing for Flow Builder */

export type NodeAiProvider = "openai" | "anthropic" | "gemini" | "groq" | "custom";

export type TestAiKeyParams = {
  provider: string;
  apiKey: string;
  model?: string;
  baseUrl?: string;
};

export type TestAiKeyResult = {
  ok: boolean;
  reply?: string;
  error?: string;
  latencyMs: number;
  provider: string;
  model: string;
};

export type ExecuteNodeAiParams = {
  provider?: string;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  systemPrompt: string;
  history: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
};

/** Default models per provider */
export const DEFAULT_MODELS: Record<string, string> = {
  gemini: "gemini-1.5-flash",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
  groq: "llama-3.3-70b-versatile",
  custom: "meta-llama/llama-3.3-70b-instruct:free",
};

/**
 * Real-time API key verification:
 * Calls the provider with a short probe message and returns live status, latency, and model reply.
 */
export async function testNodeAiKey(params: TestAiKeyParams): Promise<TestAiKeyResult> {
  const provider = (params.provider || "gemini").toLowerCase();
  const apiKey = (params.apiKey || "").trim();
  const model = (params.model || "").trim() || DEFAULT_MODELS[provider] || "gpt-4o-mini";
  const baseUrl = (params.baseUrl || "").trim();

  const started = Date.now();

  if (!apiKey && provider !== "custom") {
    return {
      ok: false,
      error: `API key is required for ${provider.toUpperCase()}. Please enter your API key to test.`,
      latencyMs: 0,
      provider,
      model,
    };
  }

  try {
    let reply = "";

    if (provider === "anthropic") {
      reply = await testAnthropic(apiKey, model);
    } else if (provider === "gemini") {
      reply = await testGemini(apiKey, model);
    } else if (provider === "groq") {
      reply = await testOpenAiFormat("https://api.groq.com/openai/v1/chat/completions", apiKey, model, "Groq");
    } else if (provider === "openai") {
      reply = await testOpenAiFormat("https://api.openai.com/v1/chat/completions", apiKey, model, "OpenAI");
    } else {
      // custom / openrouter / etc
      const url = `${(baseUrl || "https://openrouter.ai/api/v1").replace(/\/+$/, "")}/chat/completions`;
      reply = await testOpenAiFormat(url, apiKey, model, "Custom API");
    }

    return {
      ok: true,
      reply: reply || "OK, connection successful!",
      latencyMs: Date.now() - started,
      provider,
      model,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
      provider,
      model,
    };
  }
}

/** Test Anthropic API */
async function testAnthropic(apiKey: string, model: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 30,
      messages: [{ role: "user", content: "Reply with 'Live & Connected!' in 3 words or less." }],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const errObj = (data.error as Record<string, unknown>) ?? {};
    const msg = (errObj.message as string) || res.statusText;
    if (res.status === 401) throw new Error("Invalid Anthropic API Key (401). Please check your key.");
    if (res.status === 404) throw new Error(`Anthropic model "${model}" not found (404).`);
    if (res.status === 429) throw new Error("Anthropic rate limit or credit quota exceeded (429).");
    throw new Error(`Anthropic error (${res.status}): ${msg}`);
  }

  const content = (data.content as Array<{ type: string; text?: string }>) ?? [];
  return content.find((b) => b.type === "text")?.text?.trim() || "OK";
}

/** Test Google Gemini API (tries official OpenAI compatible endpoint first, fallback to REST) */
async function testGemini(apiKey: string, model: string): Promise<string> {
  // Try OpenAI-compatible endpoint
  const openAiUrl = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  try {
    const res = await fetch(openAiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with 'Live & Connected!' in 3 words or less." }],
        max_tokens: 30,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (res.ok) {
      const choices = (data.choices as Array<{ message?: { content?: string } }>) ?? [];
      return choices[0]?.message?.content?.trim() || "OK";
    }

    // If 401/403 or specific auth error, report it directly
    const errObj = (data.error as Record<string, unknown>) ?? {};
    const errMsg = (errObj.message as string) || res.statusText;
    if (res.status === 400 && errMsg.includes("API_KEY_INVALID")) {
      throw new Error("Invalid Google Gemini API Key. Get a valid key from Google AI Studio.");
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("Invalid Google Gemini")) throw err;
  }

  // Fallback to Native Gemini REST API
  const nativeUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(nativeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: "Reply with 'Live & Connected!' in 3 words or less." }] }],
      generationConfig: { maxOutputTokens: 30 },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errObj = (data.error as Record<string, unknown>) ?? {};
    const msg = (errObj.message as string) || res.statusText;
    if (res.status === 400 && msg.includes("API_KEY_INVALID")) {
      throw new Error("Invalid Google Gemini API Key. Please verify in Google AI Studio.");
    }
    if (res.status === 404) throw new Error(`Gemini model "${model}" not found (404). Try "gemini-1.5-flash".`);
    throw new Error(`Google Gemini error (${res.status}): ${msg}`);
  }

  const candidates = (data.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }>) ?? [];
  return candidates[0]?.content?.parts?.[0]?.text?.trim() || "OK";
}

/** Test standard OpenAI-compatible endpoints (OpenAI, Groq, OpenRouter, etc.) */
async function testOpenAiFormat(url: string, apiKey: string, model: string, label: string): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with 'Live & Connected!' in 3 words or less." }],
      max_tokens: 30,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const errObj = (data.error as Record<string, unknown>) ?? {};
    const msg = (typeof data.error === "string" ? data.error : (errObj.message as string)) || res.statusText;
    if (res.status === 401) throw new Error(`Invalid ${label} API key (401). Please check your key.`);
    if (res.status === 404) throw new Error(`${label} model "${model}" or endpoint not found (404).`);
    if (res.status === 429) throw new Error(`${label} rate limit or quota exceeded (429).`);
    throw new Error(`${label} error (${res.status}): ${msg}`);
  }

  const choices = (data.choices as Array<{ message?: { content?: string } }>) ?? [];
  return choices[0]?.message?.content?.trim() || "OK";
}

/**
 * Execute actual completion for a node configured with its own AI API key & model
 */
export async function executeNodeAi(params: ExecuteNodeAiParams): Promise<string> {
  const provider = (params.provider || "gemini").toLowerCase();
  const apiKey = (params.apiKey || "").trim();
  const model = (params.model || "").trim() || DEFAULT_MODELS[provider] || "gpt-4o-mini";
  const baseUrl = (params.baseUrl || "").trim();
  const maxTokens = params.maxTokens || 1024;

  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: params.systemPrompt,
        messages: params.history.length ? params.history.map((m) => ({ role: m.role, content: m.content })) : [{ role: "user", content: "Hello" }],
      }),
      signal: AbortSignal.timeout(45_000),
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const errObj = (data.error as Record<string, unknown>) ?? {};
      throw new Error(`Anthropic error (${res.status}): ${(errObj.message as string) || res.statusText}`);
    }
    const content = (data.content as Array<{ type: string; text?: string }>) ?? [];
    return content.find((b) => b.type === "text")?.text?.trim() || "";
  }

  if (provider === "gemini") {
    // Attempt OpenAI compatible endpoint first
    try {
      const openAiUrl = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
      const messages = [
        ...(params.systemPrompt ? [{ role: "system", content: params.systemPrompt }] : []),
        ...params.history.map((m) => ({ role: m.role, content: m.content })),
      ];

      const res = await fetch(openAiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
        signal: AbortSignal.timeout(45_000),
      });

      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const choices = (data.choices as Array<{ message?: { content?: string } }>) ?? [];
        const reply = choices[0]?.message?.content?.trim();
        if (reply) return reply;
      }
    } catch {
      // Fallback to REST
    }

    // Native Gemini REST fallback
    const nativeUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const contents = [
      ...(params.systemPrompt ? [{ role: "user", parts: [{ text: `System instruction: ${params.systemPrompt}` }] }] : []),
      ...params.history.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
    ];

    const res = await fetch(nativeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: maxTokens } }),
      signal: AbortSignal.timeout(45_000),
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const errObj = (data.error as Record<string, unknown>) ?? {};
      throw new Error(`Google Gemini error (${res.status}): ${(errObj.message as string) || res.statusText}`);
    }
    const candidates = (data.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }>) ?? [];
    return candidates[0]?.content?.parts?.[0]?.text?.trim() || "";
  }

  // OpenAI / Groq / Custom
  let endpoint = "https://api.openai.com/v1/chat/completions";
  if (provider === "groq") endpoint = "https://api.groq.com/openai/v1/chat/completions";
  else if (provider === "custom" && baseUrl) endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const messages = [
    ...(params.systemPrompt ? [{ role: "system", content: params.systemPrompt }] : []),
    ...params.history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(45_000),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errObj = (data.error as Record<string, unknown>) ?? {};
    const msg = (typeof data.error === "string" ? data.error : (errObj.message as string)) || res.statusText;
    throw new Error(`${provider.toUpperCase()} error (${res.status}): ${msg}`);
  }

  const choices = (data.choices as Array<{ message?: { content?: string } }>) ?? [];
  return choices[0]?.message?.content?.trim() || "";
}

