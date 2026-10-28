import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { ErrorNote, Spinner } from '@/components/ui/bits'
import { api, type AuthStatus } from '@/lib/api'

/** Dashboard ke aage login. Pehli baar: admin account banao. */
export function AuthGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const status = useQuery({ queryKey: ['auth'], queryFn: () => api.get<AuthStatus>('/api/auth/status'), retry: 0 })

  // Kisi bhi API ko 401 mila → status dobara check (login page aa jayega)
  useEffect(() => {
    const onExpired = () => qc.invalidateQueries({ queryKey: ['auth'] })
    window.addEventListener('auth:expired', onExpired)
    return () => window.removeEventListener('auth:expired', onExpired)
  }, [qc])

  if (status.isLoading)
    return (
      <div className="grid h-full place-items-center text-muted">
        <Spinner />
      </div>
    )
  if (status.isError)
    return (
      <Screen title="Can’t reach the backend">
        <ErrorNote error={status.error} />
        <Button className="mt-4 w-full" onClick={() => status.refetch()}>
          Try again
        </Button>
      </Screen>
    )
  if (status.data?.needsSetup) return <AuthForm mode="setup" />
  if (!status.data?.user) return <AuthForm mode="login" />
  return <>{children}</>
}

function Screen({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center bg-paper px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <svg viewBox="0 0 24 24" className="size-7" aria-hidden>
            <circle cx="5" cy="6" r="2.2" fill="#2747d6" />
            <circle cx="5" cy="18" r="2.2" fill="#2747d6" />
            <circle cx="19" cy="12" r="2.2" fill="#17202e" />
            <path d="M7 6c6 0 6 6 10 6M7 18c6 0 6-6 10-6" stroke="#2747d6" strokeWidth="1.6" fill="none" />
          </svg>
          <span className="text-lg font-semibold tracking-tight">Switchboard</span>
        </div>
        <div className="rounded-lg border border-line bg-panel p-6">
          <h1 className="text-lg font-semibold">{title}</h1>
          {sub ? <p className="mt-1 text-[13px] text-muted">{sub}</p> : null}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>
  )
}

function AuthForm({ mode }: { mode: 'setup' | 'login' }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const setup = mode === 'setup'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!email.trim()) return setError('Enter your email')
    if (password.length < (setup ? 8 : 1)) return setError(setup ? 'Password must be at least 8 characters' : 'Enter your password')
    setPending(true)
    try {
      await api.post(setup ? '/api/auth/setup' : '/api/auth/login', { name, email, password })
      await qc.resetQueries()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setPending(false)
    }
  }

  return (
    <Screen
      title={setup ? 'Create the admin account' : 'Log in'}
      sub={setup ? 'First time here. This account controls the bot, its tools and all customer data.' : 'Log in to manage your chatbot.'}
    >
      <form onSubmit={submit} className="grid gap-4" noValidate>
        {setup ? (
          <Field label="Your name" htmlFor="a-name">
            <Input id="a-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
        ) : null}
        <Field label="Email" htmlFor="a-email">
          <Input id="a-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />
        </Field>
        <Field label="Password" htmlFor="a-pw" hint={setup ? 'At least 8 characters' : undefined}>
          <Input
            id="a-pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={setup ? 'new-password' : 'current-password'}
          />
        </Field>
        {error ? <p className="text-[13px] text-fault">{error}</p> : null}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? <Spinner className="size-3.5" /> : null}
          {setup ? 'Create account' : 'Log in'}
        </Button>
        {!setup ? <p className="text-[12.5px] text-muted">Forgot the password? Delete the user from the “users” collection in MongoDB and set up again.</p> : null}
      </form>
    </Screen>
  )
}
