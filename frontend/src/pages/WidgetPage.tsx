import { PageHeader } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { CodeBlock, CopyField, ErrorNote, Section, Spinner } from '@/components/ui/bits'
import { WidgetChat } from '@/widget/WidgetChat'
import { BACKEND_URL, cn } from '@/lib/utils'
import { useSettingsForm } from './useSettingsForm'

const SWATCHES = ['#2747d6', '#0f6e56', '#b4451f', '#7a3fb8', '#17202e', '#c2185b']

export function WidgetPage() {
  const { query, draft, set, dirty, save, reset } = useSettingsForm()

  if (query.isLoading || !draft) return query.isError ? <ErrorNote error={query.error} /> : <Spinner />

  const snippet = `<script src="${BACKEND_URL}/embed.js" defer></script>`
  const colorOk = /^#[0-9a-fA-F]{6}$/.test(draft.brandColor)

  return (
    <>
      <PageHeader
        title="Website widget"
        description="What visitors see on your website. Changes show in the preview right away and go live when you save."
        actions={
          <>
            {dirty ? (
              <Button variant="ghost" onClick={reset}>
                Discard
              </Button>
            ) : null}
            <Button
              disabled={!dirty || !colorOk || save.isPending}
              onClick={() =>
                save.mutate({
                  botName: draft.botName,
                  welcomeMessage: draft.welcomeMessage,
                  quickReplies: draft.quickReplies,
                  brandColor: draft.brandColor,
                  widgetPosition: draft.widgetPosition,
                })
              }
            >
              {save.isPending ? <Spinner className="size-3.5" /> : null} Save widget
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="grid content-start gap-6">
          <Section title="Look and feel">
            <div className="grid gap-5 p-5">
              <Field label="Bot name" htmlFor="w-name">
                <Input id="w-name" value={draft.botName} onChange={(e) => set('botName', e.target.value)} maxLength={40} />
              </Field>
              <Field label="Welcome message" htmlFor="w-welcome" hint="The first thing visitors read when they open the chat">
                <Textarea id="w-welcome" value={draft.welcomeMessage} onChange={(e) => set('welcomeMessage', e.target.value)} className="min-h-20" maxLength={400} />
              </Field>
              <Field label="Suggested questions" htmlFor="w-quick" hint="One per line, up to 6. Shown as buttons before the first message.">
                <Textarea
                  id="w-quick"
                  value={draft.quickReplies.join('\n')}
                  onChange={(e) => set('quickReplies', e.target.value.split('\n').slice(0, 6))}
                  className="min-h-24"
                />
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Brand colour" htmlFor="w-color" error={colorOk ? undefined : 'Use a hex colour like #2747d6'}>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={colorOk ? draft.brandColor : '#000000'}
                      onChange={(e) => set('brandColor', e.target.value)}
                      className="size-9 cursor-pointer rounded-md border border-line-strong bg-panel p-0.5"
                      aria-label="Pick brand colour"
                    />
                    <Input id="w-color" value={draft.brandColor} onChange={(e) => set('brandColor', e.target.value)} className="font-mono" aria-invalid={!colorOk} />
                  </div>
                  <div className="mt-1 flex gap-1.5">
                    {SWATCHES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => set('brandColor', c)}
                        className={cn('size-6 rounded-full ring-offset-2', draft.brandColor.toLowerCase() === c && 'ring-2 ring-ink')}
                        style={{ background: c }}
                        aria-label={`Use ${c}`}
                      />
                    ))}
                  </div>
                </Field>
                <fieldset>
                  <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Button position</legend>
                  <div className="flex rounded-md border border-line-strong p-0.5 text-[13px]">
                    {(['left', 'right'] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => set('widgetPosition', p)}
                        className={cn('flex-1 rounded py-1.5 font-medium capitalize', draft.widgetPosition === p ? 'bg-ink text-white' : 'text-muted hover:text-ink')}
                      >
                        Bottom {p}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>
            </div>
          </Section>

          <Section title="Add it to your website" description="Paste this just before </body> on every page where the chat should appear.">
            <div className="grid gap-4 p-5">
              <CopyField value={snippet} />
              <details className="text-[13px]">
                <summary className="cursor-pointer font-medium text-signal">Using React or Next.js?</summary>
                <CodeBlock className="mt-2">{`// App.jsx / layout.jsx
useEffect(() => {
  const s = document.createElement("script");
  s.src = "${BACKEND_URL}/embed.js";
  s.defer = true;
  document.body.appendChild(s);
}, []);`}</CodeBlock>
              </details>
              <p className="text-[12.5px] text-muted">
                Going live? Set <code className="font-mono">VITE_BACKEND_URL</code> in the frontend and <code className="font-mono">WIDGET_URL</code> in the backend to your real domains so this snippet points to them.
              </p>
            </div>
          </Section>
        </div>

        <div className="lg:sticky lg:top-8 lg:self-start">
          <p className="mb-2 text-[13px] font-medium text-ink-2">Preview</p>
          <div className="h-[540px] overflow-hidden rounded-xl border border-line shadow-lg">
            <WidgetChat
              preview={{
                botName: draft.botName || 'Assistant',
                welcomeMessage: draft.welcomeMessage,
                quickReplies: draft.quickReplies.filter(Boolean),
                brandColor: colorOk ? draft.brandColor : '#2747d6',
              }}
            />
          </div>
          <div className={cn('mt-3 flex', draft.widgetPosition === 'left' ? 'justify-start' : 'justify-end')}>
            <div className="grid size-12 place-items-center rounded-full text-white shadow-md" style={{ background: colorOk ? draft.brandColor : '#2747d6' }} aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
