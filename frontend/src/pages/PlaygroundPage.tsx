import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eraser, SendHorizontal, Wrench } from 'lucide-react'
import { PageHeader } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/button'
import { Badge, CodeBlock, Section, Spinner } from '@/components/ui/bits'
import { api, type ChatResponse, type Settings } from '@/lib/api'
import { cn } from '@/lib/utils'

type Msg = { role: 'user' | 'assistant'; content: string }
type Log = NonNullable<ChatResponse['toolLog']>[number] & { turn: number }

const newSession = () => 'pg-' + crypto.randomUUID()

export function PlaygroundPage() {
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/admin/settings') })
  const [session, setSession] = useState(newSession)
  const [messages, setMessages] = useState<Msg[]>([])
  const [logs, setLogs] = useState<Log[]>([])
  const [input, setInput] = useState('')
  const [buttons, setButtons] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  const chat = useMutation({
    mutationFn: ({ message }: { message: string; turn: number }) =>
      api.post<ChatResponse>('/api/chat', { message, sessionId: session, channel: 'playground' }),
    onSuccess: (r, { turn }) => {
      setMessages((m) => [...m, { role: 'assistant', content: r.reply }])
      setButtons(r.quickReplies ?? [])
      if (r.toolLog?.length) setLogs((l) => [...r.toolLog!.map((t) => ({ ...t, turn })), ...l])
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
    onError: (e) => setMessages((m) => [...m, { role: 'assistant', content: `⚠ ${e.message}` }]),
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, chat.isPending])

  function send(e?: FormEvent, override?: string) {
    e?.preventDefault()
    const text = (override ?? input).trim()
    if (!text || chat.isPending) return
    setMessages((m) => [...m, { role: 'user', content: text }])
    setInput('')
    setButtons([])
    chat.mutate({ message: text, turn: messages.filter((m) => m.role === 'user').length + 1 })
  }

  function reset() {
    setSession(newSession())
    setMessages([])
    setLogs([])
    setButtons([])
  }

  return (
    <>
      <PageHeader
        title="Playground"
        description="Talk to the bot exactly as a visitor would (published flow included) and watch the flow steps, file parts and MCP tools it uses on the right."
        actions={
          <Button variant="secondary" onClick={reset} disabled={!messages.length}>
            <Eraser /> Start over
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="flex h-[620px] flex-col rounded-lg border border-line bg-panel">
          <div className="flex-1 overflow-y-auto px-5 py-5">
            {messages.length === 0 ? (
              <div className="grid h-full place-items-center text-center">
                <div>
                  <p className="font-semibold">Say something to {settings.data?.botName ?? 'the bot'}</p>
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    {(settings.data?.quickReplies ?? []).map((q) => (
                      <button key={q} onClick={() => setInput(q)} className="rounded-full border border-line-strong px-3 py-1.5 text-[13px] hover:border-signal hover:text-signal">
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-3">
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={cn(
                      'max-w-[80%] whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-[14px]',
                      m.role === 'user' ? 'justify-self-end bg-signal text-white' : 'justify-self-start bg-paper'
                    )}
                  >
                    {m.content}
                  </div>
                ))}
                {buttons.length && !chat.isPending ? (
                  <div className="flex flex-wrap gap-1.5 justify-self-start">
                    {buttons.map((b) => (
                      <button key={b} onClick={() => send(undefined, b)} className="rounded-full border border-signal px-3 py-1.5 text-[13px] font-medium text-signal hover:bg-signal-soft">
                        {b}
                      </button>
                    ))}
                  </div>
                ) : null}
                {chat.isPending ? (
                  <div className="flex items-center gap-2 justify-self-start text-[13px] text-muted">
                    <Spinner className="size-3.5" /> Thinking — may be calling tools
                  </div>
                ) : null}
                <div ref={bottomRef} />
              </div>
            )}
          </div>
          <form onSubmit={send} className="flex gap-2 border-t border-line p-3">
            <label htmlFor="pg-input" className="sr-only">
              Message
            </label>
            <input
              id="pg-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Mera naam Rahul hai, mujhe bulk SMS chahiye…"
              maxLength={2000}
              className="h-10 flex-1 rounded-md border border-line-strong px-3 text-[14px] focus-visible:outline-signal"
            />
            <Button type="submit" className="h-10" disabled={chat.isPending || !input.trim()}>
              <SendHorizontal /> Send
            </Button>
          </form>
        </section>

        <Section title="What the bot did" description="Newest first: flow steps, file data the AI asked for (or was sent), and real MCP tool calls.">
          <div className="max-h-[540px] overflow-y-auto">
            {logs.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-10 text-center text-[13px] text-muted">
                <Wrench className="mb-2 size-6 text-faint" aria-hidden />
                No tools called yet. Ask about services or share your details to see one.
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {logs.map((l, i) => (
                  <li key={i} className="px-5 py-3">
                    <div className="mb-1.5 flex items-center gap-2">
                      {l.name === 'flow' ? (
                        <Badge tone="signal">Flow</Badge>
                      ) : l.name === 'knowledge_search' || l.name === 'knowledge_fallback' ? (
                        <Badge tone="signal">Files</Badge>
                      ) : l.name.startsWith('knowledge__') ? (
                        <Badge tone={l.isError ? 'fault' : 'live'}>AI asked</Badge>
                      ) : (
                        <Badge tone={l.isError ? 'fault' : 'live'}>{l.isError ? 'Error' : 'OK'}</Badge>
                      )}
                      <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] font-medium">
                        {l.name === 'flow'
                          ? 'flow steps'
                          : l.name === 'knowledge_search'
                            ? 'sent to AI from files'
                            : l.name === 'knowledge_fallback'
                              ? 'model can’t use tools → files sent'
                              : l.name.startsWith('knowledge__')
                                ? `MCP · ${l.name.slice('knowledge__'.length)}`
                                : l.name}
                      </code>
                      <span className="text-[12px] text-muted">
                        msg {l.turn}
                        {l.durationMs !== undefined ? ` · ${l.durationMs} ms` : ''}
                      </span>
                    </div>
                    <CodeBlock className="whitespace-pre-wrap text-[12px]">{`in:  ${JSON.stringify(l.input)}\nout: ${l.output}`}</CodeBlock>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
      </div>
    </>
  )
}
