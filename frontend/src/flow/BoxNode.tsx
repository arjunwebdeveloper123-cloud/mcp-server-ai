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
  const d = data as BoxData
  const meta = BOXES[t]
  const tone = TONE[meta.tone]
  const Icon = meta.icon
  const outs = outputs(t, d)
  const multi = outs.length > 1 || (outs.length === 1 && outs[0].id !== null)

  return (
    <div
      className={cn(
        'w-60 overflow-hidden rounded-lg border bg-panel text-left shadow-sm transition-shadow',
        selected ? 'border-signal shadow-[0_0_0_3px_rgb(39_71_214/0.18)]' : 'border-line-strong'
      )}
    >
      <div className={cn('h-1', tone.strip)} />
      {t !== 'start' ? <Handle type="target" position={Position.Top} className={handleCls} /> : null}

      <div className="px-3 pt-2.5 pb-2">
        <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
          <Icon className={cn('size-3.5', tone.icon)} aria-hidden /> {meta.title}
        </p>
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
      ) : outs.length === 1 ? (
        <Handle type="source" position={Position.Bottom} className={handleCls} />
      ) : null}
    </div>
  )
})
