import "dotenv/config";
import mongoose from "mongoose";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { KnowledgeChunk, KnowledgeDoc, getSettings } from "../../models/index.js";
import { searchKnowledge } from "../../services/knowledge.js";

/*  Knowledge MCP server — "LLM khud data maange" (Agentic RAG)

    Flow:
      Customer sawaal poochta hai → backend sirf sawaal LLM ko bhejta hai
      → LLM decide karta hai ki use data chahiye → is server ka tool call karta hai
      → ye server MongoDB me saved .md / pdf / docx data se sirf zaroori hissa nikaal ke deta hai
      → LLM us data se jawab banata hai → customer

    Ye server backend ke packages hi use karta hai (alag npm install nahi).
    Backend ise apne-aap start karta hai: npx tsx ./src/mcp-servers/knowledge/index.ts
    Alag se test:  npm run inspect:knowledge   (backend folder me)

    IMPORTANT: stdio MCP server me console.log() mat use karo — stdout sirf MCP messages ke liye hai.  */

const server = new McpServer({ name: "knowledge-server", version: "1.0.0" });

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], isError });

const MAX_READ_CHARS = 6000;

server.registerTool(
  "search_knowledge",
  {
    title: "Search company knowledge",
    description:
      "Search the company's uploaded files (services, prices, policies, process, FAQs, contact details). " +
      "Call this BEFORE answering any question about the company, its services, prices, timings, rules or facts. " +
      "Use short keyword queries, e.g. 'whatsapp pricing' or 'refund policy'. " +
      "For questions that compare two things, call it once for each thing. Returns only the most relevant sections.",
    inputSchema: {
      query: z.string().min(2).max(300).describe("What to look for, in a few keywords"),
    },
  },
  async ({ query }) => {
    const s = await getSettings();
    const hits = await searchKnowledge(query, { topK: s.knowledgeTopK ?? 4, maxChars: s.knowledgeMaxChars ?? 2500 });
    if (!hits.length) {
      return text(`No matching information found for "${query}". Try other keywords, or tell the customer the team will confirm.`);
    }
    return text(hits.map((h, i) => `[${i + 1}] ${h.title}  (file: ${h.docName})\n${h.text}`).join("\n\n---\n\n"));
  }
);

server.registerTool(
  "list_documents",
  {
    title: "List uploaded files",
    description: "List the company files that are available, with their section headings. Use it to see what information exists before searching.",
    inputSchema: {},
  },
  async () => {
    const docs = await KnowledgeDoc.find({ enabled: true }).sort({ createdAt: 1 }).select("name").lean();
    if (!docs.length) return text("No files have been uploaded yet.");
    const out: string[] = [];
    for (const d of docs) {
      const chunks = await KnowledgeChunk.find({ docId: d._id }).sort({ order: 1 }).select("title").lean();
      const titles = [...new Set(chunks.map((c) => c.title ?? "").filter(Boolean))];
      out.push(`${d.name}\n${titles.map((t) => `  - ${t}`).join("\n")}`);
    }
    return text(out.join("\n\n"));
  }
);

server.registerTool(
  "read_document",
  {
    title: "Read a file section",
    description:
      "Read a full section of an uploaded file when search results are too short. " +
      "Give the file name from list_documents, and optionally a section heading (or part of it).",
    inputSchema: {
      file: z.string().min(1).describe("File name, e.g. messaging-services.md"),
      section: z.string().optional().describe("Section heading or a word from it, e.g. 'RCS pricing'"),
    },
  },
  async ({ file, section }) => {
    const doc =
      (await KnowledgeDoc.findOne({ enabled: true, name: file }).lean()) ??
      (await KnowledgeDoc.findOne({ enabled: true, name: { $regex: escapeRegex(file), $options: "i" } }).lean());
    if (!doc) return text(`File "${file}" not found. Call list_documents to see available files.`, true);

    let chunks = await KnowledgeChunk.find({ docId: doc._id }).sort({ order: 1 }).select("title text").lean();
    if (section?.trim()) {
      const want = section.trim().toLowerCase();
      const matched = chunks.filter((c) => (c.title ?? "").toLowerCase().includes(want));
      if (!matched.length) return text(`No section matching "${section}" in ${doc.name}. Call list_documents to see the headings.`, true);
      chunks = matched;
    }
    let out = "";
    for (const c of chunks) {
      const part = `## ${c.title}\n${c.text}\n\n`;
      if (out.length + part.length > MAX_READ_CHARS) {
        out += "…(more text in this file — ask for a specific section)";
        break;
      }
      out += part;
    }
    return text(out.trim());
  }
);

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not set (backend/.env)");
  await mongoose.connect(uri);
  console.error("[knowledge-server] MongoDB connected");
  await server.connect(new StdioServerTransport());
  console.error("[knowledge-server] running on stdio — tools: search_knowledge, list_documents, read_document");
}

main().catch((err) => {
  console.error("[knowledge-server] failed to start:", err);
  process.exit(1);
});
