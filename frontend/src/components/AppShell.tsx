import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { cx, pct, timeAgo } from '../lib/format'
import { JobsProvider, useJobs } from '../lib/jobs'
import { isEmptyWorkspace, WorkspacesProvider, useWorkspaces } from '../lib/workspaces'
import { useToast } from '../lib/toast'
import type { WorkspaceStats } from '../lib/types'
import Confirm from './Confirm'
import { RecordProvider } from './RecordDrawer'
import Icon from './Icon'
import { LiveDot, Logo, Spinner, ThemeSwitch } from './ui'

type StepState = { state: 'done' | 'active' | 'todo'; progress?: number; badge?: string; tip?: string }

/** The app's flow, in order. A step is ticked when finished, shows a ring while it needs you, and is grey until reached. */
const STEPS: { to: string; label: string; hint: string; status: (s: WorkspaceStats) => StepState }[] = [
  { to: '/app/uploads', label: 'Upload data', hint: 'Orders, returns, reviews, QC',
    status: (s) => (s.orders && s.returns ? { state: 'done' }
      : { state: 'active', badge: s.orders || s.returns ? 'add more' : 'start here',
          tip: 'The analysis starts once the workspace has both orders and returns.' }) },
  { to: '/app', label: 'Return analytics', hint: 'Rates, trends, baselines',
    status: (s) => (s.analyzed ? { state: 'done', badge: s.return_rate != null ? pct(s.return_rate) : undefined }
      : s.orders && s.returns ? { state: 'active', badge: 'analyzing' } : { state: 'todo' }) },
  { to: '/app/complaints', label: 'Complaint groups', hint: 'What customers say',
    status: (s) => (s.analyzed ? { state: 'done', badge: `${s.clusters} groups` } : { state: 'todo' }) },
  { to: '/app/findings', label: 'Root causes', hint: 'Evidence and confidence',
    status: (s) => (s.analyzed ? { state: 'done', badge: s.findings ? `${s.findings} found` : 'none' } : { state: 'todo' }) },
  { to: '/app/costs', label: 'Financial impact', hint: 'Actual vs estimated',
    status: (s) => (s.analyzed ? { state: 'done' } : { state: 'todo' }) },
  { to: '/app/actions', label: 'Corrective actions', hint: 'Approve, assign, complete',
    status: (s) => {
      if (!s.recs_total) return { state: 'todo' }
      const decided = s.recs_total - s.recs_proposed
      if (!s.recs_proposed) return { state: 'done', badge: `${s.recs_completed} done` }
      return { state: 'active', progress: decided / s.recs_total, badge: `${s.recs_proposed} to review`,
               tip: `Ring: ${decided} of ${s.recs_total} recommendations approved, rejected or completed.` }
    } },
  { to: '/app/verify', label: 'Did it work?', hint: 'Before/after and alerts',
    status: (s) => (s.alerts ? { state: 'active', badge: `${s.alerts} alert${s.alerts === 1 ? '' : 's'}`, progress: 1,
                                 tip: 'A fixed problem came back or a return rate is rising.' }
      : s.recs_completed ? { state: 'done', badge: `${s.recs_completed} checked` } : { state: 'todo', tip: 'Mark an action completed to measure it.' }) },
]

function StepNode({ n, st, on }: { n: number; st: StepState; on: boolean }) {
  const ring = on ? '0 0 0 5px rgb(var(--sky-ink) / .16)' : undefined
  if (st.state === 'done') {
    return <span className={cx('relative z-10 inline-flex h-6 w-6 flex-none items-center justify-center rounded-full text-onpastel', on ? 'bg-sky' : 'bg-mint')} style={{ boxShadow: ring }}>
      {on ? <span className="font-mono text-[11px]">{String(n).padStart(2, '0')}</span> : <Icon name="check" size={12} strokeWidth={3} />}</span>
  }
  const p = st.state === 'active' ? (st.progress ?? 0) : 0
  const c = 2 * Math.PI * 10.5
  return (
    <span className={cx('relative z-10 inline-flex h-6 w-6 flex-none items-center justify-center rounded-full', on ? 'bg-sky' : 'bg-panel')} style={{ boxShadow: ring }}>
      <svg width="24" height="24" viewBox="0 0 24 24" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="12" cy="12" r="10.5" fill="none" strokeWidth="1.5" strokeDasharray={st.state === 'active' ? '2.5 3' : undefined}
          style={{ stroke: st.state === 'active' ? 'rgb(var(--butter-ink) / .7)' : 'rgb(var(--ink) / .16)' }} />
        {st.state === 'active' && p > 0 && <circle cx="12" cy="12" r="10.5" fill="none" strokeWidth="2" strokeLinecap="round" strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, p))} style={{ stroke: 'rgb(var(--butter-ink))', transition: 'stroke-dashoffset .6s ease' }} />}
      </svg>
      <span className={cx('font-mono text-[11px]', on ? 'text-onpastel' : st.state === 'active' ? 'text-butter-ink' : 'text-faint')}>{String(n).padStart(2, '0')}</span>
    </span>
  )
}

export default function AppShell() {
  return (
    <WorkspacesProvider>
      <JobsProvider>
        <Shell />
      </JobsProvider>
    </WorkspacesProvider>
  )
}

function Shell() {
  const { current, loading } = useWorkspaces()
  return (
    <div className="relative min-h-screen bg-bg">
      <TopBar />
      {loading || !current ? (
        <div className="flex min-h-[60vh] items-center justify-center gap-3 text-sm text-muted"><Spinner className="text-sky-ink" />Loading your workspaces…</div>
      ) : (
        <div className="relative mx-auto w-full max-w-[1440px]"><RecordProvider><Outlet key={current.id} /></RecordProvider></div>
      )}
    </div>
  )
}

/** Closes a popover on outside click, Escape, or navigation. */
function usePopover(): [boolean, (v: boolean) => void, RefObject<HTMLDivElement>] {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const loc = useLocation()
  useEffect(() => setOpen(false), [loc.pathname, loc.search])
  useEffect(() => {
    if (!open) return
    const down = (e: globalThis.MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])
  return [open, setOpen, ref]
}

function TopBar() {
  const { current } = useWorkspaces()
  const alerts = current?.stats.alerts ?? 0
  return (
    <header className="sticky top-0 z-30 border-b border-line/[0.07] bg-panel/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-3 px-4 pt-3 sm:px-8">
        <Link to="/" aria-label="ReturnLens home"><Logo /></Link>
        <WorkspaceMenu />
        <div className="flex-1" />
        <JobPill />
        <Link to="/app/verify" className="btn relative w-8 px-0" aria-label={alerts ? `${alerts} unread alerts` : 'Alerts'} title="Alerts">
          <Icon name="bell" size={15} />
          {alerts > 0 && <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose px-1 text-[10px] font-semibold text-onpastel">{alerts}</span>}
        </Link>
        <span className="hidden sm:inline-flex"><ThemeSwitch /></span>
        <UserMenu />
      </div>
      <StageTrack />
    </header>
  )
}

function StageTrack() {
  const loc = useLocation()
  const { current } = useWorkspaces()
  const stats = current?.stats
  return (
    <nav aria-label="Steps" className="no-scrollbar mx-auto max-w-[1440px] overflow-x-auto px-4 sm:px-8">
      <ol className="flex min-w-[860px] pb-3 pt-3.5">
        {STEPS.map((s, i) => {
          const on = s.to === '/app' ? loc.pathname === '/app' : loc.pathname.startsWith(s.to)
          const st: StepState = stats ? s.status(stats) : { state: 'todo' }
          return (
            <li key={s.to} className="relative flex-1">
              {i < STEPS.length - 1 && <span aria-hidden="true" className={cx('absolute left-[calc(50%+16px)] right-[calc(-50%+16px)] top-[11px] h-[2px] rounded',
                st.state === 'done' ? 'bg-mint-ink/50' : 'bg-line/[0.09]')} />}
              <NavLink to={s.to} end={s.to === '/app'} title={st.tip || s.hint} aria-current={on ? 'page' : undefined}
                className="group flex flex-col items-center gap-1.5 rounded-lg px-1 text-center">
                <StepNode n={i + 1} st={st} on={on} />
                <span className={cx('text-[12px] leading-tight transition', on ? 'font-medium text-strong' : 'text-muted group-hover:text-text')}>{s.label}</span>
                <span className={cx('h-3.5 text-[11px] leading-tight', st.state === 'active' ? 'text-butter-ink' : 'text-faint')}>{st.badge || ''}</span>
              </NavLink>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function JobPill() {
  const { active, live, cancel } = useJobs()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  const job = active.find((j) => j.id === live?.id) || active[0]
  if (!job) return null
  return (
    <div className="anim-fade inline-flex h-8 items-center gap-2 rounded-full border border-sky-ink/25 bg-sky-ink/[0.06] pl-2.5 pr-1 text-xs">
      <LiveDot tone="sky" />
      <Link to="/app" className="max-w-[220px] truncate text-text hover:text-sky-ink">Analyzing · {job.stages.find((x) => x.status === 'running')?.label || 'Queued'}</Link>
      <button type="button" className="rounded-full px-2 py-1 text-[11px] text-rose-ink transition hover:bg-rose-ink/10" onClick={() => setConfirm(true)}>Stop</button>
      <Confirm open={confirm} danger title="Stop this analysis?" confirmLabel="Stop analysis"
        body="Steps that already finished may have updated some results. Run the analysis again later for a complete, consistent picture."
        onClose={() => setConfirm(false)}
        onConfirm={async () => { await cancel(job.id); toast.push('info', 'Analysis stopped') }} />
    </div>
  )
}

function WorkspaceMenu() {
  const nav = useNavigate()
  const toast = useToast()
  const { list, current, select, create, remove, clearAll } = useWorkspaces()
  const recents = list.filter((p) => !isEmptyWorkspace(p))
  const [open, setOpen, ref] = usePopover()
  const [confirm, setConfirm] = useState<null | { kind: 'delete'; id: string; name: string; running: boolean } | { kind: 'clear' }>(null)
  const [creating, setCreating] = useState(false)

  const newWorkspace = async () => {
    setCreating(true)
    try { await create(); setOpen(false); nav('/app/uploads') } catch (e) { toast.push('error', 'Could not create a workspace', (e as Error).message) } finally { setCreating(false) }
  }
  const empty = current && isEmptyWorkspace(current)

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true"
        className="inline-flex h-8 max-w-[260px] items-center gap-2 rounded-lg border border-line/[0.1] bg-line/[0.03] px-2.5 text-[13px] text-text transition hover:border-line/[0.18]">
        {current?.stats.running ? <LiveDot tone="sky" /> : <span className={cx('h-2 w-2 flex-none rounded-[3px]', current?.stats.alerts ? 'bg-rose-ink' : current?.stats.analyzed ? 'bg-mint-ink' : 'bg-line/20')} />}
        <span className="truncate">{empty ? 'New workspace' : current?.name || 'Workspace'}</span>
        <Icon name="chevronDown" size={13} className={cx('flex-none text-faint transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="anim-fade absolute left-0 top-10 z-40 w-[320px] rounded-xl border border-line/[0.1] bg-panel2 p-2 shadow-pop">
          <button type="button" onClick={newWorkspace} disabled={creating} className="btn-primary h-9 w-full justify-start rounded-[9px] px-3">
            {creating ? <Spinner /> : <span className="text-base leading-none">+</span>}New workspace
          </button>
          <div className="mt-3 flex items-center px-2">
            <span className="eyebrow">Recents</span>
            {recents.length > 0 && <button type="button" className="ml-auto text-[11px] text-faint transition hover:text-rose-ink" onClick={() => setConfirm({ kind: 'clear' })}>Clear all</button>}
          </div>
          {recents.length === 0 && <p className="px-2 pb-1 pt-2 text-[12px] leading-relaxed text-faint">Workspaces show up here once you add data to them.</p>}
          <ul className="mt-1 flex max-h-[320px] flex-col gap-0.5 overflow-y-auto">
            {recents.map((p) => (
              <li key={p.id} className="group relative">
                <button type="button" onClick={() => { select(p.id); setOpen(false); nav(p.stats.orders ? '/app' : '/app/uploads') }}
                  className={cx('flex w-full items-center gap-2 rounded-lg py-2 pl-2 pr-8 text-left transition', p.id === current?.id ? 'bg-line/[0.06]' : 'hover:bg-line/[0.045]')}>
                  {p.stats.running ? <LiveDot tone="sky" /> : <span className={cx('h-[7px] w-[7px] flex-none rounded-full', p.stats.alerts ? 'bg-rose-ink' : p.stats.analyzed ? 'bg-mint-ink' : 'bg-line/20')} />}
                  <span className="min-w-0 flex-1">
                    <span className={cx('block truncate text-[13px]', p.id === current?.id ? 'text-text' : 'text-muted')}>{p.name}</span>
                    <span className="block truncate text-[11px] text-faint">{p.stats.orders ? `${p.stats.orders.toLocaleString()} orders${p.stats.return_rate != null ? ` · ${pct(p.stats.return_rate)} returned` : ''}` : 'Empty'} · {timeAgo(p.updated_at)}</span>
                  </span>
                </button>
                <button type="button" aria-label={`Delete ${p.name}`} title="Delete"
                  onClick={() => setConfirm({ kind: 'delete', id: p.id, name: p.name, running: p.stats.running })}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-faint opacity-0 transition hover:bg-rose-ink/10 hover:text-rose-ink focus-visible:opacity-100 group-hover:opacity-100">
                  <Icon name="trash" size={13} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Confirm open={confirm?.kind === 'delete'} danger title={`Delete “${confirm?.kind === 'delete' ? confirm.name : ''}”?`} confirmLabel="Delete workspace"
        body={<>All data, findings, actions and alerts in this workspace will be deleted. This can't be undone.{confirm?.kind === 'delete' && confirm.running ? ' Its running analysis will be stopped first.' : ''}</>}
        onClose={() => setConfirm(null)}
        onConfirm={async () => { if (confirm?.kind === 'delete') { await remove(confirm.id); toast.push('success', 'Workspace deleted'); nav('/app') } }} />
      <Confirm open={confirm?.kind === 'clear'} danger title="Clear all workspaces?" confirmLabel="Delete everything"
        body="Every workspace in Recents and all of its data will be deleted, and any running analysis stopped. You'll start with a fresh, empty workspace."
        onClose={() => setConfirm(null)}
        onConfirm={async () => { await clearAll(); toast.push('success', 'All workspaces cleared'); nav('/app/uploads') }} />
    </div>
  )
}

function UserMenu() {
  const { user, logout } = useAuth()
  const [open, setOpen, ref] = usePopover()
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Account"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-mist text-[12px] font-semibold text-onpastel transition hover:brightness-95">
        {(user?.name || '?').slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="anim-fade absolute right-0 top-10 z-40 w-[240px] rounded-xl border border-line/[0.1] bg-panel2 p-3 shadow-pop">
          <div className="truncate text-[13px] text-text">{user?.name}</div>
          <div className="truncate text-[11px] text-faint">{user?.email}</div>
          <div className="mt-3 sm:hidden"><ThemeSwitch /></div>
          <button type="button" className="btn mt-3 w-full" onClick={logout}><Icon name="logout" size={14} />Sign out</button>
        </div>
      )}
    </div>
  )
}

/** The slim row under the step track: where you are, plus this page's actions. */
export function PageHeader({ crumbs, children }: { crumbs: { label: string; to?: string }[]; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 pt-5 sm:px-8">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center font-mono text-[11px] uppercase tracking-[0.06em] text-faint">
        {crumbs.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center">
            {i > 0 && <span className="px-1.5 text-dim">/</span>}
            {c.to ? <Link to={c.to} className="hover:text-text">{c.label}</Link> : <span className="truncate text-muted">{c.label}</span>}
          </span>
        ))}
      </nav>
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

/** "Next step" card shown at the bottom of each page so the flow is always obvious. */
export function NextStep({ to, step, title, body }: { to: string; step: number; title: string; body: string }) {
  return (
    <Link to={to} className="card card-hover group mx-4 mt-10 flex items-center gap-4 px-5 py-4 sm:mx-8">
      <span className="relative inline-flex h-11 w-11 flex-none items-center justify-center">
        <svg aria-hidden="true" width="44" height="44" viewBox="0 0 44 44" className="absolute inset-0"><circle cx="22" cy="22" r="20.5" fill="none" strokeDasharray="2 5" className="anim-turn" style={{ stroke: 'rgb(var(--sky-ink) / .55)' }} /></svg>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-sky font-mono text-[12px] text-onpastel">{String(step).padStart(2, '0')}</span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="eyebrow">Next step</div>
        <div className="mt-0.5 text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs text-muted">{body}</div>
      </div>
      <Icon name="arrowRight" size={18} className="text-sky-ink transition group-hover:translate-x-1" />
    </Link>
  )
}
