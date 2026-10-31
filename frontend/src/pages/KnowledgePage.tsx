import { useRef, useState, type DragEvent, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, FileText, Search, Trash2, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog, Dialog, Sheet } from '@/components/ui/dialog'
import { Badge, Empty, ErrorNote, Section, Spinner } from '@/components/ui/bits'
import { api, uploadFiles, type KnowledgeDoc, type KnowledgeMode, type KnowledgeOverview, type KnowledgeSearch, type UploadResult } from '@/lib/api'
import { cn, timeAgo } from '@/lib/utils'

const ACCEPT = '.md,.markdown,.txt,.pdf,.docx'
const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

export function KnowledgePage() {
  const qc = useQueryClient()
  const data = useQuery({ queryKey: ['knowledge'], queryFn: () => api.get<KnowledgeOverview>('/api/admin/knowledge') })
  const [viewing, setViewing] = useState<KnowledgeDoc | null>(null)
  const [deleting, setDeleting] = useState<KnowledgeDoc | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['knowledge'] })

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.patch(`/api/admin/knowledge/docs/${id}`, { enabled }),
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  })
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/knowledge/docs/${id}`),
    onSuccess: () => {
      toast.success('File removed. The bot no longer uses it.')
      setDeleting(null)
      refresh()
    },
  })

  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="Upload your company documents. The AI only ever sees the few parts that match a question — never the whole file. The data is stored in your database and served by the Knowledge MCP server."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="grid content-start gap-6">
          <UploadZone onDone={refresh} />

          <Section
            title="Files"
            description={data.data ? `${data.data.totals.docs} files · split into ${data.data.totals.chunks} searchable parts` : undefined}
          >
            {data.isLoading ? (
              <div className="p-5">
                <Spinner />
              </div>
            ) : data.isError ? (
              <div className="p-5">
                <ErrorNote error={data.error} />
              </div>
            ) : !data.data?.docs.length ? (
              <Empty icon={<BookOpen />} title="No files yet" body="Upload a price list, FAQ or company profile and the bot will start answering from it." />
            ) : (
              <ul className="divide-y divide-line">
                {data.data.docs.map((d) => (
                  <li key={d._id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                    <Switch checked={d.enabled} onCheckedChange={(enabled) => toggle.mutate({ id: d._id, enabled })} aria-label={`Use ${d.name}`} />
                    <FileText className="size-4 text-faint" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className={cn('truncate font-medium', !d.enabled && 'text-muted')}>{d.name}</p>
                      <p className="text-[12.5px] text-muted">
                        {kb(d.size)} · {d.chunkCount} parts · added {timeAgo(d.createdAt)}
                      </p>
                    </div>
                    <Badge className="uppercase">{d.type}</Badge>
                    <Button variant="secondary" size="sm" onClick={() => setViewing(d)}>
                      View parts
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleting(d)} aria-label={`Delete ${d.name}`}>
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="grid content-start gap-6">
          {data.data ? <AiAccess key={data.data.settings.mode} data={data.data} onSaved={refresh} /> : null}
          <TryQuestion />
          {data.data ? <Limits settings={data.data.settings} onSaved={refresh} /> : null}
        </div>
      </div>

      <Dialog open={viewing !== null} onOpenChange={(o) => !o && setViewing(null)}>
        {viewing ? <Chunks doc={viewing} /> : null}
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'file'}?`}
        body="The bot stops using this file right away. Upload it again any time."
        confirmLabel="Delete file"
        pending={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting._id)}
      />
    </>
  )
}

/* ───────── Drag & drop upload ───────── */
function UploadZone({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [results, setResults] = useState<UploadResult['results'] | null>(null)

  const upload = useMutation({
    mutationFn: (files: File[]) => uploadFiles<UploadResult>('/api/admin/knowledge/upload', files),
    onSuccess: (r) => {
      setResults(r.results)
      const ok = r.results.filter((x) => x.ok).length
      if (ok) toast.success(`${ok} ${ok === 1 ? 'file' : 'files'} added to the knowledge base`)
      onDone()
    },
    onError: (e) => toast.error(e.message),
  })

  const pick = (list: FileList | null) => {
    const files = Array.from(list ?? [])
    if (!files.length) return
    if (files.length > 10) return toast.error('Upload up to 10 files at a time')
    const big = files.find((f) => f.size > 10 * 1024 * 1024)
    if (big) return toast.error(`${big.name} is over 10 MB`)
    setResults(null)
    upload.mutate(files)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    pick(e.dataTransfer.files)
  }

  return (
    <section>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
          over ? 'border-signal bg-signal-soft' : 'border-line-strong bg-panel'
        )}
      >
        {upload.isPending ? <Spinner className="size-6 text-signal" /> : <UploadCloud className="size-8 text-faint" aria-hidden />}
        <p className="mt-3 font-semibold">{upload.isPending ? 'Reading your files…' : 'Drop files here'}</p>
        <p className="mt-1 text-[13px] text-muted">Markdown, text, PDF or Word · up to 10 MB each · 10 at a time</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => input.current?.click()} disabled={upload.isPending}>
          Choose files
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            pick(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
      {results?.length ? (
        <ul className="mt-3 grid gap-1 text-[13px]">
          {results.map((r) => (
            <li key={r.name} className={r.ok ? 'text-live' : 'text-fault'}>
              {r.ok ? `✓ ${r.name} — split into ${r.chunks} parts` : `✗ ${r.name} — ${r.error}`}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

/* ───────── Try a question: dikhao AI ko kya jayega ───────── */
function TryQuestion() {
  const [q, setQ] = useState('')
  const search = useMutation({
    mutationFn: (query: string) => api.get<KnowledgeSearch>(`/api/admin/knowledge/search?q=${encodeURIComponent(query)}`),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (q.trim()) search.mutate(q.trim())
  }
  const d = search.data
  const pct = d && d.totalChars ? Math.max(0.1, (d.sentChars / d.totalChars) * 100) : 0

  return (
    <Section title="Try a question" description="See exactly what the AI would receive for a customer’s question.">
      <form onSubmit={submit} className="flex gap-2 p-5 pb-3">
        <label htmlFor="kb-q" className="sr-only">
          Question
        </label>
        <Input id="kb-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="RCS ka rate kya hai?" />
        <Button type="submit" size="icon" className="h-9 w-10" disabled={search.isPending || !q.trim()} aria-label="Search">
          {search.isPending ? <Spinner className="size-3.5" /> : <Search />}
        </Button>
      </form>
      {d ? (
        <div className="px-5 pb-5">
          {d.hits.length ? (
            <>
              <div className="mb-3 rounded-md bg-signal-soft px-3 py-2 text-[13px] text-signal-ink">
                Sends <span className="font-semibold">{d.sentChars.toLocaleString('en-IN')}</span> of {d.totalChars.toLocaleString('en-IN')} characters ({pct.toFixed(pct < 1 ? 1 : 0)}%)
              </div>
              <ol className="grid gap-2">
                {d.hits.map((h, i) => (
                  <li key={i} className="rounded-md border border-line p-3 text-[13px]">
                    <p className="mb-1 flex items-center justify-between gap-2 font-medium">
                      <span className="min-w-0 truncate">{h.title}</span>
                      <span className="shrink-0 font-mono text-[11.5px] text-muted">score {h.score}</span>
                    </p>
                    <p className="line-clamp-4 whitespace-pre-wrap text-muted">{h.text}</p>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="text-[13px] text-muted">Nothing in your files matches — the AI gets no file data for this question.</p>
          )}
        </div>
      ) : null}
    </Section>
  )
}

/* ───────── AI files ka data kaise le ───────── */
const MODES: { value: KnowledgeMode; title: string; body: string }[] = [
  {
    value: 'auto',
    title: 'Auto (recommended)',
    body: 'Claude / Free API ask for data through the Knowledge MCP tool. Demo mode gets it sent automatically.',
  },
  {
    value: 'tool',
    title: 'AI asks via MCP tool',
    body: 'The AI calls search_knowledge only when it needs facts — can search twice for comparisons. If the model can’t use tools, data is sent automatically.',
  },
  {
    value: 'inject',
    title: 'Send automatically',
    body: 'With every question the bot sends the matching parts itself. One AI call, works with every model.',
  },
]

function AiAccess({ data, onSaved }: { data: KnowledgeOverview; onSaved: () => void }) {
  const [mode, setMode] = useState<KnowledgeMode>(data.settings.mode)
  const save = useMutation({
    mutationFn: (m: KnowledgeMode) => api.put('/api/admin/knowledge/settings', { mode: m }),
    onSuccess: () => {
      toast.success('Saved. Used from the next message.')
      onSaved()
    },
    onError: (e) => toast.error(e.message),
  })
  const { access } = data
  const now =
    access.active === 'tool'
      ? { tone: 'live' as const, text: `AI asks via MCP tool (${access.provider})` }
      : access.active === 'inject'
        ? { tone: 'signal' as const, text: `Sent automatically (${access.provider})` }
        : { tone: 'neutral' as const, text: 'Knowledge base is off' }
  return (
    <Section title="How the AI gets your files" description="Who decides which part of your files the AI sees.">
      <div className="grid gap-3 p-5">
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
          Right now: <Badge tone={now.tone}>{now.text}</Badge>
        </p>
        {!access.toolAvailable && data.settings.enabled ? (
          <p className="rounded-md bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
            The Knowledge MCP server isn’t connected, so data is sent automatically. Check it on the MCP servers page.
          </p>
        ) : null}
        <div role="radiogroup" aria-label="How the AI gets your files" className="grid gap-2">
          {MODES.map((m) => (
            <button
              key={m.value}
              role="radio"
              aria-checked={mode === m.value}
              disabled={save.isPending}
              onClick={() => {
                setMode(m.value)
                save.mutate(m.value)
              }}
              className={cn(
                'rounded-md border px-3 py-2.5 text-left transition-colors',
                mode === m.value ? 'border-signal bg-signal-soft' : 'border-line hover:border-line-strong'
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className={cn('size-3 rounded-full border-2', mode === m.value ? 'border-signal bg-signal' : 'border-line-strong')} aria-hidden />
                {m.title}
              </span>
              <span className="mt-0.5 block pl-5 text-[12.5px] text-muted">{m.body}</span>
            </button>
          ))}
        </div>
      </div>
    </Section>
  )
}

/* ───────── Limits ───────── */
function Limits({ settings, onSaved }: { settings: KnowledgeOverview['settings']; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(settings.enabled)
  const [topK, setTopK] = useState(settings.topK)
  const [maxChars, setMaxChars] = useState(settings.maxChars)
  const dirty = enabled !== settings.enabled || topK !== settings.topK || maxChars !== settings.maxChars
  const save = useMutation({
    mutationFn: () => api.put('/api/admin/knowledge/settings', { enabled, topK, maxChars }),
    onSuccess: () => {
      toast.success('Saved. Used from the next message.')
      onSaved()
    },
    onError: (e) => toast.error(e.message),
  })
  return (
    <Section title="How much goes to the AI">
      <div className="grid gap-4 p-5">
        <label className="flex items-center gap-2.5 text-sm">
          <Switch checked={enabled} onCheckedChange={setEnabled} /> Use the knowledge base
        </label>
        <Field label="Parts per question" htmlFor="kb-topk" hint="1–10. Fewer parts = less data shared, cheaper replies.">
          <Input id="kb-topk" type="number" min={1} max={10} value={topK} onChange={(e) => setTopK(Number(e.target.value))} />
        </Field>
        <Field label="Characters per question (max)" htmlFor="kb-max" hint="500–8000. A hard cap on file text sent with one question.">
          <Input id="kb-max" type="number" min={500} max={8000} step={100} value={maxChars} onChange={(e) => setMaxChars(Number(e.target.value))} />
        </Field>
        <div>
          <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            {save.isPending ? <Spinner className="size-3.5" /> : null} Save limits
          </Button>
        </div>
      </div>
    </Section>
  )
}

function Chunks({ doc }: { doc: KnowledgeDoc }) {
  const q = useQuery({
    queryKey: ['kb-chunks', doc._id],
    queryFn: () => api.get<{ title: string; text: string; order: number }[]>(`/api/admin/knowledge/docs/${doc._id}/chunks`),
  })
  return (
    <Sheet title={doc.name} description={`${doc.chunkCount} parts — the bot picks only the parts that match a question.`}>
      {q.isLoading ? <Spinner /> : null}
      <ErrorNote error={q.error} />
      <ol className="grid gap-3">
        {q.data?.map((c) => (
          <li key={c.order} className="rounded-md border border-line p-3">
            <p className="mb-1 text-[13px] font-medium">
              <span className="mr-2 font-mono text-[11.5px] text-muted">#{c.order + 1}</span>
              {c.title}
            </p>
            <p className="whitespace-pre-wrap text-[13px] text-muted">{c.text}</p>
          </li>
        ))}
      </ol>
    </Sheet>
  )
}
