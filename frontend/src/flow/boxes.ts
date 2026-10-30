import { Bot, Flag, GitBranch, Hand, ListChecks, MessageSquare, MessageCircleQuestion, Play, Plug, Webhook, type LucideIcon } from 'lucide-react'

/* Flow builder ke box types — palette, canvas aur inspector teeno yahi use karte hain */

export type BoxType = 'start' | 'message' | 'question' | 'buttons' | 'condition' | 'ai' | 'tool' | 'webhook' | 'handoff' | 'end'
export type ButtonOption = { id: string; label: string; value?: string }

export type AiProvider = 'gemini' | 'openai' | 'anthropic' | 'groq' | 'custom'

export type BoxData = Record<string, unknown> & {
  label?: string
  text?: string
  variable?: string
  validation?: string
  errorMessage?: string
  skipIfKnown?: boolean
  options?: ButtonOption[]
  operator?: string
  value?: string
  mode?: 'once' | 'chat'
  instruction?: string
  intro?: string
  exitKeywords?: string
  tool?: string
  args?: string
  resultVar?: string
  url?: string
  fallback?: 'repeat' | 'ai'
  // Real-time AI Node credentials & models
  aiProvider?: AiProvider
  aiApiKey?: string
  aiModel?: string
  aiBaseUrl?: string
  aiVerified?: boolean
  aiVerifiedAt?: string
}

export const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`

type Meta = {
  title: string
  description: string
  icon: LucideIcon
  /** canvas par box ka accent — category ke hisaab se */
  tone: 'ink' | 'signal' | 'ai' | 'live' | 'warn'
  defaults: () => BoxData
  inPalette: boolean
}

export type AiModelPreset = { id: string; label: string; badge?: string }

export type AiProviderInfo = {
  id: AiProvider
  name: string
  subtitle: string
  keyName: string
  keyPlaceholder: string
  keyDocUrl: string
  defaultModel: string
  defaultBaseUrl?: string
  models: AiModelPreset[]
}

export const AI_PROVIDERS: Record<AiProvider, AiProviderInfo> = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    subtitle: 'Free tier available, ultra-fast & intelligent',
    keyName: 'Gemini API Key',
    keyPlaceholder: 'AIzaSy...',
    keyDocUrl: 'https://aistudio.google.com/app/apikey',
    defaultModel: 'gemini-1.5-flash',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: [
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', badge: 'Recommended • Fast' },
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', badge: 'Complex Reasoning' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', badge: 'Next-Gen' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', badge: 'Latest' },
    ],
  },
  openai: {
    id: 'openai',
    name: 'OpenAI (ChatGPT)',
    subtitle: 'Industry-standard GPT-4o models',
    keyName: 'OpenAI API Key',
    keyPlaceholder: 'sk-proj-...',
    keyDocUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o-mini',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini', badge: 'Recommended • Fast' },
      { id: 'gpt-4o', label: 'GPT-4o Flagship', badge: 'Top Multimodal' },
      { id: 'gpt-4-turbo', label: 'GPT-4 Turbo', badge: 'High Capability' },
      { id: 'o3-mini', label: 'o3-mini', badge: 'Reasoning' },
    ],
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    subtitle: 'Exceptional reasoning and conversational quality',
    keyName: 'Anthropic API Key',
    keyPlaceholder: 'sk-ant-api03-...',
    keyDocUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-3-5-haiku-20241022',
    defaultBaseUrl: 'https://api.anthropic.com',
    models: [
      { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', badge: 'Recommended • Fast' },
      { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', badge: 'Best Intelligence' },
      { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus', badge: 'Deep Reasoning' },
    ],
  },
  groq: {
    id: 'groq',
    name: 'Groq (Ultra-Fast)',
    subtitle: 'Extremely fast inference on open-source Llama models',
    keyName: 'Groq API Key',
    keyPlaceholder: 'gsk_...',
    keyDocUrl: 'https://console.groq.com/keys',
    defaultModel: 'llama-3.3-70b-versatile',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', badge: 'Recommended' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant', badge: 'Superfast' },
      { id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B', badge: '32k Context' },
    ],
  },
  custom: {
    id: 'custom',
    name: 'Custom / Other',
    subtitle: 'OpenRouter, DeepSeek, Local Ollama, or OpenAI-compatible endpoint',
    keyName: 'API Key (if required)',
    keyPlaceholder: 'sk-or-... or leave blank for local',
    keyDocUrl: 'https://openrouter.ai/keys',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    models: [
      { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (OpenRouter Free)', badge: 'Free' },
      { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat', badge: 'OpenRouter' },
      { id: 'qwen2.5:7b', label: 'Qwen 2.5 7B (Ollama Local)', badge: 'Local' },
      { id: 'mistralai/mistral-large', label: 'Mistral Large', badge: 'Mistral' },
    ],
  },
}

export const PROMPT_TEMPLATES = [
  {
    title: 'Customer Support FAQ',
    text: 'Answer the customer politely and concisely using the uploaded company knowledge. If the answer is not found in the documents, guide them politely to speak with a human support agent.',
  },
  {
    title: 'Lead Qualifier & Sales',
    text: 'Help the customer understand our services. Ask clarifying questions to understand their specific needs, and encourage them to leave their name and phone number so our team can prepare a custom quote.',
  },
  {
    title: 'Appointment Assistant',
    text: 'Assist the customer in booking an appointment. Explain the available slots, verify their preferred date and time, and confirm all required booking details.',
  },
  {
    title: 'Short & Direct Answer',
    text: 'Provide a direct, one-sentence answer to the customer\'s specific question based on company guidelines.',
  },
]

export const BOXES: Record<BoxType, Meta> = {
  start: { title: 'Start', description: 'Where every conversation begins', icon: Play, tone: 'ink', inPalette: false, defaults: () => ({ label: 'Start' }) },
  message: {
    title: 'Message',
    description: 'Bot sends a fixed message',
    icon: MessageSquare,
    tone: 'signal',
    inPalette: true,
    defaults: () => ({ label: 'Message', text: 'Namaste! 👋' }),
  },
  question: {
    title: 'Question',
    description: 'Ask, check the answer, save it',
    icon: MessageCircleQuestion,
    tone: 'signal',
    inPalette: true,
    defaults: () => ({ label: 'Ask name', text: 'Aapka naam kya hai?', variable: 'name', validation: 'name', skipIfKnown: true }),
  },
  buttons: {
    title: 'Buttons',
    description: 'Customer picks an option',
    icon: ListChecks,
    tone: 'signal',
    inPalette: true,
    defaults: () => ({
      label: 'Choose',
      text: 'Aap kya karna chahenge?',
      options: [
        { id: uid('opt'), label: 'Option 1' },
        { id: uid('opt'), label: 'Option 2' },
      ],
    }),
  },
  condition: {
    title: 'Condition',
    description: 'If / else on a saved answer',
    icon: GitBranch,
    tone: 'ink',
    inPalette: true,
    defaults: () => ({ label: 'Check', variable: 'service', operator: 'equals', value: 'website' }),
  },
  ai: {
    title: 'AI reply',
    description: 'LLM answers with real-time API',
    icon: Bot,
    tone: 'ai',
    inPalette: true,
    defaults: () => ({
      label: 'AI reply',
      mode: 'once',
      instruction: 'Answer the customer helpfully and concisely using the uploaded company knowledge.',
      aiProvider: 'gemini',
      aiModel: 'gemini-1.5-flash',
      aiApiKey: '',
      aiBaseUrl: '',
      aiVerified: false,
    }),
  },
  tool: {
    title: 'MCP tool',
    description: 'Run a tool: save lead, book…',
    icon: Plug,
    tone: 'live',
    inPalette: true,
    defaults: () => ({ label: 'Run tool', tool: '', args: '{}', resultVar: 'toolResult' }),
  },
  webhook: {
    title: 'Webhook',
    description: 'Send the answers to a URL',
    icon: Webhook,
    tone: 'live',
    inPalette: true,
    defaults: () => ({ label: 'Send to CRM', url: 'https://' }),
  },
  handoff: {
    title: 'Human handoff',
    description: 'Pass the chat to your team',
    icon: Hand,
    tone: 'warn',
    inPalette: true,
    defaults: () => ({ label: 'Hand to team', text: 'Main aapko hamari team se jod raha hoon. 🙏' }),
  },
  end: { title: 'End', description: 'Finish the conversation', icon: Flag, tone: 'ink', inPalette: true, defaults: () => ({ label: 'End', text: 'Shukriya! 🙏' }) },
}

export const VALIDATIONS = [
  { value: 'text', label: 'Any text' },
  { value: 'name', label: 'Name' },
  { value: 'phone', label: 'Phone (10-digit India)' },
  { value: 'email', label: 'Email' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date (kal, monday, 28/10)' },
  { value: 'time', label: 'Time (4 baje, 16:30)' },
]

export const OPERATORS = [
  { value: 'equals', label: 'is' },
  { value: 'not_equals', label: 'is not' },
  { value: 'contains', label: 'contains' },
  { value: 'is_set', label: 'has a value' },
  { value: 'is_empty', label: 'is empty' },
]

/** Canvas par box ke andar ek line ka summary */
export function summary(type: BoxType, d: BoxData): string {
  switch (type) {
    case 'message':
    case 'handoff':
    case 'end':
      return d.text ?? ''
    case 'question':
      return `${d.text ?? ''}${d.variable ? `  → {{${d.variable}}}` : ''}`
    case 'buttons':
      return d.text ?? ''
    case 'condition': {
      const op = OPERATORS.find((o) => o.value === d.operator)?.label ?? d.operator
      return `{{${d.variable ?? '?'}}} ${op}${d.operator === 'is_set' || d.operator === 'is_empty' ? '' : ` "${d.value ?? ''}"`}`
    }
    case 'ai': {
      const provName = AI_PROVIDERS[d.aiProvider as AiProvider]?.name?.split(' ')[0] || (d.aiProvider ? String(d.aiProvider).toUpperCase() : 'Gemini')
      const m = d.aiModel || 'gemini-1.5-flash'
      const keyStatus = d.aiApiKey ? (d.aiVerified ? '⚡ Live' : '🔑 Key set') : '⚠️ Set API key'
      const promptSnippet = d.instruction ? `“${d.instruction.slice(0, 40)}${d.instruction.length > 40 ? '…' : ''}”` : 'No prompt set'
      return `${provName} (${m}) • ${keyStatus} — ${promptSnippet}`
    }
    case 'tool':
      return d.tool ? `${d.tool}  → {{${d.resultVar || 'toolResult'}}}` : 'Choose a tool'
    case 'webhook':
      return d.url ?? ''
    default:
      return 'Conversation starts here'
  }
}

/** Ek box se nikalne wale arrows ke "ports" (handles) */
export function outputs(type: BoxType, d: BoxData): { id: string | null; label?: string }[] {
  if (type === 'end' || type === 'handoff') return []
  if (type === 'buttons') return (d.options ?? []).map((o) => ({ id: o.id, label: o.label }))
  if (type === 'condition') return [
    { id: 'true', label: 'Yes' },
    { id: 'false', label: 'No' },
  ]
  if (type === 'tool') return [
    { id: 'success', label: 'Success' },
    { id: 'error', label: 'Error' },
  ]
  return [{ id: null }]
}
