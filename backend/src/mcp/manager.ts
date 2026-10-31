import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import { McpServer, Settings, getSettings } from "../models/index.js";

/*  McpManager = backend ka "MCP host".
    DB me jitne MCP servers saved hain, har ek ke liye ek MCP client banata hai.
    Claude ko tool names "<serverSlug>__<toolName>" format me dikhte hain,
    taaki do servers ke same naam wale tools clash na karein.               */

export type ServerStatus = "connected" | "connecting" | "error" | "disabled";

export type ToolInfo = {
  name: string;
  fullName: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  enabled: boolean;
};

type Conn = {
  id: string;
  slug: string;
  name: string;
  status: ServerStatus;
  error?: string;
  client?: Client;
  tools: ToolInfo[];
  resources: { uri: string; name: string; description?: string }[];
  prompts: { name: string; description?: string }[];
  serverInfo?: { name: string; version: string };
  connectedAt?: Date;
};

const SEP = "__";
const conns = new Map<string, Conn>(); // key = server _id

function toStrRecord(m: unknown): Record<string, string> {
  if (!m) return {};
  if (m instanceof Map) return Object.fromEntries(m) as Record<string, string>;
  return { ...(m as Record<string, string>) };
}

async function safeList<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback; // server ye capability support nahi karta
  }
}

export async function connectServer(id: string) {
  const doc = await McpServer.findById(id);
  if (!doc) throw new Error("MCP server not found");

  await disconnectServer(id);

  const conn: Conn = {
    id,
    slug: doc.slug,
    name: doc.name,
    status: doc.enabled ? "connecting" : "disabled",
    tools: [],
    resources: [],
    prompts: [],
  };
  conns.set(id, conn);
  if (!doc.enabled) return conn;

  try {
    const transport =
      doc.transport === "stdio"
        ? new StdioClientTransport({
            command: doc.command!,
            args: (doc.args ?? []).map((a) =>
              // relative .ts/.js paths ko backend folder ke hisaab se resolve karo
              /\.(ts|js|mjs)$/.test(a) && a.startsWith(".") ? path.resolve(a) : a
            ),
            env: { ...(process.env as Record<string, string>), ...toStrRecord(doc.env) },
            stderr: "inherit",
          })
        : new StreamableHTTPClientTransport(new URL(doc.url!), {
            requestInit: { headers: toStrRecord(doc.headers) },
          });

    const client = new Client({ name: "chatbot-dashboard", version: "2.0.0" });
    await withTimeout(client.connect(transport), 20_000, "Connection timed out");

    const disabled = new Set(doc.disabledTools ?? []);
    const caps = client.getServerCapabilities() ?? {};

    const { tools } = caps.tools ? await client.listTools() : { tools: [] };
    conn.tools = tools.map((t) => ({
      name: t.name,
      fullName: `${doc.slug}${SEP}${t.name}`,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
      enabled: !disabled.has(t.name),
    }));
    conn.resources = caps.resources
      ? (await safeList(() => client.listResources(), { resources: [] })).resources.map((r) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
        }))
      : [];
    conn.prompts = caps.prompts
      ? (await safeList(() => client.listPrompts(), { prompts: [] })).prompts.map((p) => ({
          name: p.name,
          description: p.description,
        }))
      : [];

    const info = client.getServerVersion();
    conn.serverInfo = info ? { name: info.name, version: info.version } : undefined;
    conn.client = client;
    conn.status = "connected";
    conn.connectedAt = new Date();

    // Server band ho jaye to status update
    client.onclose = () => {
      if (conns.get(id) === conn) {
        conn.status = "error";
        conn.error = "Connection closed";
        conn.client = undefined;
      }
    };
    console.log(`[mcp] ${doc.slug} connected (${conn.tools.length} tools)`);
  } catch (err) {
    conn.status = "error";
    conn.error = err instanceof Error ? err.message : String(err);
    console.error(`[mcp] ${doc.slug} failed:`, conn.error);
  }
  return conn;
}

export async function disconnectServer(id: string) {
  const c = conns.get(id);
  conns.delete(id);
  if (c?.client) {
    c.client.onclose = undefined;
    await c.client.close().catch(() => {});
  }
}

export async function connectAll() {
  const servers = await McpServer.find();
  await Promise.all(servers.map((s) => connectServer(String(s._id))));
}

export async function closeAll() {
  await Promise.all([...conns.keys()].map(disconnectServer));
}

/** Dashboard ke liye: DB config + live status */
export async function listServers() {
  const docs = await McpServer.find().sort({ createdAt: 1 }).lean();
  return docs.map((d) => {
    const c = conns.get(String(d._id));
    return {
      ...d,
      env: toStrRecord(d.env),
      headers: maskHeaders(toStrRecord(d.headers)),
      status: c?.status ?? (d.enabled ? "error" : "disabled"),
      error: c?.error,
      serverInfo: c?.serverInfo,
      connectedAt: c?.connectedAt,
      tools: c?.tools ?? [],
      resources: c?.resources ?? [],
      prompts: c?.prompts ?? [],
    };
  });
}

function maskHeaders(h: Record<string, string>) {
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v.length > 8 ? v.slice(0, 4) + "••••" : "••••"]));
}

export async function setToolEnabled(id: string, tool: string, enabled: boolean) {
  const update = enabled ? { $pull: { disabledTools: tool } } : { $addToSet: { disabledTools: tool } };
  await McpServer.updateOne({ _id: id }, update);
  const t = conns.get(id)?.tools.find((x) => x.name === tool);
  if (t) t.enabled = enabled;
}

/** Claude ko bhejne layak tools (sirf connected servers + enabled tools) */
export function getClaudeTools(): Anthropic.Tool[] {
  const out: Anthropic.Tool[] = [];
  for (const c of conns.values()) {
    if (c.status !== "connected") continue;
    for (const t of c.tools) {
      if (!t.enabled) continue;
      out.push({
        name: t.fullName.slice(0, 64),
        description: t.description ?? t.title ?? t.name,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      });
    }
  }
  return out;
}

export function listAllToolNames() {
  return [...conns.values()].flatMap((c) => c.tools.map((t) => t.fullName));
}

/** "<slug>__<tool>" → us server par tools/call */
export async function callTool(fullName: string, args: Record<string, unknown>) {
  const i = fullName.indexOf(SEP);
  if (i < 0) throw new Error(`Invalid tool name: ${fullName}`);
  const slug = fullName.slice(0, i);
  const tool = fullName.slice(i + SEP.length);

  const conn = [...conns.values()].find((c) => c.slug === slug);
  if (!conn?.client || conn.status !== "connected") throw new Error(`MCP server "${slug}" is not connected`);

  const started = Date.now();
  const result = await withTimeout(conn.client.callTool({ name: tool, arguments: args }), 30_000, "Tool call timed out");
  const content = (result.content as Array<{ type: string; text?: string }>) ?? [];
  const text = content.map((c) => (c.type === "text" ? c.text : `[${c.type} content]`)).join("\n");
  return { server: slug, tool, text, isError: Boolean(result.isError), durationMs: Date.now() - started };
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** Project ke saath aane wale MCP servers — sab backend/src/mcp-servers/ ke andar, backend ke packages se chalte hain.
    Har ek sirf EK BAAR apne aap judta hai — aap dashboard se delete karoge to wapas nahi aayega. */
const BUILT_IN_SERVERS = [
  { name: "Lead server (built-in)", slug: "leads", path: "./src/mcp-servers/leads/index.ts" },
  { name: "Appointment server (built-in)", slug: "appointments", path: "./src/mcp-servers/appointments/index.ts" },
  // Uploaded files (.md / pdf / docx) ka data — LLM khud tool call karke maangta hai
  { name: "Knowledge server (built-in)", slug: "knowledge", path: "./src/mcp-servers/knowledge/index.ts" },
];

/** Purane folders (mcp-server/, appointment-server/, mcp-servers/knowledge.ts) wale saved paths → naye paths */
const OLD_PATHS: [RegExp, string][] = [
  [/(^|[\\/])mcp-server[\\/]src[\\/]index\.ts$/, "./src/mcp-servers/leads/index.ts"],
  [/(^|[\\/])appointment-server[\\/]src[\\/]index\.ts$/, "./src/mcp-servers/appointments/index.ts"],
  [/(^|[\\/])src[\\/]mcp-servers[\\/]knowledge\.ts$/, "./src/mcp-servers/knowledge/index.ts"],
];

export async function seedDefaultServer() {
  // 1) Folder merge se pehle save hue servers ka path theek karo (warna "Connection closed")
  for (const doc of await McpServer.find({ transport: "stdio" })) {
    const args = (doc.args ?? []).map((a) => OLD_PATHS.find(([re]) => re.test(a))?.[1] ?? a);
    if (args.join("\u0000") !== (doc.args ?? []).join("\u0000")) {
      await McpServer.updateOne({ _id: doc._id }, { args });
      console.log(`[mcp] "${doc.slug}" moved to ${args.at(-1)}`);
    }
  }
  // 2) Naye built-in servers jodo
  const settings = await getSettings();
  const done = new Set(settings.seededServers ?? []);
  for (const s of BUILT_IN_SERVERS) {
    if (done.has(s.slug)) continue;
    if (!fs.existsSync(path.resolve(s.path))) continue; // file hi nahi hai to skip
    if (!(await McpServer.exists({ slug: s.slug }))) {
      await McpServer.create({ name: s.name, slug: s.slug, transport: "stdio", command: "npx", args: ["tsx", s.path] });
      console.log(`[mcp] added built-in server "${s.slug}"`);
    }
    done.add(s.slug);
  }
  await Settings.updateOne({ _id: "global" }, { seededServers: [...done] });
}
