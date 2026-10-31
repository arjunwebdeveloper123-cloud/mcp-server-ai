import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { AlertTriangle, ArrowLeft, FlaskConical, Phone, Rocket, Save, UploadCloud, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Badge, ErrorNote, Spinner } from '@/components/ui/bits'
import { api, type FlowCheck, type FlowDoc } from '@/lib/api'
import { cn } from '@/lib/utils'
import { BOXES, outputs, uid, type BoxData, type BoxType } from '@/flow/boxes'
import { BoxNode } from '@/flow/BoxNode'
import { Inspector } from '@/flow/Inspector'
import { TestPanel } from '@/flow/TestPanel'
import { DeployBotModal } from '@/flow/DeployBotModal'

// Har box type ke liye ek hi component (BoxNode) — module level par, warna React Flow har render par warning deta hai
const nodeTypes = Object.fromEntries(Object.keys(BOXES).map((k) => [k, BoxNode]))

export function FlowEditorPage() {
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  )
}

function Editor() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const rf = useReactFlow()
  const flow = useQuery({ queryKey: ['flow', id], queryFn: () => api.get<FlowDoc>(`/api/admin/flows/${id}`) })

  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<Edge>([])
  const [name, setName] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panel, setPanel] = useState<'inspect' | 'test' | null>(null)
  const [check, setCheck] = useState<FlowCheck | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [deployOpen, setDeployOpen] = useState(false)
  const [isDeploying, setIsDeploying] = useState(false)

  const webhookNode = useMemo(() => nodes.find((n) => n.type === 'webhook'), [nodes])
  const currentPhoneId = (webhookNode?.data as any)?.whatsappPhoneId || flow.data?.whatsappPhoneId || ''
  const currentApiKey = (webhookNode?.data as any)?.whatsappApiKey || flow.data?.whatsappApiKey || ''
  const currentBaseUrl = (webhookNode?.data as any)?.whatsappBaseUrl || flow.data?.whatsappBaseUrl || 'https://partnersv1.pinbot.ai/v3'

  /* Flow load → canvas */
  useEffect(() => {
    if (!flow.data || loaded) return
    setNodes(flow.data.nodes.map((n) => ({ ...n, deletable: n.type !== 'start' }) as Node))
    setEdges(flow.data.edges.map((e) => ({ ...e, sourceHandle: e.sourceHandle ?? null }) as Edge))
    setName(flow.data.name)
    setLoaded(true)
    setTimeout(() => rf.fitView({ padding: 0.15, maxZoom: 1 }), 50)
  }, [flow.data, loaded, rf, setEdges, setNodes])

  /* Unsaved changes ke saath tab band karne par browser warning */
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      if (changes.some((c) => c.type !== 'select' && c.type !== 'dimensions')) setDirty(true)
      if (changes.some((c) => c.type === 'remove' && c.id === selectedId)) {
        setSelectedId(null)
        setPanel((p) => (p === 'inspect' ? null : p))
      }
      onNodesChangeBase(changes)
    },
    [onNodesChangeBase, selectedId]
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      if (changes.some((c) => c.type !== 'select')) setDirty(true)
      onEdgesChangeBase(changes)
    },
    [onEdgesChangeBase]
  )

  /* Arrow jodna — ek port (handle) se ek hi arrow; naya purane ko badal deta hai */
  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source === c.target) return
      setEdges((eds) =>
        addEdge({ ...c, id: uid('e') }, eds.filter((e) => !(e.source === c.source && (e.sourceHandle ?? null) === (c.sourceHandle ?? null))))
      )
      setDirty(true)
    },
    [setEdges]
  )

  /* Arrows par label: button ka naam / Yes-No / Success-Error */
  const displayEdges = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    return edges.map((e) => {
      const src = byId.get(e.source)
      const label = src && e.sourceHandle ? outputs(src.type as BoxType, src.data as BoxData).find((o) => o.id === e.sourceHandle)?.label : undefined
      return {
        ...e,
        type: 'smoothstep',
        label,
        labelStyle: { fontSize: 11, fill: '#5b6676' },
        labelBgStyle: { fill: '#f3f5f8' },
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: e.selected ? '#2747d6' : '#8a94a3' },
        style: { stroke: e.selected ? '#2747d6' : '#8a94a3', strokeWidth: e.selected ? 2 : 1.5 },
      }
    })
  }, [edges, nodes])

  /* Palette se box canvas par kheencho */
  const addBox = useCallback(
    (type: BoxType, at?: { x: number; y: number }) => {
      const pos = at ?? rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      const nid = uid(type)
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id: nid, type, position: { x: pos.x - 120, y: pos.y - 30 }, data: BOXES[type].defaults(), selected: true }])
      setSelectedId(nid)
      setPanel('inspect')
      setDirty(true)
    },
    [rf, setNodes]
  )
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const type = e.dataTransfer.getData('application/x-box') as BoxType
    if (!type || !BOXES[type]) return
    addBox(type, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
  }

  const updateData = (nid: string, patch: Partial<BoxData>) => {
    setNodes((ns) => ns.map((n) => (n.id === nid ? { ...n, data: { ...n.data, ...patch } } : n)))
    setDirty(true)
  }
  const deleteBox = (nid: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== nid))
    setEdges((es) => es.filter((e) => e.source !== nid && e.target !== nid))
    setSelectedId(null)
    setPanel(null)
    setDirty(true)
  }

  /* Variables jo flow me bante hain — inspector hints ke liye */
  const variables = useMemo(() => {
    const v = new Set<string>()
    for (const n of nodes) {
      const d = (n.data || {}) as BoxData
      if ((n.type === 'question' || n.type === 'buttons') && d.variable) v.add(d.variable)
      if (n.type === 'tool') v.add(d.resultVar || 'toolResult')
      if (n.type === 'api') {
        v.add(d.resultVar || 'apiResponse')
        v.add(d.statusVar || 'apiStatus')
      }
      if (n.type === 'webhook') {
        v.add(d.resultVar || 'webhookPayload')
      }
      if (n.type === 'json') {
        v.add(d.resultVar || 'jsonData')
        if (Array.isArray(d.mappings)) {
          for (const m of d.mappings) {
            if (m?.varName) v.add(m.varName)
          }
        }
      }
    }
    return [...v]
  }, [nodes])

  /* Save / Publish */
  const payload = () => ({
    name,
    nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
    edges: edges.map(({ id, source, target, sourceHandle }) => ({ id, source, target, sourceHandle: sourceHandle ?? null })),
  })
  const save = useMutation({
    mutationFn: () => api.put<FlowCheck & { ok: boolean }>(`/api/admin/flows/${id}`, payload()),
    onSuccess: (r) => {
      setDirty(false)
      setCheck(r.errors.length || r.warnings.length ? r : null)
      qc.invalidateQueries({ queryKey: ['flows'] })
    },
    onError: (e) => toast.error(e.message),
  })
  const handleDeploy = async (creds: { phoneId: string; apiKey: string; baseUrl: string }) => {
    setIsDeploying(true)
    try {
      if (webhookNode) {
        updateData(webhookNode.id, {
          whatsappPhoneId: creds.phoneId,
          whatsappApiKey: creds.apiKey,
          whatsappBaseUrl: creds.baseUrl,
        })
      }

      const updatedNodes = nodes.map((n) => {
        if (n.type === 'webhook') {
          return {
            ...n,
            data: {
              ...(n.data || {}),
              whatsappPhoneId: creds.phoneId,
              whatsappApiKey: creds.apiKey,
              whatsappBaseUrl: creds.baseUrl,
            },
          }
        }
        return n
      })

      const saveRes = await api.put<FlowCheck & { ok: boolean }>(`/api/admin/flows/${id}`, {
        name,
        nodes: updatedNodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
        edges: edges.map(({ id, source, target, sourceHandle }) => ({ id, source, target, sourceHandle: sourceHandle ?? null })),
        whatsappPhoneId: creds.phoneId,
        whatsappApiKey: creds.apiKey,
        whatsappBaseUrl: creds.baseUrl,
      })

      setDirty(false)
      if (saveRes.errors.length) {
        setCheck(saveRes)
        toast.error('Fix flow errors before deploying.')
        return
      }

      await api.post(`/api/admin/flows/${id}/publish`, {
        whatsappPhoneId: creds.phoneId,
        whatsappApiKey: creds.apiKey,
        whatsappBaseUrl: creds.baseUrl,
      })

      toast.success('Bot successfully deployed! WhatsApp incoming messages will now trigger this flow.')
      setDeployOpen(false)
      qc.invalidateQueries({ queryKey: ['flow', id] })
      qc.invalidateQueries({ queryKey: ['flows'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    } catch (err: any) {
      toast.error(err.message || 'Failed to deploy bot')
    } finally {
      setIsDeploying(false)
    }
  }
  const unpublish = useMutation({
    mutationFn: () => api.post('/api/admin/flows/unpublish'),
    onSuccess: () => {
      toast.success('Unpublished — the bot answers with AI only')
      qc.invalidateQueries({ queryKey: ['flow', id] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })

  /* Ctrl / Cmd + S */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (!save.isPending) save.mutate(undefined, { onSuccess: () => toast.success('Saved') })
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [save])

  const selected = nodes.find((n) => n.id === selectedId)
  const isActive = Boolean(flow.data?.active)

  if (flow.isLoading)
    return (
      <div className="grid h-screen place-items-center text-muted">
        <Spinner />
      </div>
    )
  if (flow.isError)
    return (
      <div className="mx-auto max-w-md p-8">
        <ErrorNote error={flow.error} />
        <Button variant="secondary" className="mt-4" asChild>
          <Link to="/flows">Back to flows</Link>
        </Button>
      </div>
    )

  return (
    <div className="flex h-screen flex-col bg-paper">
      {/* ── Top bar ── */}
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <Button variant="ghost" size="sm" onClick={() => (dirty ? setLeaving(true) : navigate('/flows'))}>
          <ArrowLeft /> Flows
        </Button>
        <label htmlFor="flow-name" className="sr-only">
          Flow name
        </label>
        <input
          id="flow-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setDirty(true)
          }}
          className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-[15px] font-semibold hover:border-line focus:border-line-strong focus-visible:outline-signal sm:max-w-sm"
        />
        {isActive ? <Badge tone="live">Published</Badge> : <Badge>Draft</Badge>}
        <span className="text-[12.5px] text-muted">{dirty ? 'Unsaved changes' : save.isSuccess ? 'Saved' : ''}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              if (dirty) await save.mutateAsync()
              setPanel('test')
            }}
          >
            <FlaskConical /> Test
          </Button>
          <Button variant="secondary" size="sm" onClick={() => save.mutate(undefined, { onSuccess: () => toast.success('Saved') })} disabled={save.isPending}>
            {save.isPending ? <Spinner className="size-3.5" /> : <Save />} Save
          </Button>
          {isActive ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                className="gap-1.5"
                onClick={() => setDeployOpen(true)}
              >
                <Phone className="size-3.5 text-live" /> WhatsApp Settings
              </Button>
              {dirty ? (
                <Button size="sm" onClick={() => setDeployOpen(true)}>
                  <UploadCloud /> Publish changes
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" onClick={() => unpublish.mutate()} disabled={unpublish.isPending}>
                Unpublish
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              className="gap-1.5 bg-live hover:bg-live/90 text-white font-medium shadow-sm"
              onClick={() => setDeployOpen(true)}
            >
              <Rocket className="size-3.5" /> Deploy Bot
            </Button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── Palette ── */}
        <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-line bg-panel p-3 md:block" aria-label="Boxes">
          <p className="px-1 pb-2 text-[12.5px] text-muted">Drag a box onto the canvas, then connect the dots.</p>
          <ul className="grid gap-1.5">
            {(Object.keys(BOXES) as BoxType[])
              .filter((t) => BOXES[t].inPalette)
              .map((t) => {
                const m = BOXES[t]
                const Icon = m.icon
                return (
                  <li key={t}>
                    <button
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-box', t)
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      onClick={() => addBox(t)}
                      className="flex w-full cursor-grab items-start gap-2.5 rounded-md border border-line px-2.5 py-2 text-left hover:border-signal active:cursor-grabbing"
                    >
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                      <span>
                        <span className="block text-[13px] font-medium">{m.title}</span>
                        <span className="block text-[11.5px] leading-snug text-muted">{m.description}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
          </ul>
        </aside>

        {/* ── Canvas ── */}
        <main className="relative min-w-0 flex-1" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          <ReactFlow
            nodes={nodes}
            edges={displayEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeClick={(_e, n) => {
              setSelectedId(n.id)
              setPanel('inspect')
            }}
            onPaneClick={() => {
              setSelectedId(null)
              setPanel((p) => (p === 'inspect' ? null : p))
            }}
            deleteKeyCode={['Backspace', 'Delete']}
            minZoom={0.2}
            maxZoom={1.5}
            defaultEdgeOptions={{ type: 'smoothstep' }}
          >
            <Background gap={20} color="#d5dbe4" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor="#c4ccd8" maskColor="rgb(243 245 248 / 0.7)" className="!hidden lg:!block" />
          </ReactFlow>

          {check && (check.errors.length || check.warnings.length) ? (
            <div className="absolute bottom-4 left-4 z-10 max-h-56 w-[min(420px,calc(100%-2rem))] overflow-y-auto rounded-lg border border-line bg-panel p-3 shadow-lg">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                  <AlertTriangle className={cn('size-4', check.errors.length ? 'text-fault' : 'text-warn')} aria-hidden />
                  {check.errors.length ? `${check.errors.length} to fix before publishing` : `${check.warnings.length} to look at`}
                </p>
                <button onClick={() => setCheck(null)} className="rounded p-1 text-muted hover:bg-paper" aria-label="Dismiss">
                  <X className="size-3.5" />
                </button>
              </div>
              <ul className="grid gap-1 text-[12.5px]">
                {check.errors.map((m) => (
                  <li key={m} className="text-fault">
                    {m}
                  </li>
                ))}
                {check.warnings.map((m) => (
                  <li key={m} className="text-warn">
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </main>

        {/* ── Right panel ── */}
        {panel === 'inspect' && selected ? (
          <div className="w-80 sm:w-96 shrink-0">
            <Inspector
              key={selected.id}
              flowId={id}
              node={{ id: selected.id, type: selected.type as BoxType, data: selected.data as BoxData }}
              variables={variables}
              onChange={(p) => updateData(selected.id, p)}
              onDelete={() => deleteBox(selected.id)}
              onClose={() => {
                setPanel(null)
                setSelectedId(null)
              }}
              onOptionRemoved={(optId) => setEdges((es) => es.filter((e) => !(e.source === selected.id && e.sourceHandle === optId)))}
              onOpenDeploy={() => setDeployOpen(true)}
            />
          </div>
        ) : panel === 'test' ? (
          <div className="w-80 sm:w-96 shrink-0">
            <TestPanel flowId={id} onClose={() => setPanel(null)} />
          </div>
        ) : null}
      </div>

      <DeployBotModal
        open={deployOpen}
        onOpenChange={setDeployOpen}
        flowId={id}
        flowName={name}
        initialPhoneId={currentPhoneId}
        initialApiKey={currentApiKey}
        initialBaseUrl={currentBaseUrl}
        webhookNodeId={webhookNode?.id}
        onDeploy={handleDeploy}
        isDeploying={isDeploying}
        isActive={isActive}
      />

      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title="Leave without saving?"
        body="Your changes to this flow will be lost."
        confirmLabel="Leave"
        onConfirm={() => {
          setDirty(false)
          navigate('/flows')
        }}
      />
    </div>
  )
}
