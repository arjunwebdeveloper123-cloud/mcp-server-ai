import type { Provider } from "./types.js";
import { compatReply, CompatError, type CompatTarget } from "./openaiCompat.js";

/*  Ollama — free, aapke computer par chalne wala AI (koi API key nahi).
    Ollama bhi OpenAI-compatible endpoint deta hai: {ollamaUrl}/v1/chat/completions
    Tool calling ke liye aisa model chahiye jo tools support kare (qwen2.5, llama3.1, mistral-nemo…)  */

export function ollamaTarget(url: string, model: string): CompatTarget {
  return { label: "Ollama", endpoint: `${url.replace(/\/+$/, "")}/v1/chat/completions`, model, timeoutMs: 120_000 };
}

export const ollamaProvider: Provider = {
  name: "ollama",
  async reply(ctx) {
    try {
      return await compatReply(ollamaTarget(ctx.settings.ollamaUrl, ctx.settings.ollamaModel), ctx);
    } catch (err) {
      if (err instanceof CompatError && err.status === 0)
        throw new Error(`Ollama is not reachable at ${ctx.settings.ollamaUrl}. Install it from ollama.com and keep it running.`);
      if (err instanceof CompatError && (err.status === 404 || /not found/i.test(err.message)))
        throw new Error(`Model "${ctx.settings.ollamaModel}" is not downloaded. Run: ollama pull ${ctx.settings.ollamaModel}`);
      throw err;
    }
  },
};

/** Settings page ke liye: Ollama chal raha hai? kaunse models downloaded hain? */
export async function checkOllama(url: string) {
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { running: false, models: [] as string[] };
    const data = (await res.json()) as { models?: { name: string }[] };
    return { running: true, models: (data.models ?? []).map((m) => m.name) };
  } catch {
    return { running: false, models: [] as string[] };
  }
}
