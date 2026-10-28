import Anthropic from "@anthropic-ai/sdk";
import type { Provider } from "./types.js";

/*  Claude (Anthropic API) — ANTHROPIC_API_KEY chahiye.
    Tool-use loop: Claude → tool_use → MCP tool → tool_result → Claude → ... → text  */

let client: Anthropic | null = null;
function anthropic() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set in backend/.env");
  return (client ??= new Anthropic());
}

export const claudeProvider: Provider = {
  name: "claude",
  async reply({ history, settings, tools, runTool }) {
    const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
    const claudeTools = tools.map((t) => ({ ...t, input_schema: t.input_schema as Anthropic.Tool.InputSchema }));

    for (let round = 0; round <= settings.maxToolRounds; round++) {
      const response = await anthropic().messages.create({
        model: settings.model,
        max_tokens: settings.maxTokens,
        system: settings.systemPrompt,
        ...(claudeTools.length ? { tools: claudeTools } : {}),
        messages,
      });
      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") {
        return response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const r = await runTool(block.name, block.input as Record<string, unknown>);
        results.push({ type: "tool_result", tool_use_id: block.id, content: r.output || "(empty)", is_error: r.isError });
      }
      messages.push({ role: "user", content: results });
    }
    return "";
  },
};
