import { claudeProvider } from "./claude.js";
import { openaiProvider } from "./openaiCompat.js";
import { demoProvider } from "./demo.js";
import type { Provider, ProviderName } from "./types.js";

export type ProviderSetting = "auto" | ProviderName;
export const PROVIDER_SETTINGS = ["auto", "claude", "openai", "demo"] as const;

/** "auto" → Claude key ho to Claude, warna Free API key ho to Free API, warna Demo */
export function resolveProvider(setting: string | undefined | null): ProviderName {
  if (setting === "claude" || setting === "openai" || setting === "demo") return setting;
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  if (process.env.OPENAI_COMPAT_API_KEY) return "openai";
  return "demo";
}

export function getProvider(setting: string | undefined | null): Provider {
  const name = resolveProvider(setting);
  return { claude: claudeProvider, openai: openaiProvider, demo: demoProvider }[name];
}

export { openaiTarget, testCompat } from "./openaiCompat.js";
export type { ProviderName } from "./types.js";
