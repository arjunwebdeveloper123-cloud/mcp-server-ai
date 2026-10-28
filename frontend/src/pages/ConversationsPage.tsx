import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MessagesSquare } from 'lucide-react'
import { PageHeader } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Badge, Empty, ErrorNote, Section, Spinner } from '@/components/ui/bits'
import { api, type ConversationList } from '@/lib/api'
import { cn, timeAgo } from '@/lib/utils'
import { Transcript } from './OverviewPage'
import { ExportButton } from '@/components/ui/export'

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'widget', label: 'Website visitors' },
  { value: 'playground', label: 'Playground tests' },
  { value: 'webhook', label: 'From webhooks' },
  { value: 'human', label: 'Needs human' },
] as const

const CHANNEL_LABEL: Record<string, string> = { widget: 'Website', playground: 'Playground', webhook: 'Webhook' }

export function ConversationsPage() {
  const [channel, setChannel] = useState<(typeof FILTERS)[number]['value']>('all')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)

  const list = useQuery({
    queryKey: ['conversations', channel, page],
    queryFn: () =>
      api.get<ConversationList>(
        `/api/admin/stats/conversations?page=${page}${channel === 'human' ? '&needsHuman=1' : channel === 'all' ? '' : `&channel=${channel}`}`
      ),
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
  })

  return (
    <>
      <PageHeader
        title="Conversations"
        description="Every chat with the bot, newest first. Open one to read the whole conversation and see which tools ran."
        actions={
          <>
            <ExportButton kind="conversations" params={{ channel: channel === 'all' || channel === 'human' ? undefined : channel }} label="Export summary" />
            <ExportButton kind="messages" params={{ channel: channel === 'all' || channel === 'human' ? undefined : channel }} label="Export full chat history" />
          </>
        }
      />

      <Section
        title={list.data ? `${list.data.total} ${list.data.total === 1 ? 'conversation' : 'conversations'}` : 'Conversations'}
        actions={
          <div className="flex flex-wrap rounded-md border border-line-strong p-0.5 text-[13px]">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => {
                  setChannel(f.value)
                  setPage(1)
                }}
                className={cn('rounded px-2.5 py-1 font-medium', channel === f.value ? 'bg-ink text-white' : 'text-muted hover:text-ink')}
              >
                {f.label}
              </button>
            ))}
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
          <Empty
            icon={<MessagesSquare />}
            title={channel === 'widget' ? 'No website visitors yet' : 'No conversations here yet'}
            body={channel === 'widget' ? 'Add the widget to your site from the Website widget page — chats will appear here.' : 'Send a message from the Playground to start one.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead className="text-left text-[12.5px] text-muted">
                <tr className="border-b border-line">
                  <th className="px-5 py-2 font-medium">Started with</th>
                  <th className="px-3 py-2 font-medium">From</th>
                  <th className="px-3 py-2 font-medium">Messages</th>
                  <th className="px-3 py-2 font-medium">Outcome</th>
                  <th className="px-5 py-2 text-right font-medium">Last active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.data.items.map((c) => (
                  <tr key={c.sessionId} className="cursor-pointer hover:bg-paper/70" onClick={() => setOpen(c.sessionId)}>
                    <td className="max-w-[340px] px-5 py-3">
                      <p className="truncate font-medium">{c.firstMessage || '—'}</p>
                      <p className="truncate text-[12.5px] text-muted">{c.lastMessage}</p>
                    </td>
                    <td className="px-3 py-3">
                      <Badge>{CHANNEL_LABEL[c.channel] ?? c.channel}</Badge>
                    </td>
                    <td className="px-3 py-3 text-muted">
                      {c.messages}
                      {c.toolCalls ? `, ${c.toolCalls} tool ${c.toolCalls === 1 ? 'call' : 'calls'}` : ''}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.needsHuman ? <Badge tone="warn">Needs human</Badge> : null}
                        {c.leadSaved ? <Badge tone="live">Lead saved</Badge> : null}
                        {c.meetingBooked ? <Badge tone="signal">Meeting booked</Badge> : null}
                        {!c.leadSaved && !c.meetingBooked && !c.needsHuman ? c.hadError ? <Badge tone="fault">Had an error</Badge> : <span className="text-muted">Chat only</span> : null}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right text-muted">{timeAgo(c.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {list.data && list.data.pages > 1 ? (
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[13px] text-muted">
            <span>
              Page {list.data.page} of {list.data.pages}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Newer
              </Button>
              <Button variant="secondary" size="sm" disabled={page >= list.data.pages} onClick={() => setPage((p) => p + 1)}>
                Older
              </Button>
            </div>
          </div>
        ) : null}
      </Section>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        {open ? <Transcript sessionId={open} /> : null}
      </Dialog>
    </>
  )
}
