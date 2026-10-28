import { useMutation } from '@tanstack/react-query'
import { Bot, Cpu, KeyRound, PlugZap, Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Badge, CodeBlock, ErrorNote, Section, Spinner, StatusDot } from '@/components/ui/bits'
import { api, type AiTestResult, type ProviderSetting, type Settings } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useSettingsForm } from './useSettingsForm'

const PROVIDERS: { value: ProviderSetting; title: string; sub: string; icon: typeof Bot }[] = [
  { value: 'auto', title: 'Automatic', sub: 'Claude key → Claude, else Free API key → Free API, else Demo', icon: Sparkles },
  { value: 'demo', title: 'Demo mode', sub: 'Free. Fixed script, no AI — uses your real MCP tools', icon: Bot },
  { value: 'openai', title: 'Free API', sub: 'Groq, Gemini, OpenRouter or any OpenAI-compatible key', icon: KeyRound },
  { value: 'ollama', title: 'Ollama (local AI)', sub: 'Free. Open-source model on your own computer', icon: Cpu },
  { value: 'claude', title: 'Claude', sub: 'Best quality. Needs ANTHROPIC_API_KEY', icon: Sparkles },
]

/** Free API presets — URL aur ek achha default model */
const API_PRESETS = [
  { label: 'Groq', url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { label: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free' },
]

export function SettingsPage() {
  const { query, draft, set, dirty, save, reset } = useSettingsForm()

  const test = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<AiTestResult>('/api/admin/settings/test-ai', body),
  })

  if (query.isLoading || !draft) return query.isError ? <ErrorNote error={query.error} /> : <Spinner />

  const ai = query.data?.ai
  // "auto" asal me kaunsa chalega (form ke hisaab se)
  const effective = draft.provider !== 'auto' ? draft.provider : draft.apiKeyConfigured ? 'claude' : draft.openaiKeyConfigured ? 'openai' : 'demo'
  const usesPrompt = effective !== 'demo'

  const payload: Partial<Settings> = {
    provider: draft.provider,
    ollamaUrl: draft.ollamaUrl,
    ollamaModel: draft.ollamaModel,
    openaiBaseUrl: draft.openaiBaseUrl,
    openaiModel: draft.openaiModel,
    systemPrompt: draft.systemPrompt,
    model: draft.model,
    maxTokens: draft.maxTokens,
    maxToolRounds: draft.maxToolRounds,
  }

  const testResult = test.data ? (
    <div className={cn('mt-3 rounded-md border px-3.5 py-3 text-[13px]', test.data.ok ? 'border-live/25 bg-live-soft' : 'border-fault/25 bg-fault-soft')}>
      {test.data.ok ? (
        <>
          <p className="font-medium text-live">
            Connected in {(test.data.latencyMs / 1000).toFixed(1)}s — model replied “{test.data.reply || '(empty)'}”
          </p>
          <p className={cn('mt-1', test.data.toolCalling ? 'text-live' : 'text-warn')}>
            {test.data.toolCalling
              ? 'Tool calling works — the bot can use your MCP tools.'
              : `Tool calling did not work${test.data.toolNote ? ` (${test.data.toolNote})` : ''}. The bot can chat but may not save leads or book meetings.`}
          </p>
        </>
      ) : (
        <p className="text-fault">{test.data.error}</p>
      )}
    </div>
  ) : null

  return (
    <>
      <PageHeader
        title="Bot settings"
        description="Choose what powers the bot and how it talks. MCP tools decide what it can actually do."
        actions={
          <>
            {dirty ? (
              <Button variant="ghost" onClick={reset}>
                Discard
              </Button>
            ) : null}
            <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(payload)}>
              {save.isPending ? <Spinner className="size-3.5" /> : null} Save settings
            </Button>
          </>
        }
      />

      <Section
        title="AI provider"
        description="Switch any time — MCP tools, webhooks and the widget keep working the same."
        className="mb-6"
        actions={
          ai ? (
            <span className="text-[13px]">
              <StatusDot status={ai.ready ? 'connected' : 'error'} className="mr-1.5" showLabel={false} />
              <span className="text-muted">Now running: </span>
              <span className="font-medium">{PROVIDERS.find((p) => p.value === ai.active)?.title ?? ai.active}</span>
              <span className="text-muted"> — {ai.detail}</span>
            </span>
          ) : null
        }
      >
        <div className="grid gap-2 p-5 sm:grid-cols-2 lg:grid-cols-5" role="radiogroup" aria-label="AI provider">
          {PROVIDERS.map(({ value, title, sub, icon: Icon }) => (
            <label
              key={value}
              className={cn('cursor-pointer rounded-md border px-3.5 py-3', draft.provider === value ? 'border-signal bg-signal-soft' : 'border-line-strong hover:bg-paper')}
            >
              <input
                type="radio"
                name="provider"
                className="sr-only"
                checked={draft.provider === value}
                onChange={() => {
                  set('provider', value)
                  test.reset()
                }}
              />
              <span className="flex items-center gap-2 text-sm font-medium">
                <Icon className="size-4 text-muted" aria-hidden /> {title}
              </span>
              <span className="mt-1 block text-[12.5px] text-muted">{sub}</span>
            </label>
          ))}
        </div>

        {/* ── Free API ── */}
        {effective === 'openai' ? (
          <div className="grid gap-5 border-t border-line p-5 lg:grid-cols-2">
            <div className="grid content-start gap-4">
              <div>
                <p className="mb-2 text-[13px] font-medium text-ink-2">Fill in for</p>
                <div className="flex flex-wrap gap-2">
                  {API_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        set('openaiBaseUrl', p.url)
                        set('openaiModel', p.model)
                        test.reset()
                      }}
                      className={cn(
                        'rounded-md border px-2.5 py-1.5 text-[13px]',
                        draft.openaiBaseUrl === p.url ? 'border-signal text-signal' : 'border-line-strong hover:border-signal hover:text-signal'
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <Field label="API base URL" htmlFor="s-oa-url" hint="The part before /chat/completions">
                <Input id="s-oa-url" value={draft.openaiBaseUrl} onChange={(e) => set('openaiBaseUrl', e.target.value)} className="font-mono" />
              </Field>
              <Field label="Model" htmlFor="s-oa-model" hint="Exactly as your provider writes it">
                <Input id="s-oa-model" value={draft.openaiModel} onChange={(e) => set('openaiModel', e.target.value)} className="font-mono" />
              </Field>
              <div>
                <Button
                  variant="secondary"
                  onClick={() => test.mutate({ provider: 'openai', openaiBaseUrl: draft.openaiBaseUrl, openaiModel: draft.openaiModel })}
                  disabled={test.isPending || !draft.openaiKeyConfigured}
                >
                  {test.isPending ? <Spinner className="size-3.5" /> : <PlugZap />} Test connection
                </Button>
                {testResult}
                <ErrorNote error={test.error} />
              </div>
            </div>
            <div className="text-[13px]">
              <p className="mb-1.5 font-medium text-ink-2">API key</p>
              <p className="mb-2">
                <StatusDot status={draft.openaiKeyConfigured ? 'connected' : 'error'} className="mr-2" />
                <span className="text-muted">{draft.openaiKeyConfigured ? 'Found in backend/.env' : 'Not found in backend/.env'}</span>
              </p>
              <p className="mb-2 text-muted">The key stays in the backend’s .env file and never reaches the browser. To change it, edit the file and restart the backend:</p>
              <CodeBlock>{`OPENAI_COMPAT_API_KEY=your-key-here`}</CodeBlock>
              <p className="mt-3 text-muted">
                Free models are less reliable than Claude at following the flow. If <span className="font-medium">Test connection</span> says tool calling doesn’t work, the bot can still chat but can’t save leads — try another model.
              </p>
            </div>
          </div>
        ) : null}

        {/* ── Ollama ── */}
        {draft.provider === 'ollama' ? (
          <div className="grid gap-5 border-t border-line p-5 lg:grid-cols-2">
            <div className="grid content-start gap-4">
              <Field label="Ollama URL" htmlFor="s-ollama-url" hint="Default when Ollama runs on this computer">
                <Input id="s-ollama-url" value={draft.ollamaUrl} onChange={(e) => set('ollamaUrl', e.target.value)} className="font-mono" />
              </Field>
              <Field label="Model" htmlFor="s-ollama-model" hint="Pick one that supports tool calling: qwen2.5, llama3.1, mistral-nemo">
                {ai?.ollama?.models.length ? (
                  <Select id="s-ollama-model" value={draft.ollamaModel} onChange={(e) => set('ollamaModel', e.target.value)} className="font-mono">
                    {!ai.ollama.models.includes(draft.ollamaModel) ? <option value={draft.ollamaModel}>{draft.ollamaModel} (not downloaded)</option> : null}
                    {ai.ollama.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input id="s-ollama-model" value={draft.ollamaModel} onChange={(e) => set('ollamaModel', e.target.value)} className="font-mono" />
                )}
              </Field>
              <div>
                <Button variant="secondary" onClick={() => test.mutate({ provider: 'ollama', ollamaUrl: draft.ollamaUrl, ollamaModel: draft.ollamaModel })} disabled={test.isPending}>
                  {test.isPending ? <Spinner className="size-3.5" /> : <PlugZap />} Test connection
                </Button>
                {testResult}
                <ErrorNote error={test.error} />
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink-2">Set up Ollama once (Windows)</p>
              <ol className="mb-3 list-decimal space-y-1 pl-5 text-[13px] text-muted">
                <li>Download and install from ollama.com</li>
                <li>Open PowerShell and download a model (about 4.7 GB)</li>
                <li>Keep Ollama running, then test here</li>
              </ol>
              <CodeBlock>{`ollama pull ${draft.ollamaModel || 'qwen2.5:7b'}
ollama list        # downloaded models`}</CodeBlock>
              <p className="mt-2 text-[12.5px] text-muted">Needs about 8 GB RAM. On a slower PC try qwen2.5:3b — faster, but follows the flow less reliably.</p>
            </div>
          </div>
        ) : null}

        {effective === 'demo' ? (
          <div className="border-t border-line px-5 py-4 text-[13px] text-muted">
            Demo mode understands services and pricing questions, collects name → phone → service and saves the lead, checks enquiry status by phone, and
            books meetings if the appointment server is connected. The instructions below are not used in this mode.
          </div>
        ) : null}
      </Section>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Section
          title="Instructions"
          description={usesPrompt ? 'Write the conversation flow step by step. Mention when to use which tool.' : 'Used by Claude, Free API and Ollama. Demo mode follows its own fixed flow.'}
          actions={
            query.data?.recommendedPrompt && draft.systemPrompt !== query.data.recommendedPrompt ? (
              <Button variant="ghost" size="sm" onClick={() => set('systemPrompt', query.data!.recommendedPrompt!)}>
                Use recommended
              </Button>
            ) : (
              <Badge>Recommended</Badge>
            )
          }
        >
          <div className="p-5">
            <label htmlFor="s-prompt" className="sr-only">
              Instructions
            </label>
            <Textarea
              id="s-prompt"
              value={draft.systemPrompt}
              onChange={(e) => set('systemPrompt', e.target.value)}
              className={cn('min-h-[440px] font-mono text-[13px] leading-relaxed', !usesPrompt && 'opacity-60')}
              spellCheck={false}
            />
            <p className="mt-2 flex justify-between text-[12px] text-muted">
              <span>Today’s date and time are added automatically, so the bot understands “kal 4 baje”.</span>
              <span>{draft.systemPrompt.length} characters</span>
            </p>
          </div>
        </Section>

        <div className="grid content-start gap-6">
          <Section title="Limits">
            <div className="grid gap-4 p-5">
              <Field label="Longest reply (tokens)" htmlFor="s-tokens" hint="256–8192. Short chat replies need about 300.">
                <Input id="s-tokens" type="number" min={256} max={8192} value={draft.maxTokens} onChange={(e) => set('maxTokens', Number(e.target.value))} />
              </Field>
              <Field label="Tool calls per message" htmlFor="s-rounds" hint="1–10. Stops the bot from looping on tools.">
                <Input id="s-rounds" type="number" min={1} max={10} value={draft.maxToolRounds} onChange={(e) => set('maxToolRounds', Number(e.target.value))} />
              </Field>
            </div>
          </Section>

          <Section title="Claude">
            <div className="grid gap-4 p-5 text-[13px]">
              <div>
                <StatusDot status={draft.apiKeyConfigured ? 'connected' : 'disabled'} className="mb-1.5" />
                <p className="text-muted">
                  {draft.apiKeyConfigured
                    ? 'An Anthropic key is in backend/.env. It never leaves the server.'
                    : 'No key yet. When you get one, add ANTHROPIC_API_KEY to backend/.env, restart the backend and choose Claude above.'}
                </p>
              </div>
              {effective === 'claude' || draft.apiKeyConfigured ? (
                <Field label="Claude model" htmlFor="s-model" hint="Must be a model your Anthropic account can use">
                  <Input id="s-model" value={draft.model} onChange={(e) => set('model', e.target.value)} className="font-mono" />
                </Field>
              ) : null}
            </div>
          </Section>
        </div>
      </div>
    </>
  )
}
