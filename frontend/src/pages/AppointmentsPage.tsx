import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Search } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Badge, Empty, ErrorNote, Section, Spinner } from '@/components/ui/bits'
import { ExportButton, Pager, Segmented } from '@/components/ui/export'
import { api, type Appointment, type AppointmentList } from '@/lib/api'

type When = 'upcoming' | 'past' | 'all'

const dayLabel = (date: string) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
  const d = new Date(`${date}T00:00:00Z`)
  const tomorrow = new Date(`${today}T00:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const label = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d)
  if (date === today) return `Today · ${label}`
  if (date === tomorrow.toISOString().slice(0, 10)) return `Tomorrow · ${label}`
  return label
}
const time12 = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export function AppointmentsPage() {
  const qc = useQueryClient()
  const [when, setWhen] = useState<When>('upcoming')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [cancelling, setCancelling] = useState<Appointment | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const list = useQuery({
    queryKey: ['appointments', when, q, page],
    queryFn: () => api.get<AppointmentList>(`/api/admin/data/appointments?${new URLSearchParams({ when, page: String(page), ...(q ? { q } : {}) })}`),
    placeholderData: (p) => p,
    refetchInterval: 20_000,
  })

  const cancel = useMutation({
    mutationFn: (id: string) => api.patch(`/api/admin/data/appointments/${id}`, { status: 'cancelled' }),
    onSuccess: () => {
      toast.success('Meeting cancelled')
      setCancelling(null)
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <>
      <PageHeader
        title="Appointments"
        description="Meetings customers booked through the bot. Times are India time."
        actions={<ExportButton kind="appointments" params={{ when, q: q || undefined }} />}
      />
      <Section
        title={`${list.data?.total ?? 0} ${list.data?.total === 1 ? 'meeting' : 'meetings'}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" aria-hidden />
              <label htmlFor="appt-search" className="sr-only">
                Search meetings
              </label>
              <Input id="appt-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone, booking id" className="h-8 w-56 pl-8" />
            </div>
            <Segmented
              value={when}
              onChange={(v) => {
                setWhen(v)
                setPage(1)
              }}
              options={[
                { value: 'upcoming', label: 'Upcoming' },
                { value: 'past', label: 'Past' },
                { value: 'all', label: 'All' },
              ]}
            />
          </div>
        }
      >
        {list.isLoading ? (
          <div className="p-5">
            <Spinner />
          </div>
        ) : list.isError ? (
          <div className="p-5">
            <ErrorNote error={list.error} />
          </div>
        ) : !list.data?.items.length ? (
          <Empty icon={<CalendarClock />} title={when === 'upcoming' ? 'No upcoming meetings' : 'No meetings here'} body="Meetings appear here when customers book through the bot." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="text-left text-[12.5px] text-muted">
                <tr className="border-b border-line">
                  <th className="px-5 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Booking id</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.data.items.map((a) => (
                  <tr key={a._id} className={a.status === 'cancelled' ? 'text-muted' : undefined}>
                    <td className="px-5 py-2.5">
                      <p className="font-medium">{dayLabel(a.date)}</p>
                      <p className="text-[12.5px] text-muted">{time12(a.time)}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{a.name}</p>
                      <a href={`tel:${a.phone}`} className="font-mono text-[12.5px] text-muted hover:text-signal">
                        {a.phone}
                      </a>
                      {a.topic ? <p className="max-w-xs truncate text-[12.5px] text-muted">{a.topic}</p> : null}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[12.5px]">{a.bookingId}</td>
                    <td className="px-3 py-2.5">{a.status === 'booked' ? <Badge tone="live">Booked</Badge> : <Badge>Cancelled</Badge>}</td>
                    <td className="px-5 py-2.5 text-right">
                      {a.status === 'booked' ? (
                        <Button variant="danger" size="sm" onClick={() => setCancelling(a)}>
                          Cancel
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data ? <Pager page={list.data.page} pages={list.data.pages} onPage={setPage} /> : null}
      </Section>

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={`Cancel ${cancelling?.name ?? ''}’s meeting?`}
        body={cancelling ? `${dayLabel(cancelling.date)}, ${time12(cancelling.time)}. The slot opens up again. Tell the customer yourself — the bot doesn’t message them.` : ''}
        confirmLabel="Cancel meeting"
        pending={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate(cancelling._id)}
      />
    </>
  )
}
