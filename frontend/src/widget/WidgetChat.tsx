import { useEffect, useRef, useState, type FormEvent } from 'react'
import { SendHorizontal } from 'lucide-react'
import { api, type ChatResponse } from '@/lib/api'

export type WidgetConfig = {
  botName: string
  welcomeMessage: string
  quickReplies: string[]
  brandColor: string
}

type Msg = { role: 'user' | 'assistant'; content: string }

const SESSION_KEY = 'chatbot-session'
function loadSession() {
  try {
    return localStorage.getItem(SESSION_KEY) ?? undefined
  } catch {
    return undefined
  }
}
function saveSession(id: string) {
  try {
    localStorage.setItem(SESSION_KEY, id)
  } catch {
    /* storage blocked — har reload par nayi conversation */
  }
}

/** Customer ko dikhne wala chat. Website par iframe (/widget/chat) me chalta hai.
    `preview` mode me dashboard ke andar sirf dikhane ke liye. */
export function WidgetChat({ preview }: { preview?: WidgetConfig }) {
  const [config, setConfig] = useState<WidgetConfig | null>(preview ?? null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [buttons, setButtons] = useState<string[]>([]) // flow ke Buttons box ke options
  const sessionRef = useRef<string | undefined>(preview ? undefined : loadSession())
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (preview) {
      setConfig(preview)
      return
    }
    api
      .get<WidgetConfig>('/api/widget/config')
      .then(setConfig)
      .catch(() => setConfig({ botName: 'Chat', welcomeMessage: 'Hi! How can I help?', quickReplies: [], brandColor: '#2747d6' }))
  }, [preview])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, loading])

  async function send(text: string) {
    const content = text.trim()
    if (!content || loading || preview) return
    setMessages((m) => [...m, { role: 'user', content }])
    setInput('')
    setButtons([])
    setLoading(true)
    try {
      const r = await api.post<ChatResponse>('/api/chat', { message: content, sessionId: sessionRef.current })
      sessionRef.current = r.sessionId
      saveSession(r.sessionId)
      setMessages((m) => [...m, { role: 'assistant', content: r.reply }])
      setButtons(r.quickReplies ?? [])
    } catch (e) {
      const msg = e instanceof Error && /Too many/.test(e.message) ? 'You’re sending messages quickly — wait a moment and try again.' : 'Couldn’t reach the assistant. Check your connection and try again.'
      setMessages((m) => [...m, { role: 'assistant', content: msg }])
    } finally {
      setLoading(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    send(input)
  }

  if (!config) return <div className="grid h-full place-items-center bg-white text-sm text-muted">Loading…</div>
  const color = config.brandColor
  const shown: Msg[] = preview ? [{ role: 'user', content: 'Mujhe website banwani hai' }] : messages

  return (
    <div className="flex h-full min-h-[420px] flex-col bg-white text-ink">
      <header className="flex items-center gap-3 px-4 py-3 text-white" style={{ background: color }}>
        <div className="grid size-8 place-items-center rounded-full bg-white/20 text-[13px] font-semibold">{config.botName.slice(0, 1).toUpperCase()}</div>
        <div className="min-w-0">
          <p className="truncate text-[14.5px] font-semibold">{config.botName}</p>
          <p className="text-[12px] opacity-80">{loading ? 'Typing…' : 'Usually replies in seconds'}</p>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto bg-[#f7f8fa] px-3.5 py-4" aria-live="polite">
        <Bubble role="assistant" color={color}>
          {config.welcomeMessage}
        </Bubble>
        {shown.map((m, i) => (
          <Bubble key={i} role={m.role} color={color}>
            {m.content}
          </Bubble>
        ))}
        {loading ? (
          <div className="flex gap-1 self-start rounded-2xl rounded-bl-sm bg-white px-3.5 py-3 shadow-sm">
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-1.5 animate-pulse rounded-full bg-faint" style={{ animationDelay: `${i * 150}ms` }} />
            ))}
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {(shown.length === 0 ? config.quickReplies : loading ? [] : buttons).length ? (
        <div className="flex flex-wrap gap-1.5 bg-[#f7f8fa] px-3.5 pb-3">
          {(shown.length === 0 ? config.quickReplies : buttons).map((q) => (
            <button
              key={q}
              onClick={() => send(q)}
              className="rounded-full border bg-white px-3 py-1.5 text-[13px] font-medium"
              style={{ borderColor: color, color }}
            >
              {q}
            </button>
          ))}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-line px-3 py-2.5">
        <label htmlFor="widget-input" className="sr-only">
          Message
        </label>
        <input
          id="widget-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          maxLength={2000}
          disabled={Boolean(preview)}
          className="h-10 flex-1 rounded-full bg-[#f1f3f6] px-4 text-[14px] outline-none focus-visible:ring-2"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="grid size-10 place-items-center rounded-full text-white disabled:opacity-40"
          style={{ background: color }}
          aria-label="Send message"
        >
          <SendHorizontal className="size-4" />
        </button>
      </form>
    </div>
  )
}

function Bubble({ role, color, children }: { role: 'user' | 'assistant'; color: string; children: React.ReactNode }) {
  return role === 'user' ? (
    <div className="max-w-[82%] self-end whitespace-pre-wrap rounded-2xl rounded-br-sm px-3.5 py-2 text-[14px] text-white" style={{ background: color }}>
      {children}
    </div>
  ) : (
    <div className="max-w-[82%] self-start whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-white px-3.5 py-2 text-[14px] shadow-sm">{children}</div>
  )
}
