# Apna MCP server khud banao — step by step

Is guide me aap haath se ek **FAQ server** banaoge. Ye customer ke sawaal (DLT, onboarding, payment…) ka jawab FAQ list se dhoondh ke deta hai.
Phir use dashboard se jodoge aur bot use karne lagega.

Time: ~15 minute. Saare MCP servers **backend ke andar** rehte hain — alag folder, alag `package.json`, alag `npm install` nahi.
Pehle `backend/src/mcp-servers/` ke teen servers dekh lo — sab isi pattern par bane hain.

```
mcp-server-ai/
├── backend/
│   └── src/
│       └── mcp-servers/
│           ├── leads/          ← Lead server (3 tools)
│           ├── appointments/   ← Appointment server (4 tools)
│           ├── knowledge/      ← Knowledge server (3 tools)
│           └── faq/            ← ⭐ ye aap banaoge
└── frontend/
```

Backend me pehle se ye packages hain, kuch install nahi karna:

| Package | Kaam |
|---|---|
| `@modelcontextprotocol/sdk` | MCP ka official SDK — server banane ka saara kaam |
| `zod` | Tool ke input ke rules (jaise "kam se kam 2 akshar") |
| `tsx` | TypeScript seedha chalana |
| `mongoose`, `dotenv` | Database aur `backend/.env` padhna |

---

## Step 1 — Folder aur file banao

`backend/src/mcp-servers/faq/index.ts` banao:

```ts
import "dotenv/config"; // backend/.env padh lo (MONGO_URI waghera, zaroorat ho to)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 1) Server banao — naam aur version
const server = new McpServer({ name: "faq-server", version: "1.0.0" });

// 2) Data — abhi simple array. Baad me MongoDB se bhi la sakte ho.
const FAQS = [
  { q: "Account kitne din me ready hota hai?", a: "WhatsApp API ka onboarding kuch hi dino me ho jaata hai; SMS ke liye pehle DLT registration chahiye." },
  { q: "Payment kaise hota hai?", a: "Packages prepaid hain. UPI aur bank transfer dono chalte hain. Har payment par GST invoice milta hai." },
  { q: "Kya API documentation milti hai?", a: "Haan, signup ke baad API docs aur test credits milte hain; team integration me madad karti hai." },
  { q: "Report kahan dekhein?", a: "Dashboard me har campaign ki delivery, read aur click report real-time dikhti hai." },
];

// 3) Tool — AI isko call karega
server.registerTool(
  "search_faq",
  {
    title: "Search FAQ",
    description:
      "Search the company's frequently asked questions. Use this when the customer asks about onboarding time, payment, API docs or reports.",
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

## Step 2 — Inspector script jodo (optional)

`backend/package.json` ke `"scripts"` me ek line:

```json
"inspect:faq": "npx @modelcontextprotocol/inspector npx tsx src/mcp-servers/faq/index.ts"
```

## Step 3 — Akele test karo (MCP Inspector)

```powershell
cd D:\chatbot-ai\step5\mern-mcp-chatbot\backend
npm run inspect:faq
```

Browser me Inspector khulega → **Connect** → **Tools** → **List Tools** → `search_faq` → query me `payment` likho → **Run Tool**.
Jawab me payment wala FAQ aana chahiye. ✅

## Step 4 — Dashboard se jodo

1. Backend chalu ho (`npm run dev`), dashboard kholo: http://localhost:5173
2. **MCP servers → Add server**
3. Bharo:

| Field | Value |
|---|---|
| Name | `FAQ server` |
| Identifier | `faq` |
| How does it run? | **On this computer** |
| Command | `npx` |
| Arguments (har line me ek) | `tsx`<br>`./src/mcp-servers/faq/index.ts` |

4. **Add and connect** → green **Connected** aur tool `search_faq` dikhna chahiye.
5. `search_faq` ke aage **Test** dabao → `payment` → **Run tool**.

Bot ko ye tool `faq__search_faq` naam se dikhega (identifier + `__` + tool name).

## Step 5 — Bot ko batao kab use karna hai

**Bot settings → Instructions** me ek line jodo:

```
10. If they ask about onboarding time, payment, API docs or reports, use the FAQ search tool and answer only from its result.
```

**Save settings**.

> ⚠️ **Demo mode naye tools use nahi karta** — uska flow fixed hai (leads + demo booking).
> Naya tool AI hi samajhta hai, isliye **AI provider** me **Claude** ya **Free API** chuno.

## Step 6 — Playground me try karo

"Payment kaise karna hota hai?" likho → right side me `faq__search_faq` chalta dikhega aur bot FAQ wala jawab dega. 🎉

---

## Har naye MCP server ke liye checklist

- [ ] File `backend/src/mcp-servers/<naam>/index.ts` me
- [ ] Har tool ka **description** saaf ho: *kya karta hai* aur *kab use karna hai*
- [ ] Input `zod` se validate — phone, date, email ke rules
- [ ] Jawab hamesha `{ content: [{ type: "text", text }] }`, galti par `isError: true`
- [ ] **`console.log` kabhi nahi** — stdout sirf MCP messages ke liye. Logs ke liye `console.error`
- [ ] Error ka message AI ke samajhne layak ho ("Phone must be 10 digits"), sirf "failed" nahi
- [ ] Pehle Inspector se test, phir dashboard me jodo
- [ ] Bot settings → Instructions me batao tool kab use karna hai

## MongoDB chahiye to

`backend/src/mcp-servers/appointments/db.ts` jaisa ek `db.ts` banao (model + `connectDB`), aur `index.ts` ke `main()` me pehle `await connectDB(process.env.MONGO_URI!)` karo.
`MONGO_URI` aur baaki settings `backend/.env` se aati hain — ek hi `.env` sab servers ke liye.
Backend ke models / services bhi seedha import kar sakte ho (jaise Knowledge server `../../services/knowledge.js` se `searchKnowledge()` leta hai).

## Kuch galat ho to

| Dikkat | Wajah / fix |
|---|---|
| Dashboard me **Not connected** | Arguments ka path galat hai — backend folder se relative hona chahiye (`./src/mcp-servers/faq/index.ts`) |
| `Cannot find module` | Import path me `.js` lagao (`./db.js`), TypeScript file hone par bhi |
| Connected hai par tools 0 | `registerTool` se pehle code crash ho raha hai — backend terminal me `[faq-server]` wali lines dekho |
| Connection turant toot jata hai | Code me kahin `console.log` hai — `console.error` karo |
| Bot tool use hi nahi karta | Demo mode chal raha hai, ya description/instructions saaf nahi hain |
| Tool chala par galat input bheja | `inputSchema` ke `.describe()` me example do ("YYYY-MM-DD", "10-digit") |

## Server ko alag project banana ho to

Kabhi kisi server ko dusri team ya Claude Desktop ko alag dena ho: uska folder backend se bahar copy karo, usme `npm init -y`, `npm install @modelcontextprotocol/sdk zod dotenv` aur `package.json` me `"type": "module"` daalo. Code wahi rahega — MCP server kahin bhi chal sakta hai.
