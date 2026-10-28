import { useEffect, useRef, useState, type FormEvent } from 'react'
import { RotateCcw, SendHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/bits'
import { api, type ChatResponse } from '@/lib/api'
import { cn } from '@/lib/utils'

type Msg = { role: 'user' | 'assistant'; content: string; buttons?: string[]; trace?: string }

/** Draft flow ko yahin chala ke dekho (publish kiye bina) */
export function TestPanel({ flowId, onClose }: { flowId: string; onClose: () => void }) {
  const [session, setSession] = useState(() => 'test-' + crypto.randomUUID())
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages, pending])

  async function send(text: string) {
    const t = text.trim()
    if (!t || pending) return
    setMessages((m) => [...m, { role: 'user', content: t }])
    setInput('')
    setPending(true)
    try {
      const r = await api.post<ChatResponse>('/api/chat', { message: t, sessionId: session, channel: 'playground', testFlowId: flowId })
      const trace = r.toolLog?.find((x) => x.name === 'flow')?.output
      setMessages((m) => [...m, { role: 'assistant', content: r.reply, buttons: r.quickReplies, trace }])
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠ ${e instanceof Error ? e.message : 'Failed'}` }])
    } finally {
      setPending(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    send(input)
  }
  const last = messages[messages.length - 1]

  return (
    <aside className="flex h-full w-full flex-col border-l border-line bg-panel" aria-label="Test this flow">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <p className="font-semibold">Test this flow</p>
          <p className="text-[12px] text-muted">Runs the saved draft. Customers don’t see it.</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setSession('test-' + crypto.randomUUID())
              setMessages([])
            }}
            aria-label="Restart test"
          >
            <RotateCcw />
          </Button>
          <button onClick={onClose} className="rounded p-1.5 text-muted hover:bg-paper hover:text-ink" aria-label="Close test">
            <X className="size-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto bg-paper/60 px-4 py-4">
        {messages.length === 0 ? <p className="mt-8 text-center text-[13px] text-muted">Type “hi” to start the flow.</p> : null}
        <div className="grid gap-2.5">
          {messages.map((m, i) => (
            <div key={i} className={cn('grid gap-1', m.role === 'user' ? 'justify-items-end' : 'justify-items-start')}>
              <div className={cn('max-w-[88%] whitespace-pre-wrap rounded-lg px-3 py-2 text-[13px]', m.role === 'user' ? 'bg-signal text-white' : 'bg-panel shadow-sm')}>{m.content}</div>
              {m.trace ? <p className="max-w-[88%] font-mono text-[11px] text-faint">{m.trace}</p> : null}
            </div>
          ))}
          {pending ? <Spinner className="size-3.5 text-muted" /> : null}
          <div ref={bottom} />
        </div>
      </div>

      {last?.role === 'assistant' && last.buttons?.length && !pending ? (
        <div className="flex flex-wrap gap-1.5 border-t border-line px-3 pt-2.5">
          {last.buttons.map((b) => (
            <button key={b} onClick={() => send(b)} className="rounded-full border border-signal px-2.5 py-1 text-[12.5px] font-medium text-signal hover:bg-signal-soft">
              {b}
            </button>
          ))}
        </div>
      ) : null}
      <form onSubmit={submit} className="flex gap-2 p-3">
        <label htmlFor="flow-test-input" className="sr-only">
          Message
        </label>
        <input
          id="flow-test-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          className="h-9 flex-1 rounded-md border border-line-strong px-3 text-[13px] focus-visible:outline-signal"
        />
        <Button type="submit" size="icon" className="h-9 w-9" disabled={pending || !input.trim()} aria-label="Send">
          <SendHorizontal />
        </Button>
      </form>
    </aside>
  )
}
