import { useState, useEffect } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  X,
  Phone,
  Key,
  Globe,
  Send,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Eye,
  EyeOff,
  Rocket,
  Radio,
  FileCode,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Spinner } from '@/components/ui/bits'
import { api } from '@/lib/api'
import { toast } from 'sonner'

export type DeployBotModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  flowId: string
  flowName: string
  initialPhoneId?: string
  initialApiKey?: string
  initialBaseUrl?: string
  webhookNodeId?: string
  onDeploy: (creds: { phoneId: string; apiKey: string; baseUrl: string }) => Promise<void>
  isDeploying?: boolean
  isActive?: boolean
}

export function DeployBotModal({
  open,
  onOpenChange,
  flowId,
  flowName,
  initialPhoneId = '',
  initialApiKey = '',
  initialBaseUrl = 'https://partnersv1.pinbot.ai/v3',
  webhookNodeId,
  onDeploy,
  isDeploying = false,
  isActive = false,
}: DeployBotModalProps) {
  const [phoneId, setPhoneId] = useState(initialPhoneId)
  const [apiKey, setApiKey] = useState(initialApiKey)
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl)
  const [showKey, setShowKey] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)

  // Public webhook url query
  const [publicHost, setPublicHost] = useState('')

  // Test state
  const [testTo, setTestTo] = useState('918076271987')
  const [testMode, setTestMode] = useState<'text' | 'template'>('text')
  const [testText, setTestText] = useState('Hello! Antigravity chatbot deployed to Cloud Gateway WhatsApp successfully.')
  const [testTemplateJson, setTestTemplateJson] = useState(
    JSON.stringify(
      {
        name: 'test_image',
        language: { code: 'en' },
        components: [
          {
            type: 'header',
            parameters: [
              {
                type: 'image',
                image: {
                  link: 'https://cdn-imagine.vyro.ai/imagine-frontend/assets/images/ai-image-generator-hero-image.png',
                },
              },
            ],
          },
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Pritam' },
              { type: 'text', text: 'DL05J2210' },
            ],
          },
        ],
      },
      null,
      2
    )
  )
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  // Reset fields when opening
  useEffect(() => {
    if (open) {
      setPhoneId(initialPhoneId)
      setApiKey(initialApiKey)
      setBaseUrl(initialBaseUrl || 'https://partnersv1.pinbot.ai/v3')
      setTestResult(null)

      // Query ngrok public URL
      api
        .get<{ ok: boolean; active: boolean; publicUrl: string | null }>('/api/admin/flows/ngrok-tunnel/status')
        .then((res) => {
          if (res.active && res.publicUrl) {
            setPublicHost(res.publicUrl)
          } else {
            setPublicHost(window.location.origin)
          }
        })
        .catch(() => {
          setPublicHost(window.location.origin)
        })
    }
  }, [open, initialPhoneId, initialApiKey, initialBaseUrl])

  const webhookPath = webhookNodeId ? `/hooks/flow/${flowId}/${webhookNodeId}` : `/hooks/flow/${flowId}`
  const fullWebhookUrl = `${publicHost || 'https://kilowatt-engaging-crucial.ngrok-free.dev'}${webhookPath}`

  const handleCopy = () => {
    navigator.clipboard.writeText(fullWebhookUrl)
    setCopiedUrl(true)
    toast.success('Webhook URL copied!')
    setTimeout(() => setCopiedUrl(false), 2000)
  }

  const handleSendTest = async () => {
    if (!testTo.trim()) {
      toast.error('Recipient phone number is required')
      return
    }
    if (!phoneId.trim()) {
      toast.error('Phone Number ID (phone_id) is required')
      return
    }
    if (!apiKey.trim()) {
      toast.error('Panel API Key (apikey) is required')
      return
    }

    setIsTesting(true)
    setTestResult(null)

    try {
      let templatePayload: any = undefined
      if (testMode === 'template') {
        try {
          templatePayload = JSON.parse(testTemplateJson)
        } catch {
          toast.error('Template JSON is invalid. Please fix syntax.')
          setIsTesting(false)
          return
        }
      }

      const res = await api.post<{ ok: boolean; error?: string; status?: number; data?: any }>(
        '/api/admin/flows/test-whatsapp-dispatch',
        {
          provider: 'cloudgateway',
          phoneId: phoneId.trim(),
          apiKey: apiKey.trim(),
          apiUrl: baseUrl.trim(),
          to: testTo.trim(),
          text: testMode === 'text' ? testText.trim() : undefined,
          template: templatePayload,
        }
      )

      if (res.ok) {
        setTestResult({
          ok: true,
          message: `Live WhatsApp message dispatched to ${testTo} via Cloud Gateway PinBot API!`,
        })
        toast.success(`Message sent to WhatsApp!`)
      } else {
        setTestResult({
          ok: false,
          message: res.error || 'Failed to dispatch via Cloud Gateway. Please check your credentials.',
        })
        toast.error(res.error || 'Failed to send WhatsApp message')
      }
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: err.message || 'Network error reaching Cloud Gateway API',
      })
      toast.error(err.message || 'Error sending test message')
    } finally {
      setIsTesting(false)
    }
  }

  const handleDeploySubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!phoneId.trim()) {
      toast.error('Please enter the client Phone Number ID (phone_id)')
      return
    }
    if (!apiKey.trim()) {
      toast.error('Please enter the client Panel API Key (apikey)')
      return
    }

    await onDeploy({
      phoneId: phoneId.trim(),
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim() || 'https://partnersv1.pinbot.ai/v3',
    })
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[calc(100%-32px)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-line bg-panel p-6 shadow-2xl focus:outline-none">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-line pb-4">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-lg bg-live/15 text-live">
                <Rocket className="size-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <DialogPrimitive.Title className="text-lg font-semibold text-ink">
                    Deploy Chatbot to WhatsApp
                  </DialogPrimitive.Title>
                  {isActive ? <Badge tone="live">Live on WhatsApp</Badge> : <Badge>Draft</Badge>}
                </div>
                <DialogPrimitive.Description className="mt-0.5 text-xs text-muted">
                  Connect <strong>{flowName}</strong> to the client's WhatsApp Business number via Cloud Gateway.
                </DialogPrimitive.Description>
              </div>
            </div>
            <DialogPrimitive.Close className="rounded-md p-1.5 text-muted hover:bg-paper hover:text-ink">
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>

          <form onSubmit={handleDeploySubmit} className="mt-5 space-y-5">
            {/* Cloud Gateway Credentials Card */}
            <div className="rounded-lg border border-line bg-paper/60 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                  <Key className="size-3.5 text-signal" />
                  Client Cloud Gateway Panel Credentials
                </div>
                <span className="text-[11px] text-muted">Required for each client</span>
              </div>

              {/* Phone ID */}
              <div>
                <label className="block text-xs font-medium text-ink mb-1">
                  Phone Number ID (<code className="text-signal font-mono font-semibold">phone_id</code>)
                </label>
                <div className="relative">
                  <Phone className="absolute left-2.5 top-2.5 size-4 text-muted" />
                  <input
                    type="text"
                    value={phoneId}
                    onChange={(e) => setPhoneId(e.target.value)}
                    placeholder="e.g. 102938475610293"
                    required
                    className="w-full rounded-md border border-line bg-panel py-2 pl-9 pr-3 text-sm text-ink placeholder:text-muted/60 focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal"
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted">
                  The client's WhatsApp Phone Number ID displayed in their Cloud Gateway / PinBot panel.
                </p>
              </div>

              {/* API Key */}
              <div>
                <label className="block text-xs font-medium text-ink mb-1">
                  Panel API Key (<code className="text-signal font-mono font-semibold">apikey</code>)
                </label>
                <div className="relative">
                  <Key className="absolute left-2.5 top-2.5 size-4 text-muted" />
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Enter the client's panel API Key..."
                    required
                    className="w-full rounded-md border border-line bg-panel py-2 pl-9 pr-10 text-sm font-mono text-ink placeholder:text-muted/60 focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-2.5 top-2.5 text-muted hover:text-ink"
                    title={showKey ? 'Hide key' : 'Show key'}
                  >
                    {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-muted">
                  Dispatched in the header <code className="text-ink-2 font-mono">apikey: &lt;&lt;apikey_value&gt;&gt;</code> to Cloud Gateway.
                </p>
              </div>

              {/* Gateway Endpoint URL */}
              <div>
                <label className="block text-xs font-medium text-ink mb-1">
                  Endpoint URL (<code className="text-signal font-mono font-semibold">apiUrl</code>)
                </label>
                <div className="relative">
                  <Globe className="absolute left-2.5 top-2.5 size-4 text-muted" />
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://partnersv1.pinbot.ai/v3"
                    className="w-full rounded-md border border-line bg-panel py-2 pl-9 pr-3 text-xs font-mono text-ink placeholder:text-muted/60 focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal"
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted">
                  Cloud Gateway endpoint (e.g. <code className="text-ink-2 font-mono">https://partnersv1.pinbot.ai/v3</code> or full <code className="text-ink-2 font-mono">https://partnersv1.pinbot.ai/v3/&lt;&lt;phone_id&gt;&gt;/messages</code>).
                </p>
              </div>
            </div>

            {/* Predefined Webhook URL to copy */}
            <div className="rounded-lg border border-line bg-paper/60 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
                  <Radio className="size-3.5 text-live animate-pulse" /> Predefined Webhook URL for Client's Panel
                </span>
                <span className="text-[11px] text-live font-medium">Ready for Incoming Traffic</span>
              </div>
              <p className="text-xs text-muted">
                Copy this URL and paste it into the client's Cloud Gateway / WhatsApp Webhook configuration setting:
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={fullWebhookUrl}
                  className="w-full rounded-md border border-line bg-panel px-3 py-1.5 font-mono text-xs text-ink select-all focus:outline-none"
                />
                <Button type="button" size="sm" variant="secondary" onClick={handleCopy} className="shrink-0 gap-1.5">
                  {copiedUrl ? <Check className="size-3.5 text-live" /> : <Copy className="size-3.5" />}
                  {copiedUrl ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>

            {/* Test WhatsApp Message Box */}
            <div className="rounded-lg border border-line-strong/60 bg-paper/40 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink">
                  <Sparkles className="size-3.5 text-signal" /> Live Test Connection (Verify Before Deploying)
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setTestMode('text')}
                    className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                      testMode === 'text'
                        ? 'bg-signal text-white'
                        : 'bg-paper text-muted hover:text-ink'
                    }`}
                  >
                    Text Message
                  </button>
                  <button
                    type="button"
                    onClick={() => setTestMode('template')}
                    className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                      testMode === 'template'
                        ? 'bg-signal text-white'
                        : 'bg-paper text-muted hover:text-ink'
                    }`}
                  >
                    Template (test_image)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11.5px] font-medium text-muted mb-1">
                    Send Test To Phone (with country code):
                  </label>
                  <input
                    type="text"
                    value={testTo}
                    onChange={(e) => setTestTo(e.target.value)}
                    placeholder="918076271987"
                    className="w-full rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs text-ink font-mono focus:border-signal focus:outline-none"
                  />
                </div>

                {testMode === 'text' ? (
                  <div>
                    <label className="block text-[11.5px] font-medium text-muted mb-1">
                      Test Message Text:
                    </label>
                    <input
                      type="text"
                      value={testText}
                      onChange={(e) => setTestText(e.target.value)}
                      className="w-full rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs text-ink focus:border-signal focus:outline-none"
                    />
                  </div>
                ) : null}
              </div>

              {testMode === 'template' ? (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11.5px] font-medium text-muted flex items-center gap-1">
                      <FileCode className="size-3" /> Template Payload JSON:
                    </label>
                    <span className="text-[10.5px] text-muted">matches PinBot template schema</span>
                  </div>
                  <textarea
                    rows={6}
                    value={testTemplateJson}
                    onChange={(e) => setTestTemplateJson(e.target.value)}
                    className="w-full rounded-md border border-line bg-panel p-2 font-mono text-[11px] text-ink focus:border-signal focus:outline-none"
                  />
                </div>
              ) : null}

              <div className="flex items-center justify-between pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={handleSendTest}
                  disabled={isTesting || !phoneId || !apiKey}
                  className="gap-1.5 text-xs"
                >
                  {isTesting ? <Spinner className="size-3" /> : <Send className="size-3" />}
                  {isTesting ? 'Sending test...' : 'Send Live Test Message'}
                </Button>
                {testResult ? (
                  <span
                    className={`text-xs flex items-center gap-1 font-medium ${
                      testResult.ok ? 'text-live' : 'text-fault'
                    }`}
                  >
                    {testResult.ok ? (
                      <CheckCircle2 className="size-3.5" />
                    ) : (
                      <AlertCircle className="size-3.5" />
                    )}
                    {testResult.message}
                  </span>
                ) : null}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-line pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={isDeploying}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isDeploying || !phoneId.trim() || !apiKey.trim()}
                className="gap-2 bg-live hover:bg-live/90 text-white font-medium px-5"
              >
                {isDeploying ? <Spinner className="size-4" /> : <Rocket className="size-4" />}
                {isDeploying ? 'Deploying...' : isActive ? 'Update & Deploy WhatsApp' : 'Deploy & Activate Bot'}
              </Button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

