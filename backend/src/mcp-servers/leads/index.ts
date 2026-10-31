import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { COMPANY, connectDB, Lead, SERVICES, SERVICE_IDS } from "./db.js";

const server = new McpServer({ name: "lead-server", version: "1.0.0" });

// Helper: MCP tool result hamesha { content: [...] } format me hota hai
const text = (t: string, isError = false) => ({
  content: [{ type: "text" as const, text: t }],
  isError,
});

/* ───────────────────────── TOOLS ─────────────────────────
   Tools = functions jo AI khud call kar sakta hai.
   description bahut important hai — AI isi ko padhkar decide karta hai. */

server.registerTool(
  "get_services",
  {
    title: "Get services",
    description: "List all services the company offers with starting prices. Use when the user asks what we do or about pricing.",
    inputSchema: {},
  },
  async () =>
    text(
      JSON.stringify(
        SERVICES.map(({ id, name, startingPrice, summary, page }) => ({ id, name, startingPrice, summary, page })),
        null,
        2
      ) + `\n\nAll prices + 18% GST. Full price list: ${COMPANY.pricingUrl}. Free demo: ${COMPANY.demoUrl}`
    )
);

server.registerTool(
  "save_lead",
  {
    title: "Save lead",
    description:
      "Save a customer enquiry. Call ONLY after you have collected the customer's name, a 10-digit phone number and the service they want. Ask for company name and monthly volume if the customer is willing (optional). Confirm details with the user first.",
    inputSchema: {
      name: z.string().min(2).describe("Customer full name"),
      phone: z.string().regex(/^[6-9]\d{9}$/, "Indian 10-digit mobile number").describe("10-digit mobile number"),
      service: z.enum(SERVICE_IDS).describe("Service id from get_services"),
      email: z.string().email().optional(),
      company: z.string().max(120).optional().describe("Customer's company / business name"),
      volume: z.string().max(60).optional().describe("Expected messages per month, e.g. '1 lakh'"),
      message: z.string().max(500).optional().describe("Any extra requirement the customer shared"),
    },
  },
  async (args) => {
    // Duplicate check: same phone + service in last 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dup = await Lead.findOne({ phone: args.phone, service: args.service, createdAt: { $gte: since } });
    if (dup) return text(`Lead already exists for this phone and service (id ${dup._id}). No new lead created.`);

    const lead = await Lead.create(args);
    return text(`Lead saved successfully. Reference id: ${lead._id}`);
  }
);

server.registerTool(
  "find_lead",
  {
    title: "Find lead",
    description: "Look up the status of an existing enquiry by phone number.",
    inputSchema: { phone: z.string().regex(/^[6-9]\d{9}$/) },
    annotations: { readOnlyHint: true },
  },
  async ({ phone }) => {
    const leads = await Lead.find({ phone }).sort({ createdAt: -1 }).limit(5).lean();
    if (!leads.length) return text("No enquiry found for this number.");
    return text(
      leads.map((l) => `${l.service} — status: ${l.status} — ${l.createdAt?.toISOString().slice(0, 10)}`).join("\n")
    );
  }
);

/* ───────────────────────── RESOURCE ─────────────────────────
   Resources = read-only data/context (app ya user attach karta hai). */
server.registerResource(
  "company-info",
  "info://company",
  { title: "Company info", description: "About the company, hours and contact", mimeType: "text/plain" },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        text:
          `${COMPANY.name} — ${COMPANY.about}\n` +
          `Phone / WhatsApp: ${COMPANY.phone} · Email: ${COMPANY.email} · ${COMPANY.website}\n` +
          `Head office: ${COMPANY.headOffice}. Other offices: ${COMPANY.otherOffices}.`,
      },
    ],
  })
);

/* ───────────────────────── PROMPT ─────────────────────────
   Prompts = ready-made templates jo user select karta hai. */
server.registerPrompt(
  "follow_up",
  {
    title: "Follow-up message",
    description: "Write a WhatsApp follow-up for a lead",
    argsSchema: { name: z.string(), service: z.string() },
  },
  ({ name, service }) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: `Write a short, friendly WhatsApp follow-up for ${name} who enquired about ${service}.` },
      },
    ],
  })
);

/* ───────────────────────── START ───────────────────────── */
async function main() {
  await connectDB(process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/chatbot");
  await server.connect(new StdioServerTransport());
  console.error("[leads-server] running on stdio");
}

main().catch((err) => {
  console.error("[leads-server] fatal:", err);
  process.exit(1);
});
