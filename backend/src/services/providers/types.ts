/*  Har AI provider (Claude, Ollama, Demo) ek hi interface follow karta hai.
    chat.ts ko farak nahi padta kaunsa provider chal raha hai.            */

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ToolDef = {
  name: string; // "<serverSlug>__<tool>"
  description: string;
  input_schema: Record<string, unknown>;
};

/** Provider tool chalane ke liye ye function call karta hai (logging + webhooks chat.ts sambhalta hai) */
export type RunTool = (name: string, input: Record<string, unknown>) => Promise<{ output: string; isError: boolean }>;

export type ProviderSettings = {
  systemPrompt: string;
  model: string;
  maxTokens: number;
  maxToolRounds: number;
  ollamaUrl: string;
  ollamaModel: string;
  openaiBaseUrl: string;
  openaiModel: string;
  botName: string;
};

export type ProviderContext = {
  history: ChatTurn[]; // last message = current user message
  settings: ProviderSettings;
  tools: ToolDef[];
  runTool: RunTool;
  /** Uploaded files me se is sawaal ke liye chune gaye tukde (sirf relevant) */
  knowledge: { docName: string; title: string; text: string; score: number }[];
  /** Demo mode ka per-conversation state (DB me save hota hai) */
  state: Record<string, unknown>;
};

export type ProviderName = "claude" | "openai" | "ollama" | "demo";

export interface Provider {
  name: ProviderName;
  reply(ctx: ProviderContext): Promise<string>;
}
