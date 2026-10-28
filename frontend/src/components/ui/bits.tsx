import * as React from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { cn, copyText } from '@/lib/utils'
import type { ServerStatus } from '@/lib/api'

/** Connection state — color sirf real state ke liye */
const STATUS: Record<ServerStatus | 'failing' | 'paused', { label: string; dot: string; text: string }> = {
  connected: { label: 'Connected', dot: 'bg-live dot-live', text: 'text-live' },
  connecting: { label: 'Connecting', dot: 'bg-warn', text: 'text-warn' },
  error: { label: 'Not connected', dot: 'bg-fault', text: 'text-fault' },
  failing: { label: 'Failing', dot: 'bg-fault', text: 'text-fault' },
  disabled: { label: 'Off', dot: 'bg-faint', text: 'text-muted' },
  paused: { label: 'Paused', dot: 'bg-faint', text: 'text-muted' },
}

export function StatusDot({ status, showLabel = true, className }: { status: keyof typeof STATUS; showLabel?: boolean; className?: string }) {
  const s = STATUS[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[13px] font-medium', s.text, className)}>
      <span className={cn('size-2 rounded-full', s.dot)} aria-hidden />
      {showLabel ? s.label : <span className="sr-only">{s.label}</span>}
    </span>
  )
}

export function Badge({ children, tone = 'neutral', className }: { children: React.ReactNode; tone?: 'neutral' | 'signal' | 'live' | 'fault' | 'warn'; className?: string }) {
  const tones = {
    neutral: 'bg-paper text-ink-2 border-line',
    signal: 'bg-signal-soft text-signal-ink border-signal/20',
    live: 'bg-live-soft text-live border-live/20',
    fault: 'bg-fault-soft text-fault border-fault/20',
    warn: 'bg-warn-soft text-warn border-warn/20',
  }
  return <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>
}

/** Monospace value + copy button (URLs, tokens, secrets) */
export function CopyField({ value, mask = false, className }: { value: string; mask?: boolean; className?: string }) {
  const [copied, setCopied] = React.useState(false)
  const [revealed, setRevealed] = React.useState(!mask)
  const shown = revealed ? value : value.slice(0, 10) + '•'.repeat(18)
  return (
    <div className={cn('flex min-w-0 items-center gap-1 rounded-md border border-line bg-paper pl-3', className)}>
      <code className="min-w-0 flex-1 truncate py-2 font-mono text-[12.5px] text-ink-2">{shown}</code>
      {mask ? (
        <button onClick={() => setRevealed((r) => !r)} className="px-2 text-xs font-medium text-muted hover:text-ink">
          {revealed ? 'Hide' : 'Reveal'}
        </button>
      ) : null}
      <button
        onClick={async () => {
          if (await copyText(value)) {
            setCopied(true)
            toast.success('Copied')
            setTimeout(() => setCopied(false), 1500)
          }
        }}
        className="border-l border-line p-2.5 text-muted hover:text-ink"
        aria-label="Copy"
      >
        {copied ? <Check className="size-3.5 text-live" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}

export function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <pre className={cn('overflow-x-auto rounded-md bg-ink px-4 py-3 [overflow-wrap:anywhere] font-mono text-[12.5px] leading-relaxed text-[#d7deea]', className)}>
      {children}
    </pre>
  )
}

/** Page section with a heading row (not a floating card) */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-lg border border-line bg-panel', className)}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      <div>{children}</div>
    </section>
  )
}

export function Empty({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-faint [&_svg]:size-7">{icon}</div> : null}
      <p className="font-semibold">{title}</p>
      <p className="mt-1 max-w-sm text-[13px] text-muted">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn('inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)} aria-label="Loading" />
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <div className="rounded-md border border-fault/25 bg-fault-soft px-4 py-3 text-[13px] text-fault">
      {error instanceof Error ? error.message : String(error)}
    </div>
  )
}
