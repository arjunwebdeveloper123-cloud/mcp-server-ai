import { NavLink, Outlet } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Activity, BookOpen, Cable, CalendarClock, LogOut, MessageSquareText, MessagesSquare, PanelsTopLeft, Settings2, UserRound, Webhook, Workflow, Menu, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import type { AuthStatus } from '@/lib/api'
import { useState } from 'react'
import { api, type Stats } from '@/lib/api'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/', label: 'Overview', icon: Activity, end: true },
  { to: '/conversations', label: 'Conversations', icon: MessagesSquare },
  { to: '/leads', label: 'Leads', icon: UserRound },
  { to: '/appointments', label: 'Appointments', icon: CalendarClock },
  { to: '/flows', label: 'Flow builder', icon: Workflow },
  { to: '/knowledge', label: 'Knowledge base', icon: BookOpen },
  { to: '/mcp', label: 'MCP servers', icon: Cable },
  { to: '/webhooks', label: 'Webhooks', icon: Webhook },
  { to: '/playground', label: 'Playground', icon: MessageSquareText },
  { to: '/widget', label: 'Website widget', icon: PanelsTopLeft },
  { to: '/settings', label: 'Bot settings', icon: Settings2 },
]

export function AppLayout() {
  const [open, setOpen] = useState(false)
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api.get<Stats>('/api/admin/stats'), refetchInterval: 15_000 })

  const nav = (
    <nav className="flex flex-col gap-0.5 px-3">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] font-medium transition-colors',
              isActive ? 'bg-white/10 text-white' : 'text-[#aab4c4] hover:bg-white/5 hover:text-white'
            )
          }
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  )

  const mcp = stats.data?.mcp
  const footer = (
    <div className="mt-auto border-t border-white/10 px-5 py-4 text-[12.5px] text-[#aab4c4]">
      {stats.isError ? (
        <p className="text-[#f2a19b]">Backend offline</p>
      ) : mcp ? (
        <p>
          <span className="text-white">{mcp.connected}</span> of {mcp.servers} servers live
          <br />
          <span className="text-white">{mcp.tools}</span> tools available to the bot
        </p>
      ) : (
        <p>Checking connections…</p>
      )}
      <UserRow />
    </div>
  )

  const brand = (
    <div className="flex items-center gap-2.5 px-5 py-5">
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <circle cx="5" cy="6" r="2.2" fill="#7f95ff" />
        <circle cx="5" cy="18" r="2.2" fill="#7f95ff" />
        <circle cx="19" cy="12" r="2.2" fill="#fff" />
        <path d="M7 6c6 0 6 6 10 6M7 18c6 0 6-6 10-6" stroke="#7f95ff" strokeWidth="1.6" fill="none" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight text-white">Switchboard</span>
    </div>
  )

  return (
    <div className="flex min-h-full">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-ink lg:flex">
        {brand}
        {nav}
        {footer}
      </aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between bg-ink px-2 lg:hidden">
        {brand}
        <button className="rounded-md p-2 text-white" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close menu' : 'Open menu'}>
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open ? (
        <div className="fixed inset-x-0 top-14 bottom-0 z-30 flex flex-col bg-ink pt-2 lg:hidden">
          {nav}
          {footer}
        </div>
      ) : null}

      <main className="min-w-0 flex-1 pt-14 lg:pt-0">
        {stats.data?.ai && !stats.data.ai.ready ? (
          <div className="border-b border-warn/25 bg-warn-soft px-6 py-2.5 text-[13px] text-warn">
            The bot can't reply yet: {stats.data.ai.detail}.{' '}
            <NavLink to="/settings" className="font-medium underline">
              Change AI provider
            </NavLink>
          </div>
        ) : stats.data?.ai?.active === 'demo' ? (
          <div className="border-b border-signal/20 bg-signal-soft px-6 py-2.5 text-[13px] text-signal-ink">
            Demo mode: the bot follows a fixed script and still uses your real MCP tools. Free, no API key needed.{' '}
            <NavLink to="/settings" className="font-medium underline">
              Switch to real AI
            </NavLink>
          </div>
        ) : null}
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

function UserRow() {
  const qc = useQueryClient()
  const auth = qc.getQueryData<AuthStatus>(['auth'])
  const user = auth?.user
  return (
    <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/10 pt-3">
      <span className="min-w-0 truncate text-[12.5px]" title={user?.email}>
        {user?.name || user?.email}
      </span>
      <button
        className="flex items-center gap-1 rounded px-1.5 py-1 text-[12.5px] text-[#aab4c4] hover:bg-white/5 hover:text-white"
        onClick={async () => {
          await api.post('/api/auth/logout')
          await qc.resetQueries()
        }}
      >
        <LogOut className="size-3.5" aria-hidden /> Log out
      </button>
    </div>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-[13.5px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
