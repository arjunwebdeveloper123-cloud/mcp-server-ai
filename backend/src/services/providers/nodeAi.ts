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
  note?: string;
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
  gemini: "gemini-3.8-flash",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
  groq: "llama-3.3-70b-versatile",
  custom: "meta-llama/llama-3.3-70b-instruct:free",
};

/**
 * Real-time API key verification:
 * Calls the provider with a probe message and returns live status, latency, and model reply.
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
    let finalModel = model;
    let note: string | undefined;

    if (provider === "anthropic") {
      reply = await testAnthropic(apiKey, model);
    } else if (provider === "gemini") {
      const gRes = await testGemini(apiKey, model);
      reply = gRes.reply;
      finalModel = gRes.resolvedModel;
      note = gRes.note;
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
      model: finalModel,
      note,
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

/**
 * Test Google Gemini API
 * 1. Validates key and discovers allowed models via ListModels
 * 2. Matches requested model or auto-resolves to the active available model
 * 3. Probes generateContent with x-goog-api-key header and query parameter fallback
 * 4. Extracts real Google error messages on failure
 */
async function testGemini(
  apiKey: string,
  model: string
): Promise<{ reply: string; resolvedModel: string; note?: string }> {
  const cleanKey = apiKey.trim();
  const rawRequested = (model || "").trim() || "gemini-3.8-flash";
  const requestedModel = rawRequested.replace(/^models\//i, "").trim();
  const requestedModelLower = requestedModel.toLowerCase();

  // Step 1: Discover available models for this specific API key
  let availableModels: string[] = [];
  try {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`;
    const listRes = await fetch(listUrl, {
      method: "GET",
      headers: { "x-goog-api-key": cleanKey },
      signal: AbortSignal.timeout(12_000),
    });

    const listData = (await listRes.json().catch(() => ({}))) as Record<string, unknown>;

    if (!listRes.ok) {
      const errObj = (listData.error as Record<string, unknown>) ?? {};
      const errMsg = (errObj.message as string) || listRes.statusText;
      if (listRes.status === 400 && (errMsg.includes("API key not valid") || errMsg.includes("API_KEY_INVALID"))) {
        throw new Error("Invalid Google Gemini API Key. Please get a valid key from Google AI Studio (aistudio.google.com).");
      }
      throw new Error(`Google Gemini authentication error (${listRes.status}): ${errMsg}`);
    }

    const rawList = (listData.models as Array<{ name?: string; supportedGenerationMethods?: string[] }>) ?? [];
    availableModels = rawList
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => (m.name || "").replace(/^models\//i, ""))
      .filter(Boolean);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Invalid Google Gemini API Key")) throw err;
    if (err instanceof Error && err.message.includes("Google Gemini authentication error")) throw err;
    // Otherwise network/timeout, continue to direct generation probe
  }

  // Step 2: Determine model to use (case-insensitive exact match first)
  let resolvedModel = requestedModelLower;
  let note: string | undefined;

  if (availableModels.length > 0) {
    const exact = availableModels.find((m) => m.toLowerCase() === requestedModelLower);
    if (exact) {
      resolvedModel = exact;
    } else {
      // Find closest alternative in available models, prioritizing modern 3.8 flash/pro models
      const aliasMatch =
        availableModels.find((m) => m.toLowerCase() === `${requestedModelLower}-latest`) ||
        availableModels.find((m) => m.toLowerCase() === requestedModelLower.replace(/-latest$/, "")) ||
        // If flash was requested, find highest version flash
        (requestedModelLower.includes("flash")
          ? availableModels.find((m) => m.toLowerCase().includes("3.8") && m.toLowerCase().includes("flash")) ||
            availableModels.find((m) => m.toLowerCase().includes("2.5") && m.toLowerCase().includes("flash")) ||
            availableModels.find((m) => m.toLowerCase().includes("flash"))
          : undefined) ||
        // If pro was requested, find highest version pro
        (requestedModelLower.includes("pro")
          ? availableModels.find((m) => m.toLowerCase().includes("3.8") && m.toLowerCase().includes("pro")) ||
            availableModels.find((m) => m.toLowerCase().includes("pro"))
          : undefined) ||
        availableModels.find((m) => m.toLowerCase().includes("3.8")) ||
        availableModels.find((m) => m.toLowerCase().includes("flash")) ||
        availableModels[0];

      if (aliasMatch) {
        resolvedModel = aliasMatch;
        if (aliasMatch.toLowerCase() !== requestedModelLower) {
          note = `Model "${rawRequested}" auto-connected with active model "${aliasMatch}".`;
        }
      } else {
        throw new Error(
          `Model "${rawRequested}" is not enabled for your API key. Available models: ${availableModels.slice(0, 6).join(", ")}`
        );
      }
    }
  }

  // Step 3: Probe generateContent
  const probePayload = {
    contents: [{ role: "user", parts: [{ text: "Reply with 'Live & Connected!' in 3 words or less." }] }],
    generationConfig: { maxOutputTokens: 25 },
  };

  const endpointsToTry = [
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(resolvedModel)}:generateContent`,
    `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(resolvedModel)}:generateContent`,
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(resolvedModel)}:generateContent?key=${encodeURIComponent(cleanKey)}`,
  ];

  let lastError = "";

  for (const ep of endpointsToTry) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": cleanKey,
        },
        body: JSON.stringify(probePayload),
        signal: AbortSignal.timeout(12_000),
      });

      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      if (res.ok) {
        const candidates = (data.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }>) ?? [];
        const reply = candidates[0]?.content?.parts?.[0]?.text?.trim() || "Live & Connected!";
        return { reply, resolvedModel, note };
      }

      const errObj = (data.error as Record<string, unknown>) ?? {};
      lastError = (errObj.message as string) || res.statusText || `HTTP ${res.status}`;
      if (res.status === 400 && lastError.includes("API key not valid")) {
        throw new Error("Invalid Google Gemini API Key. Please verify your key in Google AI Studio.");
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("Invalid Google Gemini API Key")) throw err;
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  // Also try OpenAI compatible format if REST had issues
  try {
    const oaUrl = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    const oaRes = await fetch(oaUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cleanKey}`,
      },
      body: JSON.stringify({
        model: resolvedModel,
        messages: [{ role: "user", content: "Reply with 'Live & Connected!' in 3 words or less." }],
        max_tokens: 25,
      }),
      signal: AbortSignal.timeout(12_000),
    });

    if (oaRes.ok) {
      const oaData = (await oaRes.json().catch(() => ({}))) as Record<string, unknown>;
      const choices = (oaData.choices as Array<{ message?: { content?: string } }>) ?? [];
      const reply = choices[0]?.message?.content?.trim();
      if (reply) return { reply, resolvedModel, note };
    }
  } catch {
    // Ignore and report lastError
  }

  throw new Error(`Google Gemini error: ${lastError || "Could not connect to model."}`);
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
    const cleanModel = model.replace(/^models\//i, "").trim().toLowerCase() || "gemini-3.8-flash";
    const contents = [
      ...(params.systemPrompt ? [{ role: "user", parts: [{ text: `System instruction: ${params.systemPrompt}` }] }] : []),
      ...params.history.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
    ];

    const endpoints = [
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent`,
      `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(cleanModel)}:generateContent`,
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    ];

    let lastErr = "";
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: maxTokens } }),
          signal: AbortSignal.timeout(45_000),
        });

        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (res.ok) {
          const candidates = (data.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }>) ?? [];
          const text = candidates[0]?.content?.parts?.[0]?.text?.trim();
          if (text) return text;
        } else {
          const errObj = (data.error as Record<string, unknown>) ?? {};
          lastErr = (errObj.message as string) || res.statusText;
        }
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
    }

    // Try OpenAI format as fallback
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
        body: JSON.stringify({ model: cleanModel, messages, max_tokens: maxTokens }),
        signal: AbortSignal.timeout(45_000),
      });

      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const choices = (data.choices as Array<{ message?: { content?: string } }>) ?? [];
        const reply = choices[0]?.message?.content?.trim();
        if (reply) return reply;
      }
    } catch {
      // Fallback
    }

    throw new Error(`Google Gemini error: ${lastErr || "Failed to generate reply"}`);
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
