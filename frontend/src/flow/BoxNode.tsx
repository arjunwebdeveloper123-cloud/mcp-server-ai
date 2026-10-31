import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { cn } from '@/lib/utils'
import { BOXES, outputs, summary, type BoxData, type BoxType } from './boxes'

const TONE: Record<string, { strip: string; icon: string }> = {
  ink: { strip: 'bg-ink', icon: 'text-ink-2' },
  signal: { strip: 'bg-signal', icon: 'text-signal' },
  ai: { strip: 'bg-[#6d4bd8]', icon: 'text-[#6d4bd8]' },
  live: { strip: 'bg-live', icon: 'text-live' },
  warn: { strip: 'bg-warn', icon: 'text-warn' },
}

const handleCls = '!size-3 !border-2 !border-panel !bg-line-strong hover:!bg-signal'

/** Canvas par ek box. Upar: aane wala arrow. Neeche / side: jaane wale arrows. */
export const BoxNode = memo(function BoxNode({ type, data, selected }: NodeProps) {
  const t = type as BoxType
  const d = (data || {}) as BoxData
  const meta = BOXES[t] || {
    title: String(type || 'Node'),
    description: '',
    icon: BOXES.message.icon,
    tone: 'ink' as const,
    defaults: () => ({}),
    inPalette: false,
  }
  const tone = TONE[meta.tone] || TONE.ink
  const Icon = meta.icon || BOXES.message.icon
  const outs = outputs(t, d)
  const multi = outs.length > 1 || (outs.length === 1 && outs[0].id !== null)

  return (
    <div
      className={cn(
        'w-64 overflow-hidden rounded-lg border bg-panel text-left shadow-sm transition-shadow',
        selected ? 'border-signal shadow-[0_0_0_3px_rgb(39_71_214/0.18)]' : 'border-line-strong'
      )}
    >
      <div className={cn('h-1', tone.strip)} />
      {t !== 'start' ? <Handle type="target" position={Position.Top} className={handleCls} /> : null}

      <div className="px-3 pt-2.5 pb-2">
        <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
          <Icon className={cn('size-3.5', tone.icon)} aria-hidden />
          <span>{meta.title}</span>
          {t === 'ai' ? (
            <div className="ml-auto flex items-center gap-1">
              <span className={cn(
                'rounded px-1.5 py-0.5 text-[9.5px] font-semibold',
                d.responseSource === 'knowledge_mcp'
                  ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300'
                  : 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
              )}>
                {d.responseSource === 'knowledge_mcp' ? 'MD + MCP' : 'Prompt'}
              </span>
              {d.aiApiKey ? (
                d.aiVerified ? (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
                  </span>
                ) : (
                  <span className="rounded bg-signal-soft px-1.5 py-0.5 text-[10px] font-medium text-signal">
                    Key set
                  </span>
                )
              ) : (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                  ⚠️ Setup Key
                </span>
              )}
            </div>
          ) : null}
          {t === 'api' ? (
            <span
              className={cn(
                'ml-auto rounded px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase',
                d.method === 'POST'
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : d.method === 'PUT'
                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  : d.method === 'PATCH'
                  ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                  : d.method === 'DELETE'
                  ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                  : 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
              )}
            >
              {(d.method as string) || 'GET'}
            </span>
          ) : null}
          {t === 'webhook' ? (
            <div className="ml-auto flex items-center gap-1">
              {d.whatsappApiKey && d.whatsappPhoneId ? (
                <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                  <span className="size-1 rounded-full bg-emerald-500" /> WhatsApp
                </span>
              ) : null}
              <span className="rounded bg-purple-500/15 px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase text-purple-600 dark:text-purple-400">
                {d.webhookType === 'outgoing' ? 'POST OUT' : 'CRM IN'}
              </span>
            </div>
          ) : null}
          {t === 'json' ? (
            <span className="ml-auto rounded bg-signal/15 px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase text-signal">
              JSON
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-[13.5px] font-semibold text-ink">{d.label || meta.title}</p>
        {summary(t, d) ? <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-muted">{summary(t, d)}</p> : null}
      </div>

      {multi ? (
        <ul className="border-t border-line">
          {outs.map((o) => (
            <li key={o.id ?? 'next'} className="relative border-b border-line px-3 py-1.5 text-right text-[12px] last:border-b-0">
              <span className="text-ink-2">{o.label}</span>
              <Handle type="source" id={o.id ?? undefined} position={Position.Right} className={handleCls} style={{ top: '50%', right: -7 }} />
            </li>
          ))}
        </ul>
      ) : null}

      {/* Output wire: Bottom handle for single wire output */}
      {!multi && outs.length === 1 ? (
        <Handle type="source" position={Position.Bottom} className={handleCls} />
      ) : null}
    </div>
  )
})
