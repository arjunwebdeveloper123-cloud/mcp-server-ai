import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/AppLayout'
import { Input, Select } from '@/components/ui/input'
import { Empty, ErrorNote, Section, Spinner } from '@/components/ui/bits'
import { ExportButton, Pager, Segmented } from '@/components/ui/export'
import { api, type Lead, type LeadList } from '@/lib/api'
import { timeAgo } from '@/lib/utils'

// backend/src/company.ts ki service ids → dashboard me dikhne wale naam
const SERVICE: Record<string, string> = {
  whatsapp_marketing: 'Bulk WhatsApp',
  whatsapp_api: 'WhatsApp API',
  bulk_sms: 'Bulk SMS',
  sms_api: 'SMS API',
  voice_call: 'Voice Call',
  email: 'Bulk Email',
  rcs: 'RCS',
  smpp: 'SMPP',
}
type StatusFilter = 'all' | Lead['status']

export function LeadsPage() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)

  // Type karte waqt har letter par request na jaaye
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const params = { q: q || undefined, status: status === 'all' ? undefined : status }
  const list = useQuery({
    queryKey: ['leads', params, page],
    queryFn: () => api.get<LeadList>(`/api/admin/data/leads?${new URLSearchParams({ ...(params.q ? { q: params.q } : {}), ...(params.status ? { status: params.status } : {}), page: String(page) })}`),
    placeholderData: (p) => p,
    refetchInterval: 20_000,
  })

  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Lead['status'] }) => api.patch(`/api/admin/data/leads/${id}`, { status }),
    onSuccess: (_d, v) => {
      toast.success(`Marked as ${v.status}`)
      qc.invalidateQueries({ queryKey: ['leads'] })
    },
    onError: (e) => toast.error(e.message),
  })

  const counts = list.data?.counts ?? {}
  const all = Object.values(counts).reduce((n, c) => n + c, 0)

  return (
    <>
      <PageHeader
        title="Leads"
        description="Every enquiry the bot saved. Update the status as your team follows up."
        actions={<ExportButton kind="leads" params={params} />}
      />
      <Section
        title={`${list.data?.total ?? 0} ${list.data?.total === 1 ? 'lead' : 'leads'}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" aria-hidden />
              <label htmlFor="lead-search" className="sr-only">
                Search leads
              </label>
              <Input id="lead-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone, service" className="h-8 w-56 pl-8" />
            </div>
            <Segmented
              value={status}
              onChange={(v) => {
                setStatus(v)
                setPage(1)
              }}
              options={[
                { value: 'all', label: `All ${all}` },
                { value: 'new', label: `New ${counts.new ?? 0}` },
                { value: 'contacted', label: `Contacted ${counts.contacted ?? 0}` },
                { value: 'converted', label: `Converted ${counts.converted ?? 0}` },
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
          <Empty icon={<UserRound />} title={q || status !== 'all' ? 'No leads match' : 'No leads yet'} body={q || status !== 'all' ? 'Try a different search or filter.' : 'Leads appear here as soon as the bot saves one.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead className="text-left text-[12.5px] text-muted">
                <tr className="border-b border-line">
                  <th className="px-5 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Phone</th>
                  <th className="px-3 py-2 font-medium">Service</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-5 py-2 text-right font-medium">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.data.items.map((l) => (
                  <tr key={l._id}>
                    <td className="px-5 py-2.5">
                      <p className="font-medium">{l.name}</p>
                      {l.company || l.volume ? (
                        <p className="text-[12.5px] text-muted">{[l.company, l.volume && `${l.volume} / month`].filter(Boolean).join(' · ')}</p>
                      ) : null}
                      {l.message ? <p className="max-w-xs truncate text-[12.5px] text-muted">{l.message}</p> : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <a href={`tel:${l.phone}`} className="font-mono text-[12.5px] hover:text-signal">
                        {l.phone}
                      </a>
                    </td>
                    <td className="px-3 py-2.5">{SERVICE[l.service] ?? l.service}</td>
                    <td className="px-3 py-2.5">
                      <label className="sr-only" htmlFor={`st-${l._id}`}>
                        Status for {l.name}
                      </label>
                      <Select
                        id={`st-${l._id}`}
                        value={l.status ?? 'new'}
                        onChange={(e) => update.mutate({ id: l._id, status: e.target.value as Lead['status'] })}
                        className="h-8 w-32 text-[13px]"
                      >
                        <option value="new">New</option>
                        <option value="contacted">Contacted</option>
                        <option value="converted">Converted</option>
                      </Select>
                    </td>
                    <td className="px-5 py-2.5 text-right text-muted" title={new Date(l.createdAt).toLocaleString('en-IN')}>
                      {timeAgo(l.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data ? <Pager page={list.data.page} pages={list.data.pages} onPage={setPage} /> : null}
      </Section>
    </>
  )
}
