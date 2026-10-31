import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  GitBranch,
  Globe,
  KeyRound,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge, Spinner } from '@/components/ui/bits'
import { api, type McpServerItem, type AiNodeTestResult, type ApiNodeTestResult } from '@/lib/api'
import {
  BOXES,
  OPERATORS,
  VALIDATIONS,
  uid,
  AI_PROVIDERS,
  PROMPT_TEMPLATES,
  type BoxData,
  type BoxType,
  type ButtonOption,
  type AiProvider,
} from './boxes'
import { cn } from '@/lib/utils'

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

        {/* ── AI Reply Node (Interactive API credentials & Prompt instructions) ── */}
        {node.type === 'ai' ? (
          <AiFields d={d} id={id} varHint={varHint} variables={variables} onChange={onChange} />
        ) : null}

        {/* ── Tool ── */}
        {node.type === 'tool' ? <ToolFields d={d} id={id} varHint={varHint} onChange={onChange} /> : null}

        {/* ── API Request ── */}
        {node.type === 'api' ? <ApiFields d={d} id={id} varHint={varHint} variables={variables} onChange={onChange} /> : null}

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

/**
 * AI Reply Node Inspector
 * Step 1: Provider selection, Reference models, API Key, and Real-time Live API testing.
 * Step 2: Prompt / Instructions for what needs to be done by the AI + quick templates and variable inserter.
 */
function AiFields({
  d,
  id,
  varHint: _varHint,
  variables,
  onChange,
}: {
  d: BoxData
  id: (k: string) => string
  varHint: string
  variables: string[]
  onChange: (p: Partial<BoxData>) => void
}) {
  const currentProviderKey = (d.aiProvider || 'gemini') as AiProvider
  const currentProvider = AI_PROVIDERS[currentProviderKey] || AI_PROVIDERS.gemini
  const [showKey, setShowKey] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<AiNodeTestResult | null>(null)

  const handleTestLive = async () => {
    if (!d.aiApiKey?.trim() && currentProviderKey !== 'custom') {
      toast.error('Please enter your API key first.')
      return
    }
    setIsTesting(true)
    setTestResult(null)
    try {
      const res = await api.post<AiNodeTestResult>('/api/admin/flows/test-ai-key', {
        provider: currentProviderKey,
        apiKey: d.aiApiKey || '',
        model: d.aiModel || currentProvider.defaultModel,
        baseUrl: d.aiBaseUrl || currentProvider.defaultBaseUrl,
      })
      setTestResult(res)
      if (res.ok) {
        const patch: Partial<BoxData> = {
          aiVerified: true,
          aiVerifiedAt: new Date().toISOString(),
        }
        if (res.model && res.model !== d.aiModel) {
          patch.aiModel = res.model
        }
        onChange(patch)
        if (res.note) {
          toast.success(res.note)
        } else {
          toast.success(`Live API verified! Latency: ${res.latencyMs}ms`)
        }
      } else {
        onChange({ aiVerified: false })
        toast.error(res.error || 'API verification failed.')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setTestResult({
        ok: false,
        error: msg,
        latencyMs: 0,
        provider: currentProviderKey,
        model: d.aiModel || currentProvider.defaultModel,
      })
      onChange({ aiVerified: false })
      toast.error(msg)
    } finally {
      setIsTesting(false)
    }
  }

  const setProvider = (p: AiProvider) => {
    const prov = AI_PROVIDERS[p]
    onChange({
      aiProvider: p,
      aiModel: prov.defaultModel,
      aiBaseUrl: prov.defaultBaseUrl || '',
      aiVerified: false,
    })
    setTestResult(null)
  }

  const applyPromptTemplate = (tmpl: { title: string; text: string }) => {
    onChange({ instruction: tmpl.text })
    toast.success(`Applied: ${tmpl.title}`)
  }

  const insertVariable = (varName: string) => {
    const token = `{{${varName}}}`
    const current = d.instruction ?? ''
    onChange({ instruction: current ? `${current} ${token}` : token })
    toast.success(`Inserted ${token}`)
  }

  const hasKey = Boolean(d.aiApiKey?.trim())

  return (
    <div className="grid gap-5">
      {/* ── STEP 1: AI Provider & API Key Setup ── */}
      <section className="rounded-lg border border-line bg-paper/60 p-3.5 space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <KeyRound className="size-4 text-signal" />
            <span className="text-[13px] font-semibold text-ink">1. AI Credentials & Model</span>
          </div>
          {d.aiVerified && hasKey ? (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
            </span>
          ) : hasKey ? (
            <span className="rounded bg-signal-soft px-2 py-0.5 text-[11px] font-medium text-signal">
              Key entered
            </span>
          ) : (
            <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
              Key required
            </span>
          )}
        </div>

        {!hasKey ? (
          <div className="rounded-md border border-amber-500/25 bg-amber-500/10 p-2.5 text-[12px] text-amber-900 dark:text-amber-200">
            <p className="font-semibold">🔑 First: Add your AI API key</p>
            <p className="mt-0.5 text-muted leading-snug">
              Choose your provider, enter your API key, and test live connectivity in real time.
            </p>
          </div>
        ) : null}

        {/* Provider selection pills */}
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted">Choose AI Provider</label>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {(Object.keys(AI_PROVIDERS) as AiProvider[]).map((pKey) => {
              const p = AI_PROVIDERS[pKey]
              const isSelected = currentProviderKey === pKey
              return (
                <button
                  key={pKey}
                  type="button"
                  onClick={() => setProvider(pKey)}
                  className={cn(
                    'flex flex-col items-start rounded-md border p-2 text-left transition-all',
                    isSelected
                      ? 'border-signal bg-signal-soft/70 shadow-xs'
                      : 'border-line bg-panel hover:border-line-strong'
                  )}
                >
                  <span className={cn('text-[12px] font-semibold', isSelected ? 'text-signal' : 'text-ink')}>
                    {p.name.split(' ')[0]}
                  </span>
                  <span className="line-clamp-1 text-[10.5px] text-muted">
                    {pKey === 'gemini' ? 'Free tier' : pKey === 'openai' ? 'GPT-4o' : pKey === 'anthropic' ? 'Claude' : pKey === 'groq' ? 'Llama 3' : 'Custom'}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-[11.5px] text-muted">{currentProvider.subtitle}</p>
        </div>

        {/* Model Reference & Selector */}
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted">
            Model Reference (Click to pick)
          </label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {currentProvider.models.map((m) => {
              const isModelSelected = (d.aiModel || currentProvider.defaultModel) === m.id
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onChange({ aiModel: m.id })
                    setTestResult(null)
                  }}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                    isModelSelected
                      ? 'border-signal bg-signal text-white'
                      : 'border-line-strong bg-panel text-ink-2 hover:border-signal hover:text-signal'
                  )}
                >
                  {m.label}
                </button>
              )
            })}
          </div>

          <Field label="Model identifier" htmlFor={id('ai-model')} hint="Pick from buttons above or enter any custom model name">
            <Input
              id={id('ai-model')}
              value={d.aiModel ?? currentProvider.defaultModel}
              onChange={(e) => {
                onChange({ aiModel: e.target.value })
                setTestResult(null)
              }}
              placeholder={currentProvider.defaultModel}
              className="font-mono text-[12.5px]"
            />
          </Field>
        </div>

        {/* Custom Base URL (if custom provider or if user sets custom URL) */}
        {currentProviderKey === 'custom' || d.aiBaseUrl ? (
          <Field label="API Base URL" htmlFor={id('ai-baseurl')} hint="OpenAI-compatible completions endpoint base URL">
            <Input
              id={id('ai-baseurl')}
              value={d.aiBaseUrl ?? currentProvider.defaultBaseUrl ?? ''}
              onChange={(e) => {
                onChange({ aiBaseUrl: e.target.value })
                setTestResult(null)
              }}
              placeholder={currentProvider.defaultBaseUrl || 'https://api.openai.com/v1'}
              className="font-mono text-[12.5px]"
            />
          </Field>
        ) : null}

        {/* API Key Input */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor={id('ai-key')} className="text-[12.5px] font-medium text-ink-2">
              {currentProvider.keyName}
            </label>
            <a
              href={currentProvider.keyDocUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11.5px] font-medium text-signal hover:underline"
            >
              Get API key <ExternalLink className="size-3" />
            </a>
          </div>
          <div className="relative">
            <Input
              id={id('ai-key')}
              type={showKey ? 'text' : 'password'}
              value={d.aiApiKey ?? ''}
              onChange={(e) => {
                onChange({ aiApiKey: e.target.value, aiVerified: false })
                setTestResult(null)
              }}
              placeholder={currentProvider.keyPlaceholder}
              className="font-mono pr-9 text-[12.5px]"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink p-1"
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
            >
              {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
        </div>

        {/* Real-time Live API Test Button */}
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleTestLive}
            disabled={isTesting || (!hasKey && currentProviderKey !== 'custom')}
            className="w-full justify-center"
          >
            <Sparkles className={cn('size-3.5 text-signal', isTesting ? 'animate-spin' : '')} />
            {isTesting ? 'Checking Live Real-Time API…' : 'Check Real-time API'}
          </Button>

          {/* Test Result Display */}
          {testResult ? (
            <div
              className={cn(
                'mt-2 rounded-md border p-2.5 text-[12px]',
                testResult.ok
                  ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                  : 'border-fault/25 bg-fault-soft text-fault'
              )}
            >
              {testResult.ok ? (
                <div>
                  <p className="font-semibold flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                    <Check className="size-3.5" /> Live API Connected!
                  </p>
                  <p className="mt-0.5 text-muted">
                    Responded in {testResult.latencyMs}ms • Model: <span className="font-mono">{testResult.model}</span>
                  </p>
                  {testResult.note ? (
                    <p className="mt-1 text-xs text-amber-800 dark:text-amber-300 font-medium">
                      ℹ️ {testResult.note}
                    </p>
                  ) : null}
                  <p className="mt-1 italic text-ink-2 truncate">
                    “{testResult.reply}”
                  </p>
                </div>
              ) : (
                <div>
                  <p className="font-semibold text-fault">Connection Failed</p>
                  <p className="mt-0.5 leading-snug">{testResult.error}</p>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </section>

      {/* ── STEP 2: AI Prompt & Instructions ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Wand2 className="size-4 text-purple-600" />
          <div>
            <span className="block text-[13px] font-semibold text-ink">2. AI Prompt & Instructions</span>
            <span className="block text-[11.5px] text-muted">Enter what needs to be done by the AI at this step</span>
          </div>
        </div>

        {/* Quick prompt templates */}
        <div>
          <p className="mb-1 text-[11.5px] font-medium text-muted">Quick Prompt Templates:</p>
          <div className="flex flex-wrap gap-1">
            {PROMPT_TEMPLATES.map((tmpl) => (
              <button
                key={tmpl.title}
                type="button"
                onClick={() => applyPromptTemplate(tmpl)}
                className="rounded border border-line-strong bg-paper px-2 py-0.5 text-[11px] text-ink-2 hover:border-signal hover:text-signal"
              >
                + {tmpl.title}
              </button>
            ))}
          </div>
        </div>

        <Field
          label="AI Prompt / Instructions"
          htmlFor={id('ins')}
          hint="Instruct the AI on what it should do (e.g. answer queries, recommend services, qualify leads)."
        >
          <Textarea
            id={id('ins')}
            value={d.instruction ?? ''}
            onChange={(e) => onChange({ instruction: e.target.value })}
            placeholder="e.g. Answer the customer's question helpfully using company knowledge..."
            className="min-h-32 text-[13px] leading-relaxed"
          />
        </Field>

        {/* Variables chips */}
        {variables.length ? (
          <div>
            <p className="mb-1 text-[11.5px] font-medium text-muted">Insert Saved Variable:</p>
            <div className="flex flex-wrap gap-1">
              {variables.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVariable(v)}
                  className="rounded border border-line bg-paper px-2 py-0.5 font-mono text-[11px] text-ink-2 hover:border-signal hover:text-signal"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Conversation Mode */}
        <fieldset>
          <legend className="mb-1.5 text-[12.5px] font-medium text-ink-2">Conversation Mode</legend>
          <div className="grid gap-1.5">
            {(
              [
                ['once', 'Answer once, then proceed', 'Answers customer inquiry then proceeds to the next box in the flow'],
                ['chat', 'Keep chatting (Interactive)', 'Maintains back-and-forth chat until customer types an exit keyword'],
              ] as const
            ).map(([v, title, sub]) => (
              <label
                key={v}
                className={cn(
                  'cursor-pointer rounded-md border px-3 py-2 transition-all',
                  (d.mode ?? 'once') === v ? 'border-signal bg-signal-soft/50' : 'border-line hover:bg-paper'
                )}
              >
                <input
                  type="radio"
                  className="sr-only"
                  checked={(d.mode ?? 'once') === v}
                  onChange={() => onChange({ mode: v })}
                />
                <span className="block text-[12.5px] font-medium">{title}</span>
                <span className="block text-[11.5px] text-muted">{sub}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {d.mode === 'chat' ? (
          <>
            <Field label="First message / Greeting" htmlFor={id('intro')} hint="Sent when this box starts, before customer types anything">
              <Input
                id={id('intro')}
                value={d.intro ?? ''}
                onChange={(e) => onChange({ intro: e.target.value })}
                placeholder="Sure! How can I assist you with our services today?"
              />
            </Field>
            <Field label="Exit keywords" htmlFor={id('exit')} hint="Comma separated. Typing one follows the arrow out of this box.">
              <Input
                id={id('exit')}
                value={d.exitKeywords ?? ''}
                onChange={(e) => onChange({ exitKeywords: e.target.value })}
                placeholder="menu, back, exit, done, agent"
              />
            </Field>
          </>
        ) : null}
      </section>
    </div>
  )
}

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

/**
 * API Request Node Inspector
 * - HTTP Method selector (GET, POST, PUT, PATCH, DELETE)
 * - URL field with {{variables}} support and quick variable inserter
 * - Request Headers (JSON editor with quick Bearer token button)
 * - Request Body (for POST, PUT, PATCH, DELETE with variables support)
 * - Save response data as (resultVar) & status code as (statusVar)
 * - Extract JSON path (responsePath)
 * - Real-time Test API Request with status, latency, response body, and extracted field preview
 */
function ApiFields({
  d,
  id,
  varHint: _varHint,
  variables,
  onChange,
}: {
  d: BoxData
  id: (k: string) => string
  varHint: string
  variables: string[]
  onChange: (p: Partial<BoxData>) => void
}) {
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<ApiNodeTestResult | null>(null)
  const [showHeaders, setShowHeaders] = useState(false)
  const [copied, setCopied] = useState(false)

  const method = (d.method || 'GET') as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  const hasBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)

  let headersError = ''
  if (d.headers?.trim()) {
    try {
      JSON.parse(d.headers.replace(/\{\{\s*[\w.]+\s*\}\}/g, '"dummy"'))
    } catch {
      headersError = 'Must be valid JSON, e.g. {"Authorization": "Bearer ..."}'
    }
  }

  const handleTestApi = async () => {
    const rawUrl = (d.url || '').trim()
    if (!rawUrl) {
      toast.error('Please enter an API URL first.')
      return
    }
    if (!/^https?:\/\//i.test(rawUrl)) {
      toast.error('URL must start with http:// or https://')
      return
    }

    setIsTesting(true)
    setTestResult(null)

    // Substitute sample variable values if variables are used in testing
    const sampleVars: Record<string, string> = {
      name: 'John Doe',
      phone: '9876543210',
      email: 'john@example.com',
      service: 'General Inquiry',
    }
    variables.forEach((v) => {
      if (!sampleVars[v]) sampleVars[v] = `test_${v}`
    })

    const testUrl = rawUrl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k) => sampleVars[k] || 'test_val')
    const testHeaders = (d.headers || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k) => sampleVars[k] || 'test_val')
    const testBody = (d.body || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k) => sampleVars[k] || 'test_val')

    try {
      const res = await api.post<ApiNodeTestResult>('/api/admin/flows/test-api-node', {
        method,
        url: testUrl,
        headers: testHeaders || undefined,
        body: hasBody ? testBody : undefined,
      })
      setTestResult(res)
      if (res.ok) {
        toast.success(`API request successful (${res.status} ${res.statusText || 'OK'})`)
      } else {
        toast.error(`API returned ${res.status} ${res.statusText || 'Error'}`)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Request failed'
      setTestResult({
        ok: false,
        status: 0,
        statusText: 'Failed',
        latencyMs: 0,
        error: msg,
      })
      toast.error(`API test failed: ${msg}`)
    } finally {
      setIsTesting(false)
    }
  }

  // Calculate extracted field preview if responsePath is set and we have response data
  const extractedValue = useMemo(() => {
    if (!testResult?.data || !d.responsePath?.trim()) return undefined
    const cleanPath = d.responsePath.trim().replace(/^(\$|\.)+/, '')
    const parts = cleanPath.replace(/\[(\w+)\]/g, '.$1').split('.').filter(Boolean)
    let curr: any = testResult.data
    for (const part of parts) {
      if (curr == null) return undefined
      curr = curr[part]
    }
    return curr
  }, [testResult?.data, d.responsePath])

  const copyResponse = () => {
    const textToCopy = testResult?.data ? JSON.stringify(testResult.data, null, 2) : testResult?.raw || ''
    if (!textToCopy) return
    navigator.clipboard.writeText(textToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success('Response copied to clipboard')
  }

  const insertVariableIntoUrl = (varName: string) => {
    const current = d.url || ''
    onChange({ url: `${current}{{${varName}}}` })
  }

  const insertVariableIntoBody = (varName: string) => {
    const current = d.body || ''
    onChange({ body: `${current}{{${varName}}}` })
  }

  const addBearerHeader = () => {
    let currentObj: Record<string, string> = {}
    try {
      currentObj = JSON.parse(d.headers || '{}')
    } catch {
      currentObj = { 'Content-Type': 'application/json' }
    }
    currentObj['Authorization'] = 'Bearer YOUR_TOKEN_HERE'
    onChange({ headers: JSON.stringify(currentObj, null, 2) })
  }

  return (
    <>
      {/* ── Method & URL ── */}
      <div>
        <label className="block text-[12.5px] font-medium text-ink mb-1.5">HTTP Method</label>
        <div className="flex flex-wrap gap-1">
          {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).map((m) => {
            const isSelected = method === m
            return (
              <button
                key={m}
                type="button"
                onClick={() => onChange({ method: m })}
                className={cn(
                  'rounded px-2.5 py-1 font-mono text-[11.5px] font-bold transition-all',
                  isSelected
                    ? m === 'GET'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : m === 'POST'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : m === 'PUT'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : m === 'PATCH'
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'bg-rose-600 text-white shadow-sm'
                    : 'bg-paper text-muted hover:bg-paper/80 hover:text-ink'
                )}
              >
                {m}
              </button>
            )
          })}
        </div>
      </div>

      <Field label="API Endpoint URL" htmlFor={id('url')} hint="Supports {{variable}} dynamic replacement">
        <Input
          id={id('url')}
          value={d.url ?? ''}
          onChange={(e) => onChange({ url: e.target.value })}
          placeholder="https://api.example.com/v1/resource"
          className="font-mono text-[12.5px]"
        />
      </Field>

      {variables.length ? (
        <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted -mt-2">
          <span>Add variable:</span>
          {variables.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insertVariableIntoUrl(v)}
              className="rounded bg-paper px-1.5 py-0.5 font-mono text-signal hover:bg-signal-soft"
              title={`Append {{${v}}} to URL`}
            >
              {`{{${v}}}`}
            </button>
          ))}
        </div>
      ) : null}

      {/* ── Headers (Collapsible / Expandable) ── */}
      <div className="rounded-lg border border-line bg-paper/30 p-2.5">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowHeaders(!showHeaders)}
            className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink hover:text-signal"
          >
            {showHeaders ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            Request Headers (JSON)
          </button>
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={addBearerHeader}>
            + Add Bearer Auth
          </Button>
        </div>

        {showHeaders ? (
          <div className="mt-2 grid gap-1.5">
            <Textarea
              id={id('headers')}
              value={d.headers ?? '{\n  "Content-Type": "application/json"\n}'}
              onChange={(e) => onChange({ headers: e.target.value })}
              className="min-h-24 font-mono text-[12px]"
              spellCheck={false}
            />
            {headersError ? <p className="text-[11.5px] text-fault">{headersError}</p> : null}
            <div className="flex justify-between text-[11px] text-muted">
              <span>Supports {'{{variable}}'} in header values</span>
              <button
                type="button"
                onClick={() => onChange({ headers: '{\n  "Content-Type": "application/json"\n}' })}
                className="text-muted hover:text-ink underline"
              >
                Reset
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Request Body (for POST, PUT, PATCH, DELETE) ── */}
      {hasBody ? (
        <div className="grid gap-1.5">
          <Field
            label="Request Body (JSON / Text)"
            htmlFor={id('body')}
            hint="Supports {{variables}} inside JSON strings"
          >
            <Textarea
              id={id('body')}
              value={d.body ?? ''}
              onChange={(e) => onChange({ body: e.target.value })}
              placeholder={'{\n  "name": "{{name}}",\n  "phone": "{{phone}}"\n}'}
              className="min-h-28 font-mono text-[12px]"
              spellCheck={false}
            />
          </Field>
          {variables.length ? (
            <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted -mt-1">
              <span>Insert in body:</span>
              {variables.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVariableIntoBody(v)}
                  className="rounded bg-paper px-1.5 py-0.5 font-mono text-signal hover:bg-signal-soft"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Save response variables ── */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Save response as" htmlFor={id('rv')} hint="Access via {{name}}">
          <Input
            id={id('rv')}
            value={d.resultVar ?? 'apiResponse'}
            onChange={(e) => onChange({ resultVar: slug(e.target.value) })}
            className="font-mono text-[12px]"
            placeholder="apiResponse"
          />
        </Field>
        <Field label="Save status code as" htmlFor={id('sv')} hint="e.g. 200, 404">
          <Input
            id={id('sv')}
            value={d.statusVar ?? 'apiStatus'}
            onChange={(e) => onChange({ statusVar: slug(e.target.value) })}
            className="font-mono text-[12px]"
            placeholder="apiStatus"
          />
        </Field>
      </div>

      <Field
        label="Extract JSON field (optional)"
        htmlFor={id('rp')}
        hint="e.g. data.id or items[0].name. Empty = entire response"
      >
        <Input
          id={id('rp')}
          value={d.responsePath ?? ''}
          onChange={(e) => onChange({ responsePath: e.target.value })}
          className="font-mono text-[12.5px]"
          placeholder="e.g. data.user.id"
        />
      </Field>

      {/* ── Output Wire Options ── */}
      <div className="rounded-lg border border-line bg-paper/40 p-3">
        <label className="block text-[12.5px] font-semibold text-ink mb-1 flex items-center gap-1.5">
          <GitBranch className="size-3.5 text-signal" />
          Output Wire Option
        </label>
        <p className="text-[12px] text-muted mb-2.5">
          Choose how you want to connect this API node to other nodes:
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onChange({ outputMode: 'single' })}
            className={cn(
              'rounded-md border p-2.5 text-left transition-all',
              (d.outputMode ?? 'single') === 'single'
                ? 'border-signal bg-signal-soft text-signal-ink font-medium shadow-sm'
                : 'border-line bg-panel text-muted hover:border-line-strong hover:text-ink'
            )}
          >
            <span className="block text-[12.5px] font-semibold text-ink">Single Output Wire</span>
            <span className="block text-[11px] leading-snug text-muted mt-1">
              One wire at the bottom that always connects to the next step.
            </span>
          </button>

          <button
            type="button"
            onClick={() => onChange({ outputMode: 'branch' })}
            className={cn(
              'rounded-md border p-2.5 text-left transition-all',
              d.outputMode === 'branch'
                ? 'border-signal bg-signal-soft text-signal-ink font-medium shadow-sm'
                : 'border-line bg-panel text-muted hover:border-line-strong hover:text-ink'
            )}
          >
            <span className="block text-[12.5px] font-semibold text-ink">Success & Error Wires</span>
            <span className="block text-[11px] leading-snug text-muted mt-1">
              Separate Success (2xx) and Error wires to branch your flow.
            </span>
          </button>
        </div>

        <div className="mt-2.5 rounded bg-panel px-2.5 py-2 text-[11.5px] text-muted border border-line">
          {(d.outputMode ?? 'single') === 'single' ? (
            <p className="flex items-start gap-1.5">
              <span className="size-2 mt-1 rounded-full bg-signal shrink-0" />
              <span>
                <strong>Bottom output wire enabled:</strong> Drag a connection from the round handle at the bottom of the API box to any other node.
              </span>
            </p>
          ) : (
            <p className="flex items-start gap-1.5">
              <span className="size-2 mt-1 rounded-full bg-emerald-500 shrink-0" />
              <span>
                <strong>Branch wires enabled:</strong> Connect <strong>Success</strong> for HTTP 2xx and <strong>Error</strong> for 4xx/5xx/network errors (or bottom wire as fallback).
              </span>
            </p>
          )}
        </div>
      </div>

      {/* ── Live Test API Request ── */}
      <div className="mt-1 rounded-lg border border-line bg-panel p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[12.5px] font-semibold text-ink flex items-center gap-1.5">
            <Globe className="size-3.5 text-signal" />
            Live API Test
          </p>
          {testResult ? (
            <Badge tone={testResult.ok ? 'live' : 'fault'}>
              {testResult.status ? `${testResult.status} ${testResult.statusText}` : 'Failed'}
            </Badge>
          ) : null}
        </div>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleTestApi}
          disabled={isTesting}
          className="w-full justify-center gap-2"
        >
          {isTesting ? <Spinner className="size-3.5" /> : <Send className="size-3.5" />}
          {isTesting ? 'Sending Request…' : 'Test API Request Now'}
        </Button>

        {testResult ? (
          <div className="mt-3 grid gap-2">
            <div className="flex items-center justify-between text-[11.5px]">
              <span className="text-muted flex items-center gap-1">
                Response time: <strong className="text-ink">{testResult.latencyMs} ms</strong>
              </span>
              <button
                type="button"
                onClick={copyResponse}
                className="flex items-center gap-1 text-muted hover:text-ink text-[11px]"
              >
                {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            {d.responsePath && extractedValue !== undefined ? (
              <div className="rounded bg-paper p-2 font-mono text-[11.5px] border border-line">
                <span className="text-muted">Extracted [{d.responsePath}]: </span>
                <span className="font-semibold text-signal">
                  {typeof extractedValue === 'object' ? JSON.stringify(extractedValue) : String(extractedValue)}
                </span>
              </div>
            ) : null}

            {testResult.error && !testResult.ok ? (
              <div className="rounded bg-fault-soft p-2 text-[12px] text-fault">
                {testResult.error}
              </div>
            ) : null}

            <div className="relative max-h-48 overflow-y-auto rounded bg-paper/80 p-2 font-mono text-[11px] text-ink-2 border border-line">
              <pre className="whitespace-pre-wrap break-all">
                {testResult.data
                  ? JSON.stringify(testResult.data, null, 2)
                  : testResult.raw || '(Empty response)'}
              </pre>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}
