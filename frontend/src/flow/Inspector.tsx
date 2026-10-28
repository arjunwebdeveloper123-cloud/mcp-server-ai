import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2, Wand2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { api, type McpServerItem } from '@/lib/api'
import { BOXES, OPERATORS, VALIDATIONS, uid, type BoxData, type BoxType, type ButtonOption } from './boxes'

type Props = {
  node: { id: string; type: BoxType; data: BoxData }
  variables: string[]
  onChange: (patch: Partial<BoxData>) => void
  onDelete: () => void
  onClose: () => void
  onOptionRemoved: (optionId: string) => void
}

export function Inspector({ node, variables, onChange, onDelete, onClose, onOptionRemoved }: Props) {
  const meta = BOXES[node.type]
  const d = node.data
  const id = (k: string) => `insp-${node.id}-${k}`
  const varHint = variables.length ? `You can use ${variables.map((v) => `{{${v}}}`).join(' ')}` : 'Answers saved by Question boxes can be used as {{name}}'

  return (
    <aside className="flex h-full w-full flex-col border-l border-line bg-panel" aria-label="Box settings">
      <header className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <p className="text-[12px] text-muted">{meta.title}</p>
          <p className="font-semibold">{d.label || meta.title}</p>
        </div>
        <button onClick={onClose} className="rounded p-1 text-muted hover:bg-paper hover:text-ink" aria-label="Close settings">
          <X className="size-4" />
        </button>
      </header>

      <div className="grid flex-1 content-start gap-4 overflow-y-auto p-4">
        {node.type !== 'start' ? (
          <Field label="Box name" htmlFor={id('label')} hint="Only you see this — keeps the canvas readable">
            <Input id={id('label')} value={d.label ?? ''} onChange={(e) => onChange({ label: e.target.value })} />
          </Field>
        ) : (
          <p className="text-[13px] text-muted">Every new conversation starts here. Drag an arrow from the dot at the bottom to the first step.</p>
        )}

        {/* ── Message / Handoff / End ── */}
        {node.type === 'message' || node.type === 'handoff' || node.type === 'end' ? (
          <Field label={node.type === 'end' ? 'Last message (optional)' : 'Message'} htmlFor={id('text')} hint={varHint}>
            <Textarea id={id('text')} value={d.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} className="min-h-28" />
          </Field>
        ) : null}
        {node.type === 'handoff' ? (
          <p className="rounded-md bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
            The chat is marked “Needs human” in Conversations and a conversation.handoff webhook fires. The bot stays quiet until someone resolves it.
          </p>
        ) : null}

        {/* ── Question ── */}
        {node.type === 'question' ? (
          <>
            <Field label="Question" htmlFor={id('text')} hint={varHint}>
              <Textarea id={id('text')} value={d.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} className="min-h-20" />
            </Field>
            <Field label="Expected answer" htmlFor={id('val')} hint="The bot asks again if the answer doesn’t fit">
              <Select id={id('val')} value={d.validation ?? 'text'} onChange={(e) => onChange({ validation: e.target.value })}>
                {VALIDATIONS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Save answer as" htmlFor={id('var')} hint="Use it later as {{name}}">
              <Input id={id('var')} value={d.variable ?? ''} onChange={(e) => onChange({ variable: slug(e.target.value) })} className="font-mono" placeholder="name" />
            </Field>
            <Field label="Message when the answer is wrong (optional)" htmlFor={id('err')}>
              <Input id={id('err')} value={d.errorMessage ?? ''} onChange={(e) => onChange({ errorMessage: e.target.value })} placeholder="Uses a sensible default" />
            </Field>
            <label className="flex items-center gap-2.5 text-[13px]">
              <Switch checked={Boolean(d.skipIfKnown)} onCheckedChange={(v) => onChange({ skipIfKnown: v })} />
              Skip if we already know it
            </label>
          </>
        ) : null}

        {/* ── Buttons ── */}
        {node.type === 'buttons' ? <ButtonsFields d={d} id={id} varHint={varHint} onChange={onChange} onOptionRemoved={onOptionRemoved} /> : null}

        {/* ── Condition ── */}
        {node.type === 'condition' ? (
          <>
            <Field label="Check this answer" htmlFor={id('cvar')}>
              <Input id={id('cvar')} value={d.variable ?? ''} onChange={(e) => onChange({ variable: slug(e.target.value) })} list={id('vars')} className="font-mono" />
              <datalist id={id('vars')}>
                {variables.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </Field>
            <Field label="Rule" htmlFor={id('op')}>
              <Select id={id('op')} value={d.operator ?? 'equals'} onChange={(e) => onChange({ operator: e.target.value })}>
                {OPERATORS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            {d.operator !== 'is_set' && d.operator !== 'is_empty' ? (
              <Field label="Value" htmlFor={id('cval')}>
                <Input id={id('cval')} value={d.value ?? ''} onChange={(e) => onChange({ value: e.target.value })} />
              </Field>
            ) : null}
            <p className="text-[12.5px] text-muted">Connect the Yes and No dots to what happens next.</p>
          </>
        ) : null}

        {/* ── AI ── */}
        {node.type === 'ai' ? (
          <>
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium text-ink-2">How it works</legend>
              <div className="grid gap-2">
                {(
                  [
                    ['once', 'Answer once, then continue', 'Good for “explain our services”'],
                    ['chat', 'Keep chatting', 'Answers every message until an exit word'],
                  ] as const
                ).map(([v, title, sub]) => (
                  <label key={v} className={`cursor-pointer rounded-md border px-3 py-2 ${(d.mode ?? 'once') === v ? 'border-signal bg-signal-soft' : 'border-line-strong'}`}>
                    <input type="radio" className="sr-only" checked={(d.mode ?? 'once') === v} onChange={() => onChange({ mode: v })} />
                    <span className="block text-[13px] font-medium">{title}</span>
                    <span className="block text-[12px] text-muted">{sub}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Instruction for the AI" htmlFor={id('ins')} hint="Only the file parts that match the customer’s message are sent with it">
              <Textarea id={id('ins')} value={d.instruction ?? ''} onChange={(e) => onChange({ instruction: e.target.value })} className="min-h-24" />
            </Field>
            {d.mode === 'chat' ? (
              <>
                <Field label="First message (optional)" htmlFor={id('intro')} hint="Shown when this box starts, before any AI reply">
                  <Input id={id('intro')} value={d.intro ?? ''} onChange={(e) => onChange({ intro: e.target.value })} placeholder="Zaroor! Apna sawaal likhiye." />
                </Field>
                <Field label="Exit words" htmlFor={id('exit')} hint="Comma separated. Typing one follows the arrow out of this box.">
                  <Input id={id('exit')} value={d.exitKeywords ?? ''} onChange={(e) => onChange({ exitKeywords: e.target.value })} placeholder="menu, back" />
                </Field>
              </>
            ) : null}
          </>
        ) : null}

        {/* ── Tool ── */}
        {node.type === 'tool' ? <ToolFields d={d} id={id} varHint={varHint} onChange={onChange} /> : null}

        {/* ── Webhook ── */}
        {node.type === 'webhook' ? (
          <>
            <Field label="URL" htmlFor={id('url')} hint="All saved answers are POSTed as JSON: { variables: { name, phone, … } }">
              <Input id={id('url')} value={d.url ?? ''} onChange={(e) => onChange({ url: e.target.value })} className="font-mono" />
            </Field>
            <p className="text-[12.5px] text-muted">The response status is saved as {'{{webhookStatus}}'}.</p>
          </>
        ) : null}
      </div>

      {node.type !== 'start' ? (
        <footer className="border-t border-line p-4">
          <Button variant="danger" size="sm" onClick={onDelete}>
            <Trash2 /> Delete box
          </Button>
        </footer>
      ) : null}
    </aside>
  )
}

const slug = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30)

function ButtonsFields({
  d,
  id,
  varHint,
  onChange,
  onOptionRemoved,
}: {
  d: BoxData
  id: (k: string) => string
  varHint: string
  onChange: (p: Partial<BoxData>) => void
  onOptionRemoved: (optionId: string) => void
}) {
  const options = d.options ?? []
  const setOpt = (i: number, patch: Partial<ButtonOption>) => onChange({ options: options.map((o, j) => (j === i ? { ...o, ...patch } : o)) })
  return (
    <>
      <Field label="Message above the buttons" htmlFor={id('text')} hint={varHint}>
        <Textarea id={id('text')} value={d.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} className="min-h-16" />
      </Field>
      <div>
        <p className="mb-1.5 text-[13px] font-medium text-ink-2">Buttons</p>
        <ul className="grid gap-2">
          {options.map((o, i) => (
            <li key={o.id} className="flex items-center gap-1.5">
              <label className="sr-only" htmlFor={id(`opt-${o.id}`)}>
                Button {i + 1}
              </label>
              <Input id={id(`opt-${o.id}`)} value={o.label} onChange={(e) => setOpt(i, { label: e.target.value })} className="h-8 text-[13px]" />
              <Input
                aria-label={`Saved value for button ${i + 1}`}
                value={o.value ?? ''}
                onChange={(e) => setOpt(i, { value: e.target.value })}
                placeholder="value"
                className="h-8 w-24 font-mono text-[12px]"
              />
              <button
                onClick={() => {
                  onChange({ options: options.filter((x) => x.id !== o.id) })
                  onOptionRemoved(o.id)
                }}
                className="rounded p-1.5 text-muted hover:bg-paper hover:text-fault"
                aria-label={`Remove button ${o.label}`}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
        {options.length < 10 ? (
          <Button variant="ghost" size="sm" className="mt-1 -ml-2" onClick={() => onChange({ options: [...options, { id: uid('opt'), label: `Option ${options.length + 1}` }] })}>
            <Plus /> Add button
          </Button>
        ) : null}
        <p className="mt-1 text-[12px] text-muted">“value” is what gets saved (e.g. label “Google Business Profile”, value “gmb”). Empty = the label.</p>
      </div>
      <Field label="If the customer types something else" htmlFor={id('fb')}>
        <Select id={id('fb')} value={d.fallback ?? 'repeat'} onChange={(e) => onChange({ fallback: e.target.value as 'repeat' | 'ai' })}>
          <option value="repeat">Ask them to pick a button</option>
          <option value="ai">Let the AI answer, then show the buttons again</option>
        </Select>
      </Field>
      <Field label="Save choice as (optional)" htmlFor={id('bvar')}>
        <Input id={id('bvar')} value={d.variable ?? ''} onChange={(e) => onChange({ variable: slug(e.target.value) })} className="font-mono" placeholder="service" />
      </Field>
    </>
  )
}

function ToolFields({ d, id, varHint, onChange }: { d: BoxData; id: (k: string) => string; varHint: string; onChange: (p: Partial<BoxData>) => void }) {
  const servers = useQuery({ queryKey: ['mcp-servers'], queryFn: () => api.get<McpServerItem[]>('/api/admin/mcp/servers') })
  const tools = useMemo(() => (servers.data ?? []).flatMap((s) => s.tools.map((t) => ({ ...t, server: s.name, connected: s.status === 'connected' }))), [servers.data])
  const selected = tools.find((t) => t.fullName === d.tool)

  // Tool ke input schema se args ka template: {"name": "{{name}}", ...}
  const fillArgs = () => {
    const props = selected?.inputSchema?.properties ?? {}
    const obj = Object.fromEntries(Object.keys(props).map((k) => [k, `{{${k}}}`]))
    onChange({ args: JSON.stringify(obj, null, 2) })
  }

  let argsError = ''
  try {
    JSON.parse((d.args ?? '{}').replace(/\{\{\s*[\w.]+\s*\}\}/g, 'x') || '{}')
  } catch {
    argsError = 'Must be valid JSON, like {"phone": "{{phone}}"}'
  }

  return (
    <>
      <Field label="Tool" htmlFor={id('tool')} hint={selected?.description}>
        <Select id={id('tool')} value={d.tool ?? ''} onChange={(e) => onChange({ tool: e.target.value })}>
          <option value="">Choose a tool…</option>
          {tools.map((t) => (
            <option key={t.fullName} value={t.fullName}>
              {t.fullName}
              {t.connected ? '' : ' (not connected)'}
            </option>
          ))}
          {d.tool && !selected ? <option value={d.tool}>{d.tool} (not connected)</option> : null}
        </Select>
      </Field>
      <Field label="Arguments (JSON)" htmlFor={id('args')} hint={argsError ? undefined : varHint} error={argsError || undefined}>
        <Textarea id={id('args')} value={d.args ?? ''} onChange={(e) => onChange({ args: e.target.value })} className="min-h-28 font-mono text-[12.5px]" spellCheck={false} />
      </Field>
      {selected ? (
        <Button variant="secondary" size="sm" onClick={fillArgs}>
          <Wand2 /> Fill from tool
        </Button>
      ) : null}
      <Field label="Save result as" htmlFor={id('rv')} hint="Show it in a later message, e.g. {{toolResult}}">
        <Input id={id('rv')} value={d.resultVar ?? ''} onChange={(e) => onChange({ resultVar: slug(e.target.value) })} className="font-mono" placeholder="toolResult" />
      </Field>
      <p className="text-[12.5px] text-muted">Connect the Success and Error dots. If Error isn’t connected, Success is used.</p>
    </>
  )
}
