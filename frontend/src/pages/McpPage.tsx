import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Cable, Pencil, Play, Plus, RefreshCw, Trash2, FileText, MessageSquareQuote } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Dialog, Sheet, ConfirmDialog } from '@/components/ui/dialog'
import { Badge, CodeBlock, Empty, ErrorNote, Spinner, StatusDot } from '@/components/ui/bits'
import { api, type JsonSchemaProp, type McpServerItem, type McpTool, type ToolRunResult } from '@/lib/api'
import { cn, timeAgo } from '@/lib/utils'

export function McpPage() {
  const qc = useQueryClient()
  const servers = useQuery({
    queryKey: ['mcp-servers'],
    queryFn: () => api.get<McpServerItem[]>('/api/admin/mcp/servers'),
    refetchInterval: 10_000,
  })
  const [editing, setEditing] = useState<McpServerItem | 'new' | null>(null)
  const [testing, setTesting] = useState<McpTool | null>(null)
  const [deleting, setDeleting] = useState<McpServerItem | null>(null)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['mcp-servers'] })
    qc.invalidateQueries({ queryKey: ['stats'] })
  }

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/mcp/servers/${id}`),
    onSuccess: () => {
      toast.success('Server removed')
      setDeleting(null)
      refresh()
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <>
      <PageHeader
        title="MCP servers"
        description="Each server gives the bot a set of tools. Turn a whole server or a single tool off and the bot stops using it on the next message."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> Add server
          </Button>
        }
      />

      {servers.isLoading ? (
        <div className="flex items-center gap-2 text-muted">
          <Spinner /> Loading servers…
        </div>
      ) : servers.isError ? (
        <ErrorNote error={servers.error} />
      ) : !servers.data?.length ? (
        <div className="rounded-lg border border-dashed border-line-strong bg-panel">
          <Empty
            icon={<Cable />}
            title="No MCP servers yet"
            body="Add a local server that runs as a command, or connect a remote one by URL."
            action={
              <Button onClick={() => setEditing('new')}>
                <Plus /> Add server
              </Button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-5">
          {servers.data.map((s) => (
            <ServerBlock
              key={s._id}
              server={s}
              onEdit={() => setEditing(s)}
              onDelete={() => setDeleting(s)}
              onTest={setTesting}
              onChanged={refresh}
            />
          ))}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing !== null ? (
          <ServerForm
            server={editing === 'new' ? null : editing}
            onDone={() => {
              setEditing(null)
              refresh()
            }}
          />
        ) : null}
      </Dialog>

      <Dialog open={testing !== null} onOpenChange={(o) => !o && setTesting(null)}>
        {testing ? <ToolRunner tool={testing} /> : null}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Remove ${deleting?.name ?? 'server'}?`}
        body="The bot loses all tools from this server. You can add it again later."
        confirmLabel="Remove server"
        pending={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting._id)}
      />
    </>
  )
}

/* ─────────────────────────── One server ─────────────────────────── */

function ServerBlock({
  server: s,
  onEdit,
  onDelete,
  onTest,
  onChanged,
}: {
  server: McpServerItem
  onEdit: () => void
  onDelete: () => void
  onTest: (t: McpTool) => void
  onChanged: () => void
}) {
  const qc = useQueryClient()

  const toggleServer = useMutation({
    mutationFn: (enabled: boolean) => api.patch(`/api/admin/mcp/servers/${s._id}/enabled`, { enabled }),
    onSuccess: (_d, enabled) => {
      toast.success(enabled ? `${s.name} turned on` : `${s.name} turned off`)
      onChanged()
    },
    onError: (e) => toast.error(e.message),
  })

  const reconnect = useMutation({
    mutationFn: () => api.post<{ status: string; error?: string }>(`/api/admin/mcp/servers/${s._id}/reconnect`),
    onSuccess: (r) => {
      if (r.status === 'connected') toast.success(`${s.name} reconnected`)
      else toast.error(r.error ?? 'Could not connect')
      onChanged()
    },
    onError: (e) => toast.error(e.message),
  })

  const toggleTool = useMutation({
    mutationFn: ({ tool, enabled }: { tool: string; enabled: boolean }) =>
      api.patch(`/api/admin/mcp/servers/${s._id}/tools/${encodeURIComponent(tool)}`, { enabled }),
    onMutate: async ({ tool, enabled }) => {
      // Optimistic update — switch turant palat jaye
      await qc.cancelQueries({ queryKey: ['mcp-servers'] })
      qc.setQueryData<McpServerItem[]>(['mcp-servers'], (old) =>
        old?.map((x) => (x._id === s._id ? { ...x, tools: x.tools.map((t) => (t.name === tool ? { ...t, enabled } : t)) } : x))
      )
    },
    onError: (e) => {
      toast.error(e.message)
      onChanged()
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['stats'] }),
  })

  const status = s.enabled ? s.status : 'disabled'
  const enabledCount = s.tools.filter((t) => t.enabled).length

  return (
    <section className={cn('overflow-hidden rounded-lg border bg-panel', status === 'error' ? 'border-fault/35' : 'border-line')}>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-[15px] font-semibold">{s.name}</h2>
            <StatusDot status={status} />
          </div>
          <p className="mt-1 truncate font-mono text-[12px] text-muted">
            {s.transport === 'stdio' ? `${s.command} ${(s.args ?? []).join(' ')}` : s.url}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => reconnect.mutate()} disabled={!s.enabled || reconnect.isPending}>
            {reconnect.isPending ? <Spinner className="size-3.5" /> : <RefreshCw />} Reconnect
          </Button>
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`Edit ${s.name}`}>
            <Pencil />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} aria-label={`Remove ${s.name}`}>
            <Trash2 />
          </Button>
          <label className="ml-2 flex items-center gap-2 border-l border-line pl-3 text-[13px] text-muted">
            <Switch checked={s.enabled} onCheckedChange={(v) => toggleServer.mutate(v)} disabled={toggleServer.isPending} />
            {s.enabled ? 'On' : 'Off'}
          </label>
        </div>
      </header>

      <div className="flex flex-wrap gap-x-6 gap-y-1 border-y border-line bg-paper/60 px-5 py-2 text-[12.5px] text-muted">
        <span>
          Identifier <code className="font-mono text-ink-2">{s.slug}</code>
        </span>
        <span>{s.transport === 'stdio' ? 'Runs locally (stdio)' : 'Remote (Streamable HTTP)'}</span>
        {s.serverInfo ? (
          <span>
            Reports as <span className="text-ink-2">{s.serverInfo.name} {s.serverInfo.version}</span>
          </span>
        ) : null}
        {s.connectedAt && status === 'connected' ? <span>Connected {timeAgo(s.connectedAt)}</span> : null}
      </div>

      {status === 'error' && s.error ? (
        <div className="border-b border-line px-5 py-3 text-[13px] text-fault">
          {s.error}. Check the {s.transport === 'stdio' ? 'command and arguments' : 'URL and headers'}, then reconnect.
        </div>
      ) : null}

      {s.tools.length ? (
        <>
          <div className="flex items-baseline justify-between px-5 pt-4 pb-2">
            <h3 className="text-[13px] font-semibold text-ink-2">Tools</h3>
            <span className="text-[12.5px] text-muted">
              {enabledCount} of {s.tools.length} available to the bot
            </span>
          </div>
          <ul className="divide-y divide-line">
            {s.tools.map((t) => (
              <li key={t.name} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <Switch
                  checked={t.enabled}
                  onCheckedChange={(enabled) => toggleTool.mutate({ tool: t.name, enabled })}
                  aria-label={`Let the bot use ${t.name}`}
                  disabled={status !== 'connected'}
                />
                <div className="min-w-0 flex-1">
                  <p className={cn('font-mono text-[13px] font-medium', !t.enabled && 'text-muted line-through decoration-faint')}>{t.name}</p>
                  {t.description ? <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{t.description}</p> : null}
                </div>
                <Button variant="secondary" size="sm" onClick={() => onTest(t)} disabled={status !== 'connected'}>
                  <Play /> Test
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : status === 'connected' ? (
        <p className="px-5 py-4 text-[13px] text-muted">This server is connected but offers no tools.</p>
      ) : null}

      {s.resources.length || s.prompts.length ? (
        <div className="flex flex-wrap gap-x-8 gap-y-3 border-t border-line px-5 py-3.5 text-[13px]">
          {s.resources.length ? (
            <div className="flex items-start gap-2">
              <FileText className="mt-0.5 size-4 text-faint" aria-hidden />
              <div>
                <p className="font-medium text-ink-2">Resources</p>
                {s.resources.map((r) => (
                  <p key={r.uri} className="text-muted">
                    <code className="font-mono text-[12px]">{r.uri}</code> {r.description ? `— ${r.description}` : ''}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
          {s.prompts.length ? (
            <div className="flex items-start gap-2">
              <MessageSquareQuote className="mt-0.5 size-4 text-faint" aria-hidden />
              <div>
                <p className="font-medium text-ink-2">Prompts</p>
                {s.prompts.map((p) => (
                  <p key={p.name} className="text-muted">
                    <code className="font-mono text-[12px]">{p.name}</code> {p.description ? `— ${p.description}` : ''}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/* ─────────────────────────── Add / edit server ─────────────────────────── */

const PRESETS = [
  {
    label: 'Built-in lead server',
    data: { name: 'Lead server', slug: 'leads-2', transport: 'stdio', command: 'npx', args: 'tsx\n./src/mcp-servers/leads/index.ts' },
  },
  {
    label: 'Appointment server',
    data: { name: 'Appointment server', slug: 'appointments-2', transport: 'stdio', command: 'npx', args: 'tsx\n./src/mcp-servers/appointments/index.ts' },
  },
  {
    // slug "knowledge" hi rakhna — bot isi naam se files wala tool pehchanta hai
    label: 'Knowledge server',
    data: { name: 'Knowledge server', slug: 'knowledge', transport: 'stdio', command: 'npx', args: 'tsx\n./src/mcp-servers/knowledge/index.ts' },
  },
  {
    label: 'Filesystem (official)',
    data: {
      name: 'Files',
      slug: 'files',
      transport: 'stdio',
      command: 'npx',
      args: '-y\n@modelcontextprotocol/server-filesystem\nD:/chatbot-ai/docs',
    },
  },
  { label: 'Remote URL', data: { name: 'Remote server', slug: 'remote', transport: 'http', url: 'https://example.com/mcp' } },
] as const

const toLines = (o?: Record<string, string>, sep = '=') => Object.entries(o ?? {}).map(([k, v]) => `${k}${sep}${v}`).join('\n')
function fromLines(text: string, sep: string) {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const i = line.indexOf(sep)
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + sep.length).trim()
  }
  return out
}

function ServerForm({ server, onDone }: { server: McpServerItem | null; onDone: () => void }) {
  const [f, setF] = useState({
    name: server?.name ?? '',
    slug: server?.slug ?? '',
    transport: server?.transport ?? 'stdio',
    command: server?.command ?? 'npx',
    args: (server?.args ?? []).join('\n'),
    env: toLines(server?.env),
    url: server?.url ?? '',
    headers: toLines(server?.headers, ': '),
  })
  const [slugTouched, setSlugTouched] = useState(Boolean(server))
  const set = (k: keyof typeof f, v: string) =>
    setF((p) => {
      const next = { ...p, [k]: v }
      if (k === 'name' && !slugTouched) next.slug = v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)
      return next
    })

  const save = useMutation({
    mutationFn: () => {
      const body =
        f.transport === 'stdio'
          ? { name: f.name, slug: f.slug, transport: 'stdio', command: f.command, args: f.args.split('\n').map((a) => a.trim()).filter(Boolean), env: fromLines(f.env, '=') }
          : { name: f.name, slug: f.slug, transport: 'http', url: f.url, headers: fromLines(f.headers, ':') }
      return server ? api.put(`/api/admin/mcp/servers/${server._id}`, body) : api.post('/api/admin/mcp/servers', body)
    },
    onSuccess: () => {
      toast.success(server ? 'Server updated and reconnected' : 'Server added')
      onDone()
    },
  })

  return (
    <Sheet
      title={server ? `Edit ${server.name}` : 'Add MCP server'}
      description="The bot reconnects to the server as soon as you save."
      footer={
        <>
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !f.name || !f.slug}>
            {save.isPending ? <Spinner className="size-3.5" /> : null}
            {server ? 'Save and reconnect' : 'Add and connect'}
          </Button>
        </>
      }
    >
      <form className="grid gap-5" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
        {!server ? (
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-2">Start from</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setF((prev) => ({ ...prev, command: '', args: '', url: '', ...p.data }))
                    setSlugTouched(true)
                  }}
                  className="rounded-md border border-line-strong px-2.5 py-1.5 text-[13px] hover:border-signal hover:text-signal"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="srv-name">
            <Input id="srv-name" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Google Sheets" />
          </Field>
          <Field label="Identifier" htmlFor="srv-slug" hint="Prefix for tool names, e.g. leads__save_lead">
            <Input
              id="srv-slug"
              value={f.slug}
              onChange={(e) => {
                setSlugTouched(true)
                set('slug', e.target.value.toLowerCase())
              }}
              className="font-mono"
            />
          </Field>
        </div>

        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-ink-2">How does it run?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ['stdio', 'On this computer', 'Backend starts it as a command'],
                ['http', 'At a URL', 'Remote server over Streamable HTTP'],
              ] as const
            ).map(([val, label, sub]) => (
              <label
                key={val}
                className={cn(
                  'cursor-pointer rounded-md border px-3 py-2.5',
                  f.transport === val ? 'border-signal bg-signal-soft' : 'border-line-strong hover:bg-paper'
                )}
              >
                <input type="radio" name="transport" value={val} checked={f.transport === val} onChange={() => set('transport', val)} className="sr-only" />
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-[12.5px] text-muted">{sub}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {f.transport === 'stdio' ? (
          <>
            <Field label="Command" htmlFor="srv-cmd" hint="Usually npx, node, uv or python">
              <Input id="srv-cmd" value={f.command} onChange={(e) => set('command', e.target.value)} className="font-mono" />
            </Field>
            <Field label="Arguments" htmlFor="srv-args" hint="One per line. Relative paths start from the backend folder.">
              <Textarea id="srv-args" value={f.args} onChange={(e) => set('args', e.target.value)} className="min-h-20 font-mono text-[13px]" />
            </Field>
            <Field label="Environment variables" htmlFor="srv-env" hint="KEY=value, one per line. The backend's own .env is passed through too.">
              <Textarea id="srv-env" value={f.env} onChange={(e) => set('env', e.target.value)} className="min-h-16 font-mono text-[13px]" placeholder="SHEET_ID=abc123" />
            </Field>
          </>
        ) : (
          <>
            <Field label="Server URL" htmlFor="srv-url">
              <Input id="srv-url" value={f.url} onChange={(e) => set('url', e.target.value)} className="font-mono" placeholder="https://api.example.com/mcp" />
            </Field>
            <Field label="Headers" htmlFor="srv-headers" hint="Name: value, one per line — for API keys or bearer tokens">
              <Textarea
                id="srv-headers"
                value={f.headers}
                onChange={(e) => set('headers', e.target.value)}
                className="min-h-16 font-mono text-[13px]"
                placeholder="Authorization: Bearer sk_..."
              />
            </Field>
          </>
        )}

        <ErrorNote error={save.error} />
      </form>
    </Sheet>
  )
}

/* ─────────────────────────── Test a tool ─────────────────────────── */

function defaultFor(p: JsonSchemaProp) {
  if (p.default !== undefined) return p.default
  if (p.enum?.length) return p.enum[0]
  const t = Array.isArray(p.type) ? p.type[0] : p.type
  return t === 'number' || t === 'integer' ? 0 : t === 'boolean' ? false : ''
}

function ToolRunner({ tool }: { tool: McpTool }) {
  const props = useMemo(() => tool.inputSchema?.properties ?? {}, [tool])
  const required = new Set(tool.inputSchema?.required ?? [])
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(Object.entries(props).filter(([k]) => required.has(k)).map(([k, p]) => [k, defaultFor(p)]))
  )
  const [rawMode, setRawMode] = useState(false)
  const [raw, setRaw] = useState(() => JSON.stringify(values, null, 2))
  const [rawError, setRawError] = useState('')

  const run = useMutation({
    mutationFn: (args: Record<string, unknown>) =>
      api.post<ToolRunResult>(`/api/admin/mcp/tools/${encodeURIComponent(tool.fullName)}/run`, { args }),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (rawMode) {
      try {
        const parsed = JSON.parse(raw || '{}')
        if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
        setRawError('')
        run.mutate(parsed)
      } catch {
        setRawError('Enter a JSON object, like {"phone": "9876543210"}')
      }
      return
    }
    // Khaali optional fields mat bhejo
    const args = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== '' || required.has(k)))
    run.mutate(args)
  }

  const setVal = (k: string, v: unknown) => setValues((p) => ({ ...p, [k]: v }))

  return (
    <Sheet title={`Test ${tool.name}`} description={tool.description}>
      <form onSubmit={submit} className="grid gap-4">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-ink-2">Arguments</p>
          <button
            type="button"
            className="text-[13px] font-medium text-signal hover:underline"
            onClick={() => {
              if (!rawMode) setRaw(JSON.stringify(values, null, 2))
              setRawMode((m) => !m)
            }}
          >
            {rawMode ? 'Use form' : 'Edit as JSON'}
          </button>
        </div>

        {rawMode ? (
          <Field label="JSON arguments" htmlFor="raw-args" error={rawError}>
            <Textarea id="raw-args" value={raw} onChange={(e) => setRaw(e.target.value)} className="min-h-40 font-mono text-[13px]" aria-invalid={Boolean(rawError)} />
          </Field>
        ) : Object.keys(props).length === 0 ? (
          <p className="text-[13px] text-muted">This tool takes no arguments.</p>
        ) : (
          Object.entries(props).map(([key, p]) => {
            const type = Array.isArray(p.type) ? p.type[0] : p.type
            const label = `${key}${required.has(key) ? '' : ' (optional)'}`
            const id = `arg-${key}`
            if (p.enum?.length)
              return (
                <Field key={key} label={label} htmlFor={id} hint={p.description}>
                  <Select id={id} value={String(values[key] ?? '')} onChange={(e) => setVal(key, e.target.value)}>
                    {!required.has(key) ? <option value="">—</option> : null}
                    {p.enum.map((o) => (
                      <option key={String(o)} value={String(o)}>
                        {String(o)}
                      </option>
                    ))}
                  </Select>
                </Field>
              )
            if (type === 'boolean')
              return (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Switch checked={Boolean(values[key])} onCheckedChange={(v) => setVal(key, v)} /> {label}
                </label>
              )
            return (
              <Field key={key} label={label} htmlFor={id} hint={p.description}>
                <Input
                  id={id}
                  type={type === 'number' || type === 'integer' ? 'number' : 'text'}
                  value={String(values[key] ?? '')}
                  onChange={(e) => setVal(key, type === 'number' || type === 'integer' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
                />
              </Field>
            )
          })
        )}

        <div>
          <Button type="submit" disabled={run.isPending}>
            {run.isPending ? <Spinner className="size-3.5" /> : <Play />} Run tool
          </Button>
        </div>
      </form>

      {run.data ? (
        <div className="mt-6">
          <div className="mb-2 flex items-center gap-2">
            <p className="text-[13px] font-medium text-ink-2">Result</p>
            <Badge tone={run.data.isError ? 'fault' : 'live'}>{run.data.isError ? 'Error' : 'OK'}</Badge>
            {run.data.durationMs !== undefined ? <span className="text-[12.5px] text-muted">{run.data.durationMs} ms</span> : null}
          </div>
          <CodeBlock className="whitespace-pre-wrap">{run.data.text || '(empty)'}</CodeBlock>
        </div>
      ) : null}
      {run.error ? (
        <div className="mt-4">
          <ErrorNote error={run.error} />
        </div>
      ) : null}
    </Sheet>
  )
}
