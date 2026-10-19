import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { LensRings } from '../components/charts'
import Icon from '../components/Icon'
import { LiveDot, Logo, Spinner, ThemeSwitch } from '../components/ui'
import { useAuth } from '../lib/auth'

function PasswordField({ id, value, onChange, autoComplete }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="flex h-11 items-center gap-1.5 rounded-[10px] border border-line/[0.09] bg-line/[0.02] pl-3 pr-1.5 transition hover:border-line/[0.16] focus-within:border-sky-ink/60 focus-within:bg-line/[0.035] focus-within:ring-[3px] focus-within:ring-sky-ink/15">
      <input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete} required minLength={id === 'new-password' ? 8 : 1}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none focus-visible:ring-0" />
      <button type="button" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'}
        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted transition hover:bg-line/[0.07] hover:text-text active:scale-95">
        <Icon key={String(show)} name={show ? 'eyeOff' : 'eye'} size={16} className="anim-check" />
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-wrap bg-bg">
      <div className="relative flex flex-[1_1_480px] items-center justify-center px-6 py-12">
        <div className="absolute right-6 top-5"><ThemeSwitch /></div>
        <div className="anim-rise w-full max-w-[380px]">
          <Link to="/"><Logo size={28} /></Link>
          <h1 className="mt-9 text-[30px] font-semibold tracking-[-0.028em]">{title}</h1>
          <p className="mt-2 text-[15px] text-muted">{subtitle}</p>
          {children}
        </div>
      </div>
      <div className="relative hidden min-h-screen flex-[1_1_480px] overflow-hidden border-l border-line/[0.06] bg-panel md:block">
        <LensRings className="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" size={900} />
        <div className="relative flex h-full flex-col justify-center gap-4 p-12">
          <div className="anim-rise w-[320px] self-start rounded-2xl border border-line/10 bg-panel2/90 p-4 shadow-pop" style={{ animationDelay: '.1s' }}>
            <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.06em] text-muted"><span>Earbuds Pro · by batch</span><span className="rounded-full bg-rose px-2 py-px normal-case tracking-normal text-onpastel">Confirmed</span></div>
            <svg viewBox="0 0 300 60" width="100%" aria-hidden="true" className="mt-2 block">
              <rect x="30" y="16" width="40" height="28" rx="8" style={{ fill: 'rgb(var(--mint-ink) / .12)' }} />
              {[34, 42, 48, 55, 62].map((x, i) => <circle key={x} cx={x} cy={30 + ((i % 3) - 1) * 8} r="5" style={{ fill: 'rgb(var(--sky-ink) / .85)' }} />)}
              <circle cx="250" cy="30" r="14" fill="none" strokeWidth="1.5" className="anim-ring" style={{ stroke: 'rgb(var(--rose-ink))' }} />
              <circle cx="250" cy="30" r="9" style={{ fill: 'rgb(var(--rose-ink))' }} />
              <path d="M76 30 L232 30" strokeWidth="1.5" fill="none" className="anim-march" style={{ stroke: 'rgb(var(--rose-ink))' }} />
            </svg>
            <div className="mt-1 text-xs text-muted">Batch B-EB-0712 returns 14% vs 2% · inspection INSP-0419 failed</div>
          </div>
          <div className="anim-rise w-[290px] self-end rounded-2xl border border-line/10 bg-panel2/90 p-4 shadow-pop" style={{ animationDelay: '.25s' }}>
            <div className="flex items-center gap-2 text-xs text-mint-ink"><LiveDot />Fix verified</div>
            <svg viewBox="0 0 260 70" width="100%" aria-hidden="true" className="mt-2 block">
              <line x1="40" y1="44" x2="220" y2="40" strokeDasharray="4 4" strokeWidth="1.5" style={{ stroke: 'rgb(var(--dim))' }} />
              <line x1="40" y1="14" x2="220" y2="56" strokeWidth="3" strokeLinecap="round" className="anim-trace" style={{ stroke: 'rgb(var(--mint-ink))', ['--len' as string]: 200 } as CSSProperties} />
              <circle cx="40" cy="14" r="5" strokeWidth="2.5" style={{ fill: 'rgb(var(--panel))', stroke: 'rgb(var(--mint-ink))' }} />
              <circle cx="220" cy="56" r="5" style={{ fill: 'rgb(var(--mint-ink))' }} />
            </svg>
            <div className="mt-1 text-[13px]">Mug breakage 7.6% → 1.1% after new packaging</div>
          </div>
          <div className="anim-rise w-[330px] self-center rounded-2xl border border-line/10 bg-panel2/90 p-4 shadow-pop" style={{ animationDelay: '.4s' }}>
            <div className="eyebrow text-blush-ink">Customers said it 42 ways</div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-onpastel">
              <span className="rounded-[10px] bg-rose px-2.5 py-0.5 text-[15px] font-medium">runs small</span>
              <span className="rounded-[10px] bg-blush px-2.5 py-0.5 text-[13px]">size 9 fits like an 8</span>
              <span className="rounded-[10px] bg-mist px-2.5 py-0.5 text-[12px]">had to size up</span>
            </div>
          </div>
          <p className="mt-4 max-w-[360px] text-xl font-medium leading-snug tracking-[-0.015em]">Find out why products come back, and fix the cause.</p>
        </div>
      </div>
    </div>
  )
}

export function Login() {
  const { login, user } = useAuth()
  const nav = useNavigate()
  const loc = useLocation() as { state?: { from?: string } }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (user) return <Navigate to="/app" replace />
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await login(email, password)
      nav(loc.state?.from || '/app', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally { setBusy(false) }
  }
  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to see what is driving your returns.">
      <form onSubmit={submit} className="mt-8 flex flex-col gap-4" noValidate={false}>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="label">Work email</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="input h-11 rounded-[10px]" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="current-password" className="label">Password</label>
          <PasswordField id="current-password" value={password} onChange={setPassword} autoComplete="current-password" />
        </div>
        {error && <div role="alert" className="rounded-lg border border-rose-ink/25 bg-rose-ink/[0.06] px-3 py-2 text-[13px] text-rose-ink">{error}</div>}
        <button type="submit" disabled={busy} className="btn-primary mt-1 h-11 rounded-[10px] text-sm">{busy ? <><Spinner /> Signing in…</> : 'Sign in'}</button>
      </form>
      <p className="mt-6 text-[13px] text-muted">New here? <Link to="/register" className="text-sky-ink hover:underline">Create an account</Link></p>
    </AuthLayout>
  )
}

export function Register() {
  const { register, user } = useAuth()
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (user) return <Navigate to="/app" replace />
  const tooShort = password.length > 0 && password.length < 8
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 8) { setError('Use at least 8 characters for your password.'); return }
    setBusy(true); setError(null)
    try {
      await register(name, email, password)
      nav('/app/uploads', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally { setBusy(false) }
  }
  return (
    <AuthLayout title="Create your account" subtitle="Start with the sample store, then bring your own data.">
      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="label">Your name</label>
          <input id="name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="input h-11 rounded-[10px]" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="label">Work email</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="input h-11 rounded-[10px]" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-password" className="label">Password</label>
          <PasswordField id="new-password" value={password} onChange={setPassword} autoComplete="new-password" />
          <span className={tooShort ? 'text-xs text-rose-ink' : 'text-xs text-faint'}>At least 8 characters</span>
        </div>
        {error && <div role="alert" className="rounded-lg border border-rose-ink/25 bg-rose-ink/[0.06] px-3 py-2 text-[13px] text-rose-ink">{error}</div>}
        <button type="submit" disabled={busy} className="btn-primary mt-1 h-11 rounded-[10px] text-sm">{busy ? <><Spinner /> Creating…</> : 'Create account'}</button>
      </form>
      <p className="mt-6 text-[13px] text-muted">Already have an account? <Link to="/login" className="text-sky-ink hover:underline">Sign in</Link></p>
    </AuthLayout>
  )
}
