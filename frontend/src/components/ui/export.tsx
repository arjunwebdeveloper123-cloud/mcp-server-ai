import { Download } from 'lucide-react'
import { cn } from '@/lib/utils'

/** CSV download — browser seedha file save karta hai (login cookie saath jaati hai) */
export function ExportButton({ kind, params, label = 'Export CSV', className }: { kind: string; params?: Record<string, string | undefined>; label?: string; className?: string }) {
  const qs = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v) as [string, string][]).toString()
  return (
    <a
      href={`/api/admin/data/export/${kind}.csv${qs ? `?${qs}` : ''}`}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-panel px-2.5 text-[13px] font-medium text-ink hover:bg-paper [&_svg]:size-4',
        className
      )}
    >
      <Download aria-hidden /> {label}
    </a>
  )
}

/** Search box + page buttons — Leads / Appointments / Conversations me common */
export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[13px] text-muted">
      <span>
        Page {page} of {pages}
      </span>
      <div className="flex gap-2">
        <button className="h-8 rounded-md border border-line-strong px-2.5 font-medium text-ink disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button className="h-8 rounded-md border border-line-strong px-2.5 font-medium text-ink disabled:opacity-40" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap rounded-md border border-line-strong p-0.5 text-[13px]">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} className={cn('rounded px-2.5 py-1 font-medium', value === o.value ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
