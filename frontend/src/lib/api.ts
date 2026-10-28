/* Saare backend calls ek jagah. Vite proxy /api ko backend par bhejta hai. */

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Backend is not reachable. Start it with "npm run dev" in the backend folder.')
  }
  const data = await res.json().catch(() => ({}))
  // Login khatam ho gaya → AuthGate login page dikhayega
  if (res.status === 401 && url.startsWith('/api/admin')) window.dispatchEvent(new Event('auth:expired'))
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`)
  return data as T
}

/** File upload (multipart) — Knowledge base */
export async function uploadFiles<T>(url: string, files: File[]): Promise<T> {
  const form = new FormData()
  for (const f of files) form.append('files', f)
  let res: Response
  try {
    res = await fetch(url, { method: 'POST', body: form })
  } catch {
    throw new ApiError(0, 'Backend is not reachable.')
  }
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) window.dispatchEvent(new Event('auth:expired'))
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Upload failed (${res.status})`)
  return data as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
}

/* ───────── Types (backend responses) ───────── */
export type ServerStatus = 'connected' | 'connecting' | 'error' | 'disabled'

export type McpTool = {
  name: string
  fullName: string
  title?: string
  description?: string
  inputSchema: { type?: string; properties?: Record<string, JsonSchemaProp>; required?: string[] }
  enabled: boolean
}

export type JsonSchemaProp = {
  type?: string | string[]
  description?: string
  enum?: unknown[]
  pattern?: string
  format?: string
  default?: unknown
}

export type McpServerItem = {
  _id: string
  name: string
  slug: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled: boolean
  status: ServerStatus
  error?: string
  serverInfo?: { name: string; version: string }
  connectedAt?: string
  tools: McpTool[]
  resources: { uri: string; name: string; description?: string }[]
  prompts: { name: string; description?: string }[]
}

export type ToolRunResult = { text: string; isError: boolean; durationMs?: number }

export type Webhook = {
  _id: string
  name: string
  url: string
  events: string[]
  secret: string
  headers?: Record<string, string>
  active: boolean
  lastStatus?: number
  lastDeliveredAt?: string
  createdAt: string
}

export type Delivery = {
  _id: string
  webhookId: string
  webhookName: string
  event: string
  url: string
  payload: unknown
  attempt: number
  success: boolean
  statusCode?: number
  responseBody?: string
  error?: string
  durationMs: number
  createdAt: string
}

export type DeliveryResult = { success: boolean; statusCode?: number; error?: string; durationMs: number }

export type IncomingHook = {
  _id: string
  name: string
  token: string
  action: 'log' | 'chat' | 'tool'
  toolName?: string
  active: boolean
  lastReceivedAt?: string
  receivedCount: number
  createdAt: string
}

export type IncomingEvent = {
  _id: string
  hookId: string
  hookName: string
  payload: unknown
  headers: Record<string, string>
  result: string
  success: boolean
  createdAt: string
}

export type ProviderSetting = 'auto' | 'claude' | 'openai' | 'ollama' | 'demo'
export type ProviderName = 'claude' | 'openai' | 'ollama' | 'demo'
export type AiStatus = {
  active: ProviderName
  ready: boolean
  apiKeyConfigured: boolean
  detail: string
  ollama?: { running: boolean; models: string[] }
}

export type Settings = {
  botName: string
  provider: ProviderSetting
  ollamaUrl: string
  ollamaModel: string
  openaiBaseUrl: string
  openaiModel: string
  openaiKeyConfigured?: boolean
  recommendedPrompt?: string
  ai?: AiStatus
  model: string
  maxTokens: number
  welcomeMessage: string
  systemPrompt: string
  quickReplies: string[]
  brandColor: string
  widgetPosition: 'left' | 'right'
  maxToolRounds: number
  apiKeyConfigured?: boolean
}

export type Stats = {
  conversations: { total: number; last7d: number }
  leads: { total: number; last7d: number }
  webhooks: { active: number; deliveries7d: number; failed7d: number; incoming7d: number }
  mcp: { servers: number; connected: number; tools: number; list: { name: string; slug: string; status: ServerStatus; tools: number }[] }
  daily: { date: string; conversations: number }[]
  toolUsage: { name: string; count: number }[]
  ai: AiStatus
  activeFlow: { id: string; name: string } | null
  needsHuman: number
  knowledgeDocs: number
  recentConversations: {
    sessionId: string
    channel: string
    updatedAt: string
    messages: number
    toolCalls: number
    lastMessage: string
  }[]
  apiKeyConfigured: boolean
}

export type Conversation = {
  sessionId: string
  channel: string
  needsHuman?: boolean
  messages: { role: 'user' | 'assistant'; content: string; at: string }[]
  toolCalls: { name: string; input: unknown; output: string; isError: boolean; at: string }[]
  createdAt: string
}

export type ConversationRow = {
  sessionId: string
  channel: string
  createdAt: string
  updatedAt: string
  messages: number
  toolCalls: number
  firstMessage: string
  lastMessage: string
  leadSaved: boolean
  meetingBooked: boolean
  hadError: boolean
  needsHuman: boolean
}
export type ConversationList = { total: number; page: number; pages: number; items: ConversationRow[] }

export type AiTestResult = {
  ok: boolean
  reply?: string
  error?: string
  latencyMs: number
  toolCalling: boolean
  toolNote?: string
}

export type AuthUser = { id: string; email: string; name?: string | null }
export type AuthStatus = { needsSetup: boolean; user: AuthUser | null }

export type KnowledgeDoc = {
  _id: string
  name: string
  type: 'md' | 'txt' | 'pdf' | 'docx'
  size: number
  chars: number
  chunkCount: number
  enabled: boolean
  createdAt: string
}
export type KnowledgeOverview = {
  settings: { enabled: boolean; topK: number; maxChars: number }
  docs: KnowledgeDoc[]
  totals: { docs: number; chunks: number }
}
export type KnowledgeHit = { docName: string; title: string; text: string; score: number }
export type KnowledgeSearch = { hits: KnowledgeHit[]; sentChars: number; totalChars: number }
export type UploadResult = { results: { name: string; ok: boolean; chunks?: number; error?: string }[] }

export type FlowListItem = { _id: string; name: string; boxes: number; updatedAt: string; active: boolean }
export type FlowNodeData = Record<string, unknown> & { label?: string }
export type FlowDoc = {
  _id: string
  name: string
  nodes: { id: string; type: string; position: { x: number; y: number }; data: FlowNodeData }[]
  edges: { id: string; source: string; target: string; sourceHandle?: string | null }[]
  active: boolean
  tools: string[]
  updatedAt: string
}
export type FlowCheck = { errors: string[]; warnings: string[] }

export type Lead = {
  _id: string
  name: string
  phone: string
  email?: string
  service: string
  message?: string
  status: 'new' | 'contacted' | 'converted'
  createdAt: string
}
export type LeadList = { total: number; page: number; pages: number; items: Lead[]; counts: Record<string, number> }
export type Appointment = {
  _id: string
  bookingId: string
  name: string
  phone: string
  date: string
  time: string
  topic?: string
  status: 'booked' | 'cancelled'
  createdAt: string
}
export type AppointmentList = { total: number; page: number; pages: number; items: Appointment[] }

export type ChatResponse = {
  sessionId: string
  reply: string
  quickReplies?: string[]
  provider?: ProviderName | 'flow'
  toolLog?: { name: string; input: unknown; output: string; isError: boolean; durationMs?: number }[]
}
