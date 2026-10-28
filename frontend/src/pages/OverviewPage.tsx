import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { MessagesSquare } from 'lucide-react'
import { PageHeader } from '@/components/layout/AppLayout'
import { Dialog, Sheet } from '@/components/ui/dialog'
import { Badge, CodeBlock, Empty, ErrorNote, Section, Spinner, StatusDot } from '@/components/ui/bits'
import { api, type Conversation, type Settings, type Stats } from '@/lib/api'
import { cn, timeAgo } from '@/lib/utils'

export function OverviewPage() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api.get<Stats>('/api/admin/stats'), refetchInterval: 15_000 })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/admin/settings') })
  const [openSession, setOpenSession] = useState<string | null>(null)

  if (stats.isLoading)
    return (
      <div className="flex items-center gap-2 text-muted">
        <Spinner /> Loading…
      </div>
    )
  if (stats.isError) return <ErrorNote error={stats.error} />
  const s = stats.data!

  const maxDay = Math.max(1, ...s.daily.map((d) => d.conversations))
  const maxTool = Math.max(1, ...s.toolUsage.map((t) => t.count))
  const anyLive = s.mcp.connected > 0

  return (
    <>
      <PageHeader title="Overview" description="How messages flow from your website through the bot to your tools and other apps — last 7 days." />

      {s.needsHuman ? (
        <Link to="/conversations" className="mb-4 block rounded-lg border border-warn/25 bg-warn-soft px-5 py-3 text-[13.5px] text-warn hover:border-warn/50">
          <span className="font-semibold">
            {s.needsHuman} {s.needsHuman === 1 ? 'customer is' : 'customers are'} waiting for your team.
          </span>{' '}
          Open Conversations → “Needs human”.
        </Link>
      ) : null}

      {/* ───── The wiring: one picture of the whole system ───── */}
      <section aria-label="System flow" className="mb-6 rounded-lg border border-line bg-panel p-5 sm:p-6">
        <div className="grid items-stretch gap-3 lg:grid-cols-[1fr_44px_1fr_44px_1.2fr_44px_1fr] lg:gap-0">
          <Node to="/conversations" title="Visitors" meta="Website widget and playground">
            <Big n={s.conversations.last7d} label="conversations" />
            <Small>{s.conversations.total} all time</Small>
          </Node>

          <Wire live={s.ai.ready} />

          <Node to="/settings" title={settings.data?.botName ?? 'Bot'} meta={s.activeFlow ? `Flow · ${s.activeFlow.name}` : providerLabel(s.ai.active, settings.data)} accent>
            <Big n={s.leads.last7d} label="leads captured" />
            <Small>{s.leads.total} all time</Small>
            {!s.ai.ready ? <p className="mt-2 text-[12.5px] text-[#f5c27a]">Can't reply: {s.ai.detail}</p> : null}
          </Node>

          <Wire live={s.ai.ready && anyLive} broken={s.mcp.servers > 0 && !anyLive} />

          <Node to="/mcp" title="MCP servers" meta={`${s.mcp.tools} tools the bot can use`}>
            {s.mcp.list.length ? (
              <ul className="mt-1 grid gap-1.5">
                {s.mcp.list.map((m) => (
                  <li key={m.slug} className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="truncate">{m.name}</span>
                    <StatusDot status={m.status} showLabel={false} />
                  </li>
                ))}
              </ul>
            ) : (
              <Small>None connected yet</Small>
            )}
          </Node>

          <Wire live={s.webhooks.active > 0} broken={s.webhooks.failed7d > 0} />

          <Node to="/webhooks" title="Other apps" meta={`${s.webhooks.active} active webhooks`}>
            <Big n={s.webhooks.deliveries7d} label="events sent" />
            <Small className={s.webhooks.failed7d ? 'text-fault' : undefined}>
              {s.webhooks.failed7d ? `${s.webhooks.failed7d} failed` : 'No failures'} · {s.webhooks.incoming7d} received
            </Small>
          </Node>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <Section title="Conversations per day" className="lg:col-span-3">
          <div className="flex h-44 items-end gap-2 px-5 pt-5 pb-3" role="img" aria-label="Conversations per day, last 7 days">
            {s.daily.map((d) => {
              const day = new Date(d.date + 'T00:00:00')
              return (
                <div key={d.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                  <span className="text-[12px] text-muted">{d.conversations || ''}</span>
                  <div
                    className={cn('w-full max-w-10 rounded-t-sm', d.conversations ? 'bg-signal' : 'bg-line')}
                    style={{ height: `${Math.max(3, (d.conversations / maxDay) * 100)}%` }}
                  />
                  <span className="text-[12px] text-muted">{day.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
                </div>
              )
            })}
          </div>
        </Section>

        <Section title="Most used tools" className="lg:col-span-2">
          {s.toolUsage.length ? (
            <ul className="grid gap-3 px-5 py-4">
              {s.toolUsage.map((t) => (
                <li key={t.name}>
                  <div className="mb-1 flex justify-between text-[13px]">
                    <code className="font-mono">{t.name}</code>
                    <span className="text-muted">{t.count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-paper">
                    <div className="h-full rounded-full bg-ink-2" style={{ width: `${(t.count / maxTool) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-[13px] text-muted">No tool calls this week. Ask about services in the playground to see one.</p>
          )}
        </Section>
      </div>

      <Section
        title="Latest conversations"
        className="mt-6"
        actions={
          <Link to="/conversations" className="text-[13px] font-medium text-signal hover:underline">
            View all
          </Link>
        }
      >
        {s.recentConversations.length ? (
          <ul className="divide-y divide-line">
            {s.recentConversations.map((c) => (
              <li key={c.sessionId}>
                <button onClick={() => setOpenSession(c.sessionId)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-paper/70">
                  <Badge>{c.channel}</Badge>
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">{c.lastMessage || '—'}</span>
                  <span className="text-[12.5px] text-muted">
                    {c.messages} messages{c.toolCalls ? `, ${c.toolCalls} tool calls` : ''}
                  </span>
                  <span className="w-20 text-right text-[12.5px] text-muted">{timeAgo(c.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon={<MessagesSquare />} title="No conversations yet" body="Open the playground and say hello — your first conversation will appear here." />
        )}
      </Section>

      <Dialog open={openSession !== null} onOpenChange={(o) => !o && setOpenSession(null)}>
        {openSession ? <Transcript sessionId={openSession} /> : null}
      </Dialog>
    </>
  )
}

function providerLabel(active: Stats['ai']['active'], st?: Settings) {
  if (active === 'demo') return 'Demo mode · no AI'
  if (active === 'ollama') return `Ollama · ${st?.ollamaModel ?? ''}`
  if (active === 'openai') return `Free API · ${st?.openaiModel ?? ''}`
  return `Claude · ${st?.model ?? ''}`
}

function Node({ to, title, meta, accent, children }: { to: string; title: string; meta: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={cn(
        'block rounded-md border px-4 py-3.5 transition-colors hover:border-signal',
        accent ? 'border-ink bg-ink text-white hover:border-signal' : 'border-line-strong bg-panel'
      )}
    >
      <p className="font-semibold">{title}</p>
      <p className={cn('truncate text-[12.5px]', accent ? 'text-[#aab4c4]' : 'text-muted')}>{meta}</p>
      <div className="mt-3">{children}</div>
    </Link>
  )
}

function Big({ n, label }: { n: number; label: string }) {
  return (
    <p className="flex items-baseline gap-1.5">
      <span className="text-[26px] font-semibold tabular-nums leading-none tracking-tight">{n}</span>
      <span className="text-[13px] opacity-75">{label}</span>
    </p>
  )
}

function Small({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('mt-1 text-[12.5px] opacity-70', className)}>{children}</p>
}

/** Connection between two nodes: moving dashes when traffic can flow */
function Wire({ live, broken }: { live: boolean; broken?: boolean }) {
  const color = broken ? 'var(--color-fault)' : live ? 'var(--color-signal)' : 'var(--color-line-strong)'
  return (
    <div className="flex items-center justify-center" aria-hidden>
      <svg className="h-6 w-6 rotate-90 lg:h-6 lg:w-11 lg:rotate-0" viewBox="0 0 44 24">
        <line x1="0" y1="12" x2="38" y2="12" stroke={color} strokeWidth="2" className={live && !broken ? 'wire-flow' : undefined} strokeDasharray={live ? undefined : '3 4'} />
        <path d="M34 7l6 5-6 5" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

export function Transcript({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['conversation', sessionId], queryFn: () => api.get<Conversation>(`/api/admin/stats/conversations/${sessionId}`) })
  const resolve = useMutation({
    mutationFn: () => api.post(`/api/admin/stats/conversations/${sessionId}/resolve`),
    onSuccess: () => {
      toast.success('Handled — the bot will reply again')
      qc.invalidateQueries({ queryKey: ['conversation', sessionId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })
  // Messages aur tool calls ko time ke hisaab se ek timeline me
  const items = q.data
    ? [
        ...q.data.messages.map((m) => ({ kind: 'msg' as const, at: m.at, m })),
        ...q.data.toolCalls.map((t) => ({ kind: 'tool' as const, at: t.at, t })),
      ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    : []

  return (
    <Sheet title="Conversation" description={q.data ? `${q.data.channel} · started ${timeAgo(q.data.createdAt)}` : undefined}>
      {q.isLoading ? <Spinner /> : null}
      <ErrorNote error={q.error} />
      {q.data?.needsHuman ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warn/25 bg-warn-soft px-3 py-2.5 text-[13px] text-warn">
          <span>The customer asked for your team. The bot is staying quiet.</span>
          <Button size="sm" variant="secondary" onClick={() => resolve.mutate()} disabled={resolve.isPending}>
            Mark as handled
          </Button>
        </div>
      ) : null}
      <div className="grid gap-3">
        {items.map((it, i) =>
          it.kind === 'msg' ? (
            <div
              key={i}
              className={cn(
                'max-w-[85%] whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-[13.5px]',
                it.m.role === 'user' ? 'justify-self-end bg-signal text-white' : 'justify-self-start bg-paper'
              )}
            >
              {it.m.content}
            </div>
          ) : (
            <details key={i} className="justify-self-start rounded-md border border-dashed border-line-strong px-3 py-2 text-[12.5px]">
              <summary className={cn('cursor-pointer font-mono', it.t.isError ? 'text-fault' : 'text-muted')}>
                {it.t.name === 'flow' ? 'flow steps' : it.t.name === 'knowledge_search' ? 'file parts sent to AI' : `${it.t.isError ? 'failed' : 'used'} ${it.t.name}`}
              </summary>
              <CodeBlock className="mt-2 whitespace-pre-wrap">{`input:  ${JSON.stringify(it.t.input)}\noutput: ${it.t.output}`}</CodeBlock>
            </details>
          )
        )}
      </div>
    </Sheet>
  )
}
