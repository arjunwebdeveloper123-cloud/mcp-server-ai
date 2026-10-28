import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Plus, Trash2, Workflow } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Badge, Empty, ErrorNote, Section, Spinner } from '@/components/ui/bits'
import { api, type FlowListItem } from '@/lib/api'
import { timeAgo } from '@/lib/utils'

export function FlowsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const flows = useQuery({ queryKey: ['flows'], queryFn: () => api.get<FlowListItem[]>('/api/admin/flows') })
  const [deleting, setDeleting] = useState<FlowListItem | null>(null)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['flows'] })
    qc.invalidateQueries({ queryKey: ['stats'] })
  }

  const create = useMutation({
    mutationFn: (template: boolean) => api.post<{ _id: string }>('/api/admin/flows', { name: template ? 'Lead + meeting flow' : 'New flow', template }),
    onSuccess: (r) => navigate(`/flows/${r._id}`),
    onError: (e) => toast.error(e.message),
  })
  const duplicate = useMutation({
    mutationFn: (id: string) => api.post(`/api/admin/flows/${id}/duplicate`),
    onSuccess: () => {
      toast.success('Copy created')
      refresh()
    },
  })
  const unpublish = useMutation({
    mutationFn: () => api.post('/api/admin/flows/unpublish'),
    onSuccess: () => {
      toast.success('Flow unpublished — the bot now answers with AI only')
      refresh()
    },
  })
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/flows/${id}`),
    onSuccess: () => {
      toast.success('Flow deleted')
      setDeleting(null)
      refresh()
    },
  })

  const active = flows.data?.find((f) => f.active)

  return (
    <>
      <PageHeader
        title="Flow builder"
        description="Design the conversation with boxes and arrows. When a flow is published, the bot follows it; AI boxes inside it still answer free questions."
        actions={
          <>
            <Button variant="secondary" onClick={() => create.mutate(true)} disabled={create.isPending}>
              Start from template
            </Button>
            <Button onClick={() => create.mutate(false)} disabled={create.isPending}>
              <Plus /> New flow
            </Button>
          </>
        }
      />

      <div className={`mb-6 rounded-lg border px-5 py-3.5 text-[13px] ${active ? 'border-live/25 bg-live-soft text-live' : 'border-line bg-panel text-muted'}`}>
        {active ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              The bot follows <span className="font-semibold">{active.name}</span>.
            </span>
            <button className="font-medium underline" onClick={() => unpublish.mutate()}>
              Unpublish
            </button>
          </span>
        ) : (
          'No flow is published — the bot answers with the AI provider and instructions from Bot settings.'
        )}
      </div>

      <Section title="Flows">
        {flows.isLoading ? (
          <div className="p-5">
            <Spinner />
          </div>
        ) : flows.isError ? (
          <div className="p-5">
            <ErrorNote error={flows.error} />
          </div>
        ) : !flows.data?.length ? (
          <Empty
            icon={<Workflow />}
            title="No flows yet"
            body="Start from the template to see a complete lead + meeting flow you can edit, or begin with an empty canvas."
            action={
              <Button onClick={() => create.mutate(true)} disabled={create.isPending}>
                Start from template
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {flows.data.map((f) => (
              <li key={f._id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                <Workflow className="size-4 text-faint" aria-hidden />
                <Link to={`/flows/${f._id}`} className="min-w-0 flex-1">
                  <p className="font-medium hover:text-signal">{f.name}</p>
                  <p className="text-[12.5px] text-muted">
                    {f.boxes} boxes · edited {timeAgo(f.updatedAt)}
                  </p>
                </Link>
                {f.active ? <Badge tone="live">Published</Badge> : <Badge>Draft</Badge>}
                <Button variant="secondary" size="sm" asChild>
                  <Link to={`/flows/${f._id}`}>Open</Link>
                </Button>
                <Button variant="ghost" size="icon" onClick={() => duplicate.mutate(f._id)} aria-label={`Duplicate ${f.name}`}>
                  <Copy />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setDeleting(f)} aria-label={`Delete ${f.name}`}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'flow'}?`}
        body={deleting?.active ? 'This flow is published. Deleting it switches the bot back to AI-only replies.' : 'This can’t be undone.'}
        confirmLabel="Delete flow"
        pending={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting._id)}
      />
    </>
  )
}
