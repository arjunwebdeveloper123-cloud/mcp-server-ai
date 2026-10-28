# Switchboard — MERN + MCP chatbot dashboard (TypeScript)

Ek admin dashboard jahan se aap apne website chatbot ko poora control karte ho:

| Page | Kya kar sakte ho |
|---|---|
| **Login** | Pehli baar admin account banao; uske baad email + password. Saare `/api/admin/*` login ke bina band |
| **Overview** | Visitors → Bot → MCP servers → Other apps ka live flow, 7 din ke stats, "team ka intezaar" alert |
| **Conversations** | Saari chats (Website / Playground / Webhook / Needs human), poora transcript, "Mark as handled", **CSV export** (summary + full chat history) |
| **Leads** | Search, status (New / Contacted / Converted), **CSV export** |
| **Appointments** | Upcoming / past, cancel, **CSV export** |
| **Flow builder** | **Boxes + arrows** (drag & drop): Message, Question, Buttons, Condition, AI reply, MCP tool, Webhook, Human handoff, End · Test panel · Publish |
| **Knowledge base** | `.md / .txt / .pdf / .docx` drag-drop upload · har sawaal par **sirf matching tukde** AI ko (poori file kabhi nahi) · "Try a question" |
| **MCP servers** | Multiple MCP servers connect karo (local command ya remote URL), har tool on/off, kisi bhi tool ko form se **test run** |
| **Webhooks** | Outgoing (lead aaye to CRM/Zapier/Sheet ko signed POST, auto-retry, delivery log, "Send again"), Incoming endpoints (record / bot se poochho / tool chalao) |
| **Playground** | Bot se baat karo aur live dekho kaunsa MCP tool kab chala |
| **Website widget** | Naam, welcome message, suggested questions, colour, position + live preview + embed code |
| **Bot settings** | AI provider (Demo / Free API / Ollama / Claude) + Test connection, Instructions, limits |

```
Website (embed.js → iframe /widget/chat)
        │  POST /api/chat
        ▼
Express backend ── AI provider (Demo / Free API / Ollama / Claude)
   │   │
   │   └── MCP manager ── stdio ──▶ mcp-server (leads)          ──▶ MongoDB
   │                   ├─ stdio ──▶ appointment-server (meetings) ──▶ MongoDB
   │                   └─ HTTP  ──▶ koi bhi remote MCP server
   │
   ├── Outgoing webhooks ──▶ Zapier / Make / n8n / CRM / Slack
   └── /hooks/in/:token  ◀── Incoming webhooks
        ▲
React dashboard (Vite + Tailwind + shadcn/ui) — /api/admin/*
```

## Folder structure

```
mern-mcp-chatbot/
├── package.json            ← root: ek command me sab chalao
├── MCP-SERVER-GUIDE.md     ← ⭐ apna MCP server khud banane ki step-by-step guide
├── mcp-server/             ← Lead server: get_services, save_lead, find_lead
├── appointment-server/     ← Appointment server: check_slots, book_meeting, cancel_meeting, my_bookings
├── backend/
│   └── src/
│       ├── index.ts        ← Express app, routes mount
│       ├── models/         ← Mongoose: Settings, McpServer, Webhook, Delivery, IncomingHook, Conversation, KnowledgeDoc/Chunk, Flow, User
│       ├── mcp/manager.ts  ← multiple MCP servers connect/disconnect, tools list, tools/call
│       ├── services/
│       │   ├── chat.ts     ← message → provider → MCP tools → reply → events
│       │   ├── providers/  ← demo.ts, openaiCompat.ts (Free API), ollama.ts, claude.ts
│       │   ├── knowledge.ts← file → text → chunks → BM25 search (sirf relevant tukde)
│       │   ├── flow.ts     ← flow engine (boxes chalana, variables, validation)
│       │   └── auth.ts     ← login: scrypt password + JWT cookie
│       │   └── webhooks.ts ← signed delivery, retry, emit()
│       ├── routes/         ← auth, mcp, webhooks (+incoming), core (chat, settings, stats), knowledge, flows, data (leads, appointments, CSV)
│       └── public/embed.js ← website par lagne wali script
└── frontend/
    └── src/
        ├── components/ui/  ← shadcn-style components (button, input, switch, dialog/sheet, tabs…)
        ├── components/layout/AppLayout.tsx ← sidebar
        ├── pages/          ← Overview, Conversations, Leads, Appointments, Flows, FlowEditor, Knowledge, Mcp, Webhooks, Playground, Widget, Settings
        ├── flow/           ← Flow builder: boxes.ts, BoxNode, Inspector, TestPanel (React Flow)
        └── widget/WidgetChat.tsx ← customer chat (iframe)
```

## API key nahi hai? Koi baat nahi

Dashboard → **Bot settings → AI provider** me chuno:

| Provider | Kharcha | Kya chahiye | Kaisa hai |
|---|---|---|---|
| **Demo mode** | Free | Kuch nahi | Fixed flow: services, lead (naam → phone → service → save), status, **meeting book/cancel**. Asli MCP tools, MongoDB aur webhooks sab chalte hain. Naye (aapke banaye) tools use nahi karta. |
| **Free API** | Free / sasta | `OPENAI_COMPAT_API_KEY` + base URL + model (Groq, Gemini, OpenRouter, ya koi bhi OpenAI-compatible) | Asli AI. **Test connection** button batata hai ki key aur tool calling chal rahe hain. |
| **Ollama** | Free | ollama.com se install + `ollama pull qwen2.5:7b` (~4.7 GB, ~8 GB RAM) | Asli AI, aapke computer par. Instructions follow karta hai, tools khud chunta hai. Claude se thoda kam smart/slow. |
| **Claude** | Paid (per token) | `ANTHROPIC_API_KEY` | Best quality. |
| **Automatic** (default) | — | — | Claude key → Claude, warna Free API key → Free API, warna Demo |

Provider badalne se baaki kuch nahi badalta — code `backend/src/services/providers/` me hai (`demo.ts`, `openaiCompat.ts`, `ollama.ts`, `claude.ts`).

> Purana database hai? **Bot settings → Instructions → "Use recommended"** dabao aur Save karo, taaki AI ko appointment wale steps bhi pata chalein.

## Knowledge base — "sirf zaroorat jitna data"

1. **Knowledge base** page par files drop karo (`.md`, `.txt`, `.pdf`, `.docx`, max 10 MB).
2. Har file headings ke hisaab se ~800 characters ke tukdon me tootti hai.
3. Customer ke har sawaal par **BM25 search** sabse milte 1–4 tukde chunta hai (limit: "Parts per question", "Characters per question").
4. **Sirf wahi tukde** AI ke prompt me jaate hain. Kuch match na ho to file ka koi data nahi jaata.
5. **Try a question** dikhata hai: "Sends 122 of 1,215 characters (10%)".

Same naam ki file dobara upload = purani replace. Scanned (image) PDF ka text nahi padha jaata.

## Flow builder (boxes + arrows)

**Flow builder → Start from template** → poora "Lead + meeting" flow khulta hai. Box kheencho, dots jodo, right side me settings, **Test** se bina publish kiye chalao, **Publish** karo → website bot isi flow se chalega.
Published flow na ho to bot pehle jaisa sirf AI provider se chalta hai. "AI reply" box me LLM + knowledge + MCP tools teeno kaam karte hain.

## Setup (Windows PowerShell)

```powershell
cd D:\chatbot-ai\mern-mcp-chatbot

# 1) Sab folders me packages install
npm run install:all          # naye packages aaye hain (multer, unpdf, mammoth, jsonwebtoken, @xyflow/react) — dobara chalao

# 2) env files
copy backend\.env.example backend\.env          # (zip me backend\.env pehle se hai to skip)
copy mcp-server\.env.example mcp-server\.env
copy appointment-server\.env.example appointment-server\.env
copy frontend\.env.example frontend\.env
```

`backend\.env` me **MONGO_URI** bharo (API key optional — na ho to bot Demo mode me chalega). Wahi `MONGO_URI` `mcp-server\.env` me bhi.

## Chalana

```powershell
cd D:\chatbot-ai\mern-mcp-chatbot
npm run dev
```

Ek hi terminal me backend + dashboard dono chalenge. Browser me kholo: **http://localhost:5173**

Alag-alag chalana ho to:

```powershell
cd backend;  npm run dev      # API → http://localhost:5000 (MCP servers khud start karta hai)
cd frontend; npm run dev      # Dashboard → http://localhost:5173
```

> `nodemon server.js` mat chalao — project TypeScript hai, `npm run dev` (tsx watch) wahi kaam karta hai.

## Pehli baar dashboard me

0. Dashboard kholte hi **"Create the admin account"** aayega — apna email + password (8+ characters) daalo. Password bhool jao to MongoDB ke `users` collection se user delete karke dobara setup karo.

1. **MCP servers** → "Lead server" aur "Appointment server" dono *Connected* (Appointment server pehli baar apne aap judta hai).
2. **Bot settings** → AI provider **Free API** → **Test connection** (ya Demo mode).
3. **Playground** → "Mera naam Rahul hai, 9876543210, website chahiye" → `leads__save_lead`. Phir "kal 4 baje meeting chahiye" → `appointments__check_slots` + `book_meeting`.
4. **Webhooks → Outgoing → Add webhook** → https://webhook.site se ek URL lo → event `lead.created` → **Send test**.
5. **Website widget** → embed code copy karke apni website ke `</body>` se pehle paste karo.

## Webhook format

```http
POST https://your-url
X-Webhook-Event: lead.created
X-Webhook-Id: evt_…
X-Webhook-Timestamp: 1767000000
X-Webhook-Signature: sha256=<HMAC_SHA256(secret, timestamp + "." + rawBody)>

{ "id": "evt_…", "event": "lead.created", "createdAt": "…",
  "data": { "sessionId": "…", "channel": "widget", "lead": { "name": "Rahul", "phone": "98…", "service": "website" } } }
```

Events: `conversation.started`, `message.received`, `message.sent`, `tool.called`, `tool.failed`, `lead.created`, `appointment.booked`, `appointment.cancelled`.
Fail (network / 5xx / 429) hone par 2s aur 10s baad dobara try hota hai.

**Incoming:** `POST http://localhost:5000/hooks/in/<token>`
- *Just record it* → payload save
- *Ask the bot* → body `{"message":"...","sessionId":"optional"}` → response me bot ka reply
- *Run a tool* → body = tool arguments

## Naya tool / naya MCP server add karna

Poori guide: **[MCP-SERVER-GUIDE.md](MCP-SERVER-GUIDE.md)** (FAQ server example, 7 steps).

- **Apne server me tool:** `mcp-server/src/index.ts` me naya `server.registerTool(...)` → dashboard me **Reconnect**.
- **Koi aur MCP server:** Dashboard → **MCP servers → Add server**
  - Local: command `npx`, arguments `-y` / `@modelcontextprotocol/server-filesystem` / `D:/docs`
  - Remote: URL + `Authorization: Bearer …` header

Tool names bot ko `<identifier>__<tool>` format me dikhte hain (jaise `leads__save_lead`), taaki do servers ke tools clash na karein.

## Production se pehle zaroor

- **Login hai**, lekin online daalne se pehle `.env` me ek lamba random `JWT_SECRET` daalo, HTTPS lagao, aur `HOST=0.0.0.0` tabhi karo.
- `.env` files kabhi git me commit mat karo (`.gitignore` me pehle se hain).
- `VITE_BACKEND_URL` (frontend) aur `WIDGET_URL`, `CLIENT_ORIGIN` (backend) ko real domains par set karo.
- stdio MCP server me `console.log` mat use karo — `console.error` use karo.
