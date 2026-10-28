import { Bot, Flag, GitBranch, Hand, ListChecks, MessageSquare, MessageCircleQuestion, Play, Plug, Webhook, type LucideIcon } from 'lucide-react'

/* Flow builder ke box types — palette, canvas aur inspector teeno yahi use karte hain */

export type BoxType = 'start' | 'message' | 'question' | 'buttons' | 'condition' | 'ai' | 'tool' | 'webhook' | 'handoff' | 'end'
export type ButtonOption = { id: string; label: string; value?: string }
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
    description: 'LLM answers using your files',
    icon: Bot,
    tone: 'ai',
    inPalette: true,
    defaults: () => ({ label: 'AI answer', mode: 'once', instruction: 'Answer the customer briefly using company knowledge.' }),
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
    case 'ai':
      return d.mode === 'chat' ? 'Keeps chatting until “' + (d.exitKeywords || '—') + '”' : d.instruction ?? ''
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
