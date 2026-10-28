# Apna MCP server khud banao — step by step

Is guide me aap haath se ek **FAQ server** banaoge. Ye customer ke sawaal (payment, time, hosting…) ka jawab FAQ list se dhoondh ke deta hai.
Phir use dashboard se jodoge aur bot use karne lagega.

Time: ~20 minute. Pehle se project ke `mcp-server/` aur `appointment-server/` folders dekh lo — dono isi pattern par bane hain.

```
mern-mcp-chatbot/
├── mcp-server/           ← Lead server (3 tools)
├── appointment-server/   ← Appointment server (4 tools)
├── faq-server/           ← ⭐ ye aap banaoge
├── backend/
└── frontend/
```

---

## Step 1 — Folder banao aur packages install karo

```powershell
cd D:\chatbot-ai\mern-mcp-chatbot
mkdir faq-server
cd faq-server
mkdir src

npm init -y
npm install @modelcontextprotocol/sdk zod
npm install -D typescript tsx @types/node

copy ..\appointment-server\tsconfig.json .
```

| Package | Kaam |
|---|---|
| `@modelcontextprotocol/sdk` | MCP ka official SDK — server banane ka saara kaam |
| `zod` | Tool ke input ke rules (jaise "kam se kam 2 akshar") |
| `typescript`, `tsx` | TypeScript likhna aur seedha chalana |

## Step 2 — `package.json` me 2 cheezein jodo

`faq-server/package.json` kholo aur ye daalo (baaki jo hai rehne do):

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "inspect": "npx @modelcontextprotocol/inspector tsx src/index.ts"
  }
}
```

`"type": "module"` zaroori hai — iske bina `import` wali lines error dengi.

## Step 3 — Server ka code likho

`faq-server/src/index.ts` banao:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 1) Server banao — naam aur version
const server = new McpServer({ name: "faq-server", version: "1.0.0" });

// 2) Data — abhi simple array. Baad me MongoDB se bhi la sakte ho.
const FAQS = [
  { q: "Website banne me kitna time lagta hai?", a: "Normal business website 7–15 din me ready ho jaati hai." },
  { q: "Kya aap domain aur hosting bhi dete ho?", a: "Haan, domain + 1 saal hosting package me shamil hai." },
  { q: "Payment kaise hota hai?", a: "50% advance, 50% website live hone par. UPI, bank transfer dono chalte hain." },
  { q: "Kya website mobile par bhi chalegi?", a: "Haan, har website mobile, tablet aur desktop sab par chalti hai." },
];

// 3) Tool — AI isko call karega
server.registerTool(
  "search_faq",
  {
    title: "Search FAQ",
    description:
      "Search the company's frequently asked questions. Use this when the customer asks about timelines, payment, hosting, or how the work is done.",
    inputSchema: {
      query: z.string().min(2).describe("The customer's question or a keyword, e.g. 'payment'"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query }) => {
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const hits = FAQS.filter((f) => words.some((w) => (f.q + " " + f.a).toLowerCase().includes(w)));
    const text = hits.length
      ? hits.map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n\n")
      : "No matching FAQ found. Tell the customer the team will answer this personally.";
    return { content: [{ type: "text", text }] };
  }
);

// 4) Server chalu karo (stdio)
async function main() {
  await server.connect(new StdioServerTransport());
  console.error("[faq-server] running on stdio"); // console.log NAHI!
}
main();
```

### Code ke 4 hisse samjho

| Hissa | Kya karta hai |
|---|---|
| `new McpServer({...})` | Server ka naam — dashboard me "Reports as faq-server 1.0.0" yahi dikhega |
| `registerTool(name, config, function)` | Ek tool banata hai. **description** sabse zaroori hai — AI isi ko padh ke decide karta hai ki tool kab chalana hai |
| `inputSchema` (zod) | Tool ko kya input chahiye aur uske rules. Galat input par MCP khud error de deta hai |
| `return { content: [{ type: "text", text }] }` | Tool ka jawab hamesha isi format me |
| `StdioServerTransport` | Backend is server se stdin/stdout ke through baat karega |

## Step 4 — Akele test karo (MCP Inspector)

```powershell
cd D:\chatbot-ai\mern-mcp-chatbot\faq-server
npm run inspect
```

Browser me Inspector khulega → **Connect** → **Tools** → **List Tools** → `search_faq` → query me `payment` likho → **Run Tool**.
Jawab me payment wala FAQ aana chahiye. ✅

## Step 5 — Dashboard se jodo

1. Backend chalu ho (`npm run dev`), dashboard kholo: http://localhost:5173
2. **MCP servers → Add server**
3. Bharo:

| Field | Value |
|---|---|
| Name | `FAQ server` |
| Identifier | `faq` |
| How does it run? | **On this computer** |
| Command | `npx` |
| Arguments (har line me ek) | `tsx`<br>`../faq-server/src/index.ts` |

4. **Add and connect** → green **Connected** aur tool `search_faq` dikhna chahiye.
5. `search_faq` ke aage **Test** dabao → `payment` → **Run tool**.

Bot ko ye tool `faq__search_faq` naam se dikhega (identifier + `__` + tool name).

## Step 6 — Bot ko batao kab use karna hai

**Bot settings → Instructions** me ek line jodo:

```
10. If they ask about timelines, payment, hosting or how we work, use the FAQ search tool and answer only from its result.
```

**Save settings**.

> ⚠️ **Demo mode naye tools use nahi karta** — uska flow fixed hai (leads + appointments).
> Naya tool AI hi samajhta hai, isliye **AI provider** me **Free API**, **Ollama** ya **Claude** chuno.

## Step 7 — Playground me try karo

"Payment kaise karna hota hai?" likho → right side me `faq__search_faq` chalta dikhega aur bot FAQ wala jawab dega. 🎉

---

## Har naye MCP server ke liye checklist

- [ ] `package.json` me `"type": "module"`
- [ ] Har tool ka **description** saaf ho: *kya karta hai* aur *kab use karna hai*
- [ ] Input `zod` se validate — phone, date, email ke rules
- [ ] Jawab hamesha `{ content: [{ type: "text", text }] }`, galti par `isError: true`
- [ ] **`console.log` kabhi nahi** — stdout sirf MCP messages ke liye. Logs ke liye `console.error`
- [ ] Error ka message AI ke samajhne layak ho ("Phone must be 10 digits"), sirf "failed" nahi
- [ ] Pehle Inspector se test, phir dashboard me jodo
- [ ] Bot settings → Instructions me batao tool kab use karna hai

## MongoDB chahiye to

`appointment-server/src/db.ts` jaisa ek `db.ts` banao, `npm install mongoose dotenv` karo, aur `index.ts` ke `main()` me pehle `await mongoose.connect(process.env.MONGO_URI!)` karo.
Backend jab server chalata hai to uski `.env` ki values (jaise `MONGO_URI`) server tak pahunch jaati hain.

## Kuch galat ho to

| Dikkat | Wajah / fix |
|---|---|
| `Cannot use import statement outside a module` | `package.json` me `"type": "module"` nahi hai |
| Dashboard me **Not connected** | Arguments ka path galat hai — backend folder se relative hona chahiye (`../faq-server/src/index.ts`) |
| Connected hai par tools 0 | `registerTool` se pehle code crash ho raha hai — backend terminal me `[faq-server]` wali lines dekho |
| Connection turant toot jata hai | Code me kahin `console.log` hai — `console.error` karo |
| Bot tool use hi nahi karta | Demo mode chal raha hai, ya description/instructions saaf nahi hain |
| Tool chala par galat input bheja | `inputSchema` ke `.describe()` me example do ("YYYY-MM-DD", "10-digit") |

## Aage kya bana sakte ho

| Server idea | Tools |
|---|---|
| **Content calendar** | `add_post`, `list_posts(month, platform)`, `update_post_status` |
| **Quotation** | `create_quote(service, pages)`, `get_quote(id)` |
| **Google Sheets** | `append_row`, `find_rows` (googleapis package) |
| **WhatsApp** | `send_whatsapp(phone, message)` (WhatsApp Cloud API) |
