import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, KeyRound, Pencil, Plus, RotateCcw, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Dialog, Sheet, ConfirmDialog } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge, CodeBlock, CopyField, Empty, ErrorNote, Section, Spinner, StatusDot } from '@/components/ui/bits'
import {
  api,
  type Delivery,
  type DeliveryResult,
  type IncomingEvent,
  type IncomingHook,
  type McpServerItem,
  type Webhook,
} from '@/lib/api'
import { BACKEND_URL, cn, timeAgo } from '@/lib/utils'

/* Events — plain words for what each one means */
const EVENT_INFO: Record<string, string> = {
  'lead.created': 'A customer’s details were saved as a lead',
  'appointment.booked': 'A meeting was booked (date, time, booking id)',
  'appointment.cancelled': 'A meeting was cancelled',
  'conversation.started': 'A visitor sent their first message',
  'message.received': 'Every message a visitor sends',
  'message.sent': 'Every reply the bot sends',
  'tool.called': 'The bot used a tool successfully',
  'tool.failed': 'A tool returned an error',
}

export function WebhooksPage() {
  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Send chatbot events to other apps (CRM, Google Sheets via Zapier/Make/n8n, Slack), and let other apps send data in."
      />
      <Tabs defaultValue="outgoing">
        <TabsList>
          <TabsTrigger value="outgoing">Outgoing</TabsTrigger>
          <TabsTrigger value="deliveries">Delivery log</TabsTrigger>
          <TabsTrigger value="incoming">Incoming</TabsTrigger>
        </TabsList>
        <TabsContent value="outgoing">
          <OutgoingTab />
        </TabsContent>
        <TabsContent value="deliveries">
          <DeliveriesTab />
        </TabsContent>
        <TabsContent value="incoming">
          <IncomingTab />
        </TabsContent>
      </Tabs>
    </>
  )
}

/* ═══════════════════════════ Outgoing ═══════════════════════════ */

function OutgoingTab() {
  const qc = useQueryClient()
  const hooks = useQuery({ queryKey: ['webhooks'], queryFn: () => api.get<Webhook[]>('/api/admin/webhooks') })
  const [editing, setEditing] = useState<Webhook | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Webhook | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['webhooks'] })
    qc.invalidateQueries({ queryKey: ['deliveries'] })
    qc.invalidateQueries({ queryKey: ['stats'] })
  }

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/api/admin/webhooks/${id}/active`, { active }),
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  })
  const test = useMutation({
    mutationFn: (id: string) => api.post<DeliveryResult>(`/api/admin/webhooks/${id}/test`),
    onSuccess: (r) => {
      if (r.success) toast.success(`Test delivered — ${r.statusCode} in ${r.durationMs} ms`)
      else toast.error(r.error ? `Test failed: ${r.error}` : `Test failed: endpoint answered ${r.statusCode}`)
      refresh()
    },
    onError: (e) => toast.error(e.message),
  })
  const rotate = useMutation({
    mutationFn: (id: string) => api.post(`/api/admin/webhooks/${id}/rotate-secret`),
    onSuccess: () => {
      toast.success('New signing secret created. Update it in the receiving app.')
      refresh()
    },
  })
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/webhooks/${id}`),
    onSuccess: () => {
      toast.success('Webhook deleted')
      setDeleting(null)
      refresh()
    },
  })

  return (
    <>
      <Section
        title="Outgoing webhooks"
        description="We POST a signed JSON body to your URL when an event happens. Failed deliveries are retried twice."
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> Add webhook
          </Button>
        }
      >
        {hooks.isLoading ? (
          <div className="p-5 text-muted">
            <Spinner />
          </div>
        ) : hooks.isError ? (
          <div className="p-5">
            <ErrorNote error={hooks.error} />
          </div>
        ) : !hooks.data?.length ? (
          <Empty
            icon={<ArrowUpFromLine />}
            title="No outgoing webhooks"
            body="Add one to get every new lead in your CRM, a Google Sheet or a Slack channel the moment it's saved."
            action={
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus /> Add webhook
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {hooks.data.map((h) => {
              const failing = h.lastStatus !== undefined && (h.lastStatus < 200 || h.lastStatus >= 300)
              const open = openId === h._id
              return (
                <li key={h._id}>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                    <Switch checked={h.active} onCheckedChange={(active) => toggle.mutate({ id: h._id, active })} aria-label={`Send events to ${h.name}`} />
                    <button className="min-w-0 flex-1 text-left" onClick={() => setOpenId(open ? null : h._id)} aria-expanded={open}>
                      <span className="flex items-center gap-2">
                        <span className="font-medium">{h.name}</span>
                        <ChevronDown className={cn('size-3.5 text-faint transition-transform', open && 'rotate-180')} aria-hidden />
                      </span>
                      <span className="block truncate font-mono text-[12px] text-muted">{h.url}</span>
                    </button>
                    <div className="flex flex-wrap gap-1">
                      {h.events.map((e) => (
                        <Badge key={e} tone="signal" className="font-mono text-[11.5px]">
                          {e}
                        </Badge>
                      ))}
                    </div>
                    <div className="w-36 text-right text-[12.5px]">
                      {!h.active ? (
                        <StatusDot status="paused" />
                      ) : h.lastDeliveredAt ? (
                        <span className={failing ? 'text-fault' : 'text-muted'}>
                          {failing ? `Failed (${h.lastStatus || 'no response'})` : `${h.lastStatus} OK`} · {timeAgo(h.lastDeliveredAt)}
                        </span>
                      ) : (
                        <span className="text-muted">Nothing sent yet</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="secondary" size="sm" onClick={() => test.mutate(h._id)} disabled={test.isPending && test.variables === h._id}>
                        {test.isPending && test.variables === h._id ? <Spinner className="size-3.5" /> : <Send />} Send test
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setEditing(h)} aria-label={`Edit ${h.name}`}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleting(h)} aria-label={`Delete ${h.name}`}>
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                  {open ? (
                    <div className="grid gap-4 border-t border-line bg-paper/60 px-5 py-4 lg:grid-cols-2">
                      <div>
                        <p className="mb-1.5 text-[13px] font-medium text-ink-2">Signing secret</p>
                        <CopyField value={h.secret} mask />
                        <Button variant="ghost" size="sm" className="mt-2 -ml-2" onClick={() => rotate.mutate(h._id)}>
                          <KeyRound /> Create new secret
                        </Button>
                      </div>
                      <div>
                        <p className="mb-1.5 text-[13px] font-medium text-ink-2">Verify the signature in your receiver (Node)</p>
                        <CodeBlock>{`const crypto = require("crypto");
const ts  = req.headers["x-webhook-timestamp"];
const sig = req.headers["x-webhook-signature"];
const expected = "sha256=" + crypto
  .createHmac("sha256", process.env.WEBHOOK_SECRET)
  .update(ts + "." + rawBody).digest("hex");
const ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));`}</CodeBlock>
                      </div>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing !== null ? (
          <WebhookForm
            hook={editing === 'new' ? null : editing}
            onDone={() => {
              setEditing(null)
              refresh()
            }}
          />
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'webhook'}?`}
        body="Events stop going to this URL and its delivery history is removed."
        confirmLabel="Delete webhook"
        pending={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting._id)}
      />
    </>
  )
}

function WebhookForm({ hook, onDone }: { hook: Webhook | null; onDone: () => void }) {
  const [name, setName] = useState(hook?.name ?? '')
  const [url, setUrl] = useState(hook?.url ?? '')
  const [events, setEvents] = useState<string[]>(hook?.events ?? ['lead.created'])
  const [headers, setHeaders] = useState(
    Object.entries(hook?.headers ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
  )

  const save = useMutation({
    mutationFn: () => {
      const h: Record<string, string> = {}
      for (const line of headers.split('\n')) {
        const i = line.indexOf(':')
        if (i > 0) h[line.slice(0, i).trim()] = line.slice(i + 1).trim()
      }
      const body = { name, url, events, headers: h }
      return hook ? api.put(`/api/admin/webhooks/${hook._id}`, body) : api.post('/api/admin/webhooks', body)
    },
    onSuccess: () => {
      toast.success(hook ? 'Webhook saved' : 'Webhook added. Use “Send test” to check it.')
      onDone()
    },
  })

  return (
    <Sheet
      title={hook ? `Edit ${hook.name}` : 'Add outgoing webhook'}
      description="Paste the URL from Zapier, Make, n8n, your CRM or your own API."
      footer={
        <>
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name || !url || !events.length}>
            {save.isPending ? <Spinner className="size-3.5" /> : null}
            {hook ? 'Save webhook' : 'Add webhook'}
          </Button>
        </>
      }
    >
      <form className="grid gap-5" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
        <Field label="Name" htmlFor="wh-name">
          <Input id="wh-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Leads to Google Sheet" />
        </Field>
        <Field label="Endpoint URL" htmlFor="wh-url">
          <Input id="wh-url" value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono" placeholder="https://hooks.zapier.com/hooks/catch/…" />
        </Field>
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-ink-2">Send when</legend>
          <div className="grid gap-1.5">
            {Object.entries(EVENT_INFO).map(([ev, info]) => (
              <label key={ev} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 hover:bg-paper">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-[var(--color-signal)]"
                  checked={events.includes(ev)}
                  onChange={(e) => setEvents((p) => (e.target.checked ? [...p, ev] : p.filter((x) => x !== ev)))}
                />
                <span>
                  <span className="block font-mono text-[13px]">{ev}</span>
                  <span className="block text-[12.5px] text-muted">{info}</span>
                </span>
              </label>
            ))}
          </div>
          {!events.length ? <p className="mt-1 text-xs text-fault">Pick at least one event</p> : null}
        </fieldset>
        <Field label="Extra headers" htmlFor="wh-headers" hint="Optional. Name: value, one per line">
          <Textarea id="wh-headers" value={headers} onChange={(e) => setHeaders(e.target.value)} className="min-h-16 font-mono text-[13px]" placeholder="Authorization: Bearer …" />
        </Field>
        <ErrorNote error={save.error} />
      </form>
    </Sheet>
  )
}

/* ═══════════════════════════ Delivery log ═══════════════════════════ */

function DeliveriesTab() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'failed'>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const list = useQuery({
    queryKey: ['deliveries', filter],
    queryFn: () => api.get<Delivery[]>(`/api/admin/webhooks/deliveries${filter === 'failed' ? '?status=failed' : ''}`),
    refetchInterval: 8_000,
  })
  const redeliver = useMutation({
    mutationFn: (id: string) => api.post<DeliveryResult>(`/api/admin/webhooks/deliveries/${id}/redeliver`),
    onSuccess: (r) => {
      if (r.success) toast.success(`Redelivered — ${r.statusCode}`)
      else toast.error(`Still failing: ${r.error ?? r.statusCode}`)
      qc.invalidateQueries({ queryKey: ['deliveries'] })
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <Section
      title="Delivery log"
      description="The last 100 attempts. Open one to see exactly what was sent and what came back."
      actions={
        <div className="flex rounded-md border border-line-strong p-0.5 text-[13px]">
          {(['all', 'failed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn('rounded px-2.5 py-1 font-medium', filter === f ? 'bg-ink text-white' : 'text-muted hover:text-ink')}
            >
              {f === 'all' ? 'All' : 'Failed only'}
            </button>
          ))}
        </div>
      }
    >
      {list.isLoading ? (
        <div className="p-5">
          <Spinner />
        </div>
      ) : !list.data?.length ? (
        <Empty title={filter === 'failed' ? 'No failed deliveries' : 'Nothing delivered yet'} body="Use “Send test” on a webhook to see your first delivery here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-[13px]">
            <thead className="text-left text-[12.5px] text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-2 font-medium">Result</th>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Webhook</th>
                <th className="px-3 py-2 font-medium">Try</th>
                <th className="px-3 py-2 font-medium">Time taken</th>
                <th className="px-5 py-2 text-right font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.data.map((d) => (
                <DeliveryRow
                  key={d._id}
                  d={d}
                  open={openId === d._id}
                  onToggle={() => setOpenId(openId === d._id ? null : d._id)}
                  onRedeliver={() => redeliver.mutate(d._id)}
                  redelivering={redeliver.isPending && redeliver.variables === d._id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

function DeliveryRow({
  d,
  open,
  onToggle,
  onRedeliver,
  redelivering,
}: {
  d: Delivery
  open: boolean
  onToggle: () => void
  onRedeliver: () => void
  redelivering: boolean
}) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-paper/70" onClick={onToggle}>
        <td className="px-5 py-2.5">
          <Badge tone={d.success ? 'live' : 'fault'} className="font-mono">
            {d.statusCode ?? 'ERR'}
          </Badge>
        </td>
        <td className="px-3 py-2.5 font-mono text-[12.5px]">{d.event}</td>
        <td className="px-3 py-2.5">{d.webhookName}</td>
        <td className="px-3 py-2.5 text-muted">{d.attempt}</td>
        <td className="px-3 py-2.5 text-muted">{d.durationMs} ms</td>
        <td className="px-5 py-2.5 text-right text-muted">{timeAgo(d.createdAt)}</td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={6} className="bg-paper/60 px-5 py-4">
            {d.error ? <p className="mb-3 text-fault">{d.error}</p> : null}
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-1.5 font-medium text-ink-2">Sent to {d.url}</p>
                <CodeBlock className="max-h-64">{JSON.stringify(d.payload, null, 2)}</CodeBlock>
              </div>
              <div>
                <p className="mb-1.5 font-medium text-ink-2">Response</p>
                <CodeBlock className="max-h-64 whitespace-pre-wrap">{d.responseBody || '(empty body)'}</CodeBlock>
              </div>
            </div>
            <Button variant="secondary" size="sm" className="mt-3" onClick={onRedeliver} disabled={redelivering}>
              {redelivering ? <Spinner className="size-3.5" /> : <RotateCcw />} Send again
            </Button>
          </td>
        </tr>
      ) : null}
    </>
  )
}

/* ═══════════════════════════ Incoming ═══════════════════════════ */

const ACTIONS = {
  log: { label: 'Just record it', sub: 'Store the payload so you can inspect it here' },
  chat: { label: 'Ask the bot', sub: 'Send {"message": "…"} and get the bot’s reply back' },
  tool: { label: 'Run a tool', sub: 'Use the payload as arguments for an MCP tool' },
} as const

function IncomingTab() {
  const qc = useQueryClient()
  const hooks = useQuery({ queryKey: ['incoming'], queryFn: () => api.get<IncomingHook[]>('/api/admin/incoming') })
  const events = useQuery({ queryKey: ['incoming-events'], queryFn: () => api.get<IncomingEvent[]>('/api/admin/incoming/events'), refetchInterval: 8_000 })
  const [editing, setEditing] = useState<IncomingHook | 'new' | null>(null)
  const [deleting, setDeleting] = useState<IncomingHook | null>(null)
  const [openEvent, setOpenEvent] = useState<string | null>(null)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['incoming'] })
    qc.invalidateQueries({ queryKey: ['incoming-events'] })
  }
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/api/admin/incoming/${id}/active`, { active }),
    onSuccess: refresh,
  })
  const regen = useMutation({
    mutationFn: (id: string) => api.post(`/api/admin/incoming/${id}/regenerate`),
    onSuccess: () => {
      toast.success('New URL created. The old one stops working now.')
      refresh()
    },
  })
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/incoming/${id}`),
    onSuccess: () => {
      toast.success('Endpoint deleted')
      setDeleting(null)
      refresh()
    },
  })

  return (
    <div className="grid gap-6">
      <Section
        title="Incoming endpoints"
        description="Give one of these URLs to another app. Anyone with the URL can post to it, so treat it like a password."
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> Add endpoint
          </Button>
        }
      >
        {hooks.isLoading ? (
          <div className="p-5">
            <Spinner />
          </div>
        ) : !hooks.data?.length ? (
          <Empty
            icon={<ArrowDownToLine />}
            title="No incoming endpoints"
            body="Create one to save leads from a website form, or to let Zapier or WhatsApp tools talk to your bot."
            action={
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus /> Add endpoint
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {hooks.data.map((h) => {
              const url = `${BACKEND_URL}/hooks/in/${h.token}`
              return (
                <li key={h._id} className="grid gap-3 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Switch checked={h.active} onCheckedChange={(active) => toggle.mutate({ id: h._id, active })} aria-label={`Accept requests on ${h.name}`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{h.name}</p>
                      <p className="text-[12.5px] text-muted">
                        {ACTIONS[h.action].label}
                        {h.action === 'tool' ? (
                          <>
                            {' '}
                            <code className="font-mono">{h.toolName}</code>
                          </>
                        ) : null}
                        {' · '}
                        {h.receivedCount} received{h.lastReceivedAt ? `, last ${timeAgo(h.lastReceivedAt)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => regen.mutate(h._id)}>
                        <KeyRound /> New URL
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setEditing(h)} aria-label={`Edit ${h.name}`}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleting(h)} aria-label={`Delete ${h.name}`}>
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                  <CopyField value={url} />
                  <details className="text-[13px]">
                    <summary className="cursor-pointer font-medium text-signal">Example request</summary>
                    <CodeBlock className="mt-2">{`curl -X POST ${url} \\
  -H "Content-Type: application/json" \\
  -d '${h.action === 'chat' ? '{"message":"Aap kya services dete ho?","sessionId":"crm-123"}' : h.action === 'tool' ? '{"name":"Rahul","phone":"9876543210","service":"website"}' : '{"source":"contact-form","name":"Rahul"}'}'`}</CodeBlock>
                  </details>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title="Received requests" description="Latest 100 requests across all incoming endpoints.">
        {!events.data?.length ? (
          <Empty title="Nothing received yet" body="Run the example request above and it shows up here within a few seconds." />
        ) : (
          <ul className="divide-y divide-line">
            {events.data.map((e) => (
              <li key={e._id}>
                <button className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-left text-[13px] hover:bg-paper/70" onClick={() => setOpenEvent(openEvent === e._id ? null : e._id)}>
                  <Badge tone={e.success ? 'live' : 'fault'}>{e.success ? 'OK' : 'Failed'}</Badge>
                  <span className="font-medium">{e.hookName}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">{JSON.stringify(e.payload)}</span>
                  <span className="text-muted">{timeAgo(e.createdAt)}</span>
                </button>
                {openEvent === e._id ? (
                  <div className="grid gap-4 bg-paper/60 px-5 py-4 lg:grid-cols-2">
                    <div>
                      <p className="mb-1.5 text-[13px] font-medium text-ink-2">Payload</p>
                      <CodeBlock className="max-h-64">{JSON.stringify(e.payload, null, 2)}</CodeBlock>
                    </div>
                    <div>
                      <p className="mb-1.5 text-[13px] font-medium text-ink-2">What we answered</p>
                      <CodeBlock className="max-h-64 whitespace-pre-wrap">{prettyJson(e.result)}</CodeBlock>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing !== null ? (
          <IncomingForm
            hook={editing === 'new' ? null : editing}
            onDone={() => {
              setEditing(null)
              refresh()
            }}
          />
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'endpoint'}?`}
        body="Apps posting to this URL will get a 404 from now on."
        confirmLabel="Delete endpoint"
        pending={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting._id)}
      />
    </div>
  )
}

function prettyJson(s: string) {
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

function IncomingForm({ hook, onDone }: { hook: IncomingHook | null; onDone: () => void }) {
  const [name, setName] = useState(hook?.name ?? '')
  const [action, setAction] = useState<IncomingHook['action']>(hook?.action ?? 'log')
  const [toolName, setToolName] = useState(hook?.toolName ?? '')
  const servers = useQuery({ queryKey: ['mcp-servers'], queryFn: () => api.get<McpServerItem[]>('/api/admin/mcp/servers') })
  const tools = (servers.data ?? []).flatMap((s) => s.tools.map((t) => ({ ...t, server: s.name })))

  const save = useMutation({
    mutationFn: () => {
      const body = { name, action, toolName: action === 'tool' ? toolName : undefined }
      return hook ? api.put(`/api/admin/incoming/${hook._id}`, body) : api.post('/api/admin/incoming', body)
    },
    onSuccess: () => {
      toast.success(hook ? 'Endpoint saved' : 'Endpoint created. Copy its URL into the other app.')
      onDone()
    },
  })

  return (
    <Sheet
      title={hook ? `Edit ${hook.name}` : 'Add incoming endpoint'}
      footer={
        <>
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name || (action === 'tool' && !toolName)}>
            {save.isPending ? <Spinner className="size-3.5" /> : null}
            {hook ? 'Save endpoint' : 'Create endpoint'}
          </Button>
        </>
      }
    >
      <form className="grid gap-5" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
        <Field label="Name" htmlFor="in-name">
          <Input id="in-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Contact form on website" />
        </Field>
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-ink-2">When a request arrives</legend>
          <div className="grid gap-2">
            {(Object.keys(ACTIONS) as (keyof typeof ACTIONS)[]).map((a) => (
              <label
                key={a}
                className={cn('cursor-pointer rounded-md border px-3 py-2.5', action === a ? 'border-signal bg-signal-soft' : 'border-line-strong hover:bg-paper')}
              >
                <input type="radio" name="action" className="sr-only" checked={action === a} onChange={() => setAction(a)} />
                <span className="block text-sm font-medium">{ACTIONS[a].label}</span>
                <span className="block text-[12.5px] text-muted">{ACTIONS[a].sub}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {action === 'tool' ? (
          <Field label="Tool" htmlFor="in-tool" hint={!tools.length ? 'Connect an MCP server first — its tools appear here.' : undefined}>
            <Select id="in-tool" value={toolName} onChange={(e) => setToolName(e.target.value)}>
              <option value="">Choose a tool…</option>
              {tools.map((t) => (
                <option key={t.fullName} value={t.fullName}>
                  {t.fullName} ({t.server})
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <ErrorNote error={save.error} />
      </form>
    </Sheet>
  )
}
