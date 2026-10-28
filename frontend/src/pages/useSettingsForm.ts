import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, type Settings } from '@/lib/api'

/** Settings ko local draft me edit karo, "Save" par backend me bhejo */
export function useSettingsForm() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/admin/settings') })
  const [draft, setDraft] = useState<Settings | null>(null)

  useEffect(() => {
    if (query.data && !draft) setDraft(query.data)
  }, [query.data, draft])

  // ai/apiKeyConfigured server ki status info hai, edit nahi hoti — compare me shamil nahi
  const strip = (s: Settings | null | undefined) => (s ? JSON.stringify({ ...s, ai: undefined, apiKeyConfigured: undefined, openaiKeyConfigured: undefined, recommendedPrompt: undefined }) : '')
  const dirty = Boolean(draft && query.data && strip(draft) !== strip(query.data))

  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => api.put<Settings>('/api/admin/settings', patch),
    onSuccess: (s) => {
      const next = s
      qc.setQueryData(['settings'], next)
      setDraft(next)
      qc.invalidateQueries({ queryKey: ['stats'] })
      toast.success('Changes saved. The bot uses them from the next message.')
    },
    onError: (e) => toast.error(e.message),
  })

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d))

  return {
    query,
    draft,
    set,
    dirty,
    save,
    reset: () => setDraft(query.data ?? null),
  }
}
