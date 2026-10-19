import type { ReactNode } from 'react'
import { useTheme, type ThemeMode } from '../lib/theme'
import { cx } from '../lib/format'
import type { FindingStatus, Verdict } from '../lib/types'
import Icon, { type IconName } from './Icon'

export function Logo({ size = 22, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true" className="flex-none">
        <circle cx="11" cy="11" r="8" fill="none" strokeWidth="2" style={{ stroke: 'rgb(var(--sky-ink))' }} />
        <path d="M11 3a8 8 0 0 1 8 8" fill="none" strokeWidth="2" style={{ stroke: 'rgb(var(--blush-ink))' }} />
        <circle cx="11" cy="11" r="3" style={{ fill: 'rgb(var(--butter))' }} />
        <path d="M17 17l6 6" strokeWidth="2.4" strokeLinecap="round" style={{ stroke: 'rgb(var(--text))' }} />
      </svg>
      {withText && <span className="font-semibold tracking-[-0.01em] text-text">ReturnLens</span>}
    </span>
  )
}

const THEME_OPTS: { k: ThemeMode; label: string; icon: IconName }[] = [
  { k: 'light', label: 'Light theme', icon: 'sun' },
  { k: 'dark', label: 'Dark theme', icon: 'moon' },
  { k: 'system', label: 'Match system', icon: 'monitor' },
]

export function ThemeSwitch() {
  const { mode, setMode } = useTheme()
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex gap-0.5 rounded-[9px] border border-line/[0.08] bg-line/[0.03] p-[3px]">
      {THEME_OPTS.map((o) => (
        <button
          key={o.k}
          type="button"
          role="radio"
          aria-checked={mode === o.k}
          aria-label={o.label}
          title={o.label}
          onClick={() => setMode(o.k)}
          className={cx(
            'inline-flex h-[26px] w-7 items-center justify-center rounded-md transition duration-200',
            mode === o.k ? 'bg-panel text-text shadow-[0_1px_3px_rgb(var(--shadow)/0.2),inset_0_0_0_1px_rgb(var(--ink)/0.09)]' : 'text-faint hover:text-text',
          )}
        >
          <Icon name={o.icon} size={14} />
        </button>
      ))}
    </div>
  )
}

const STATUS_STYLE: Record<FindingStatus, { cls: string; label: string; tip: string }> = {
  confirmed: { cls: 'bg-rose text-onpastel', label: 'Confirmed', tip: 'A strong pattern plus a record that documents the cause itself.' },
  likely: { cls: 'bg-butter text-onpastel', label: 'Likely', tip: 'A strong pattern, but nothing documents the cause yet. Verify before treating it as fact.' },
  possible: { cls: 'border border-dashed border-line/30 text-muted', label: 'Possible', tip: 'A weak or small-sample pattern. Watch it; don\'t act on it alone.' },
}

/** Finding certainty: filled pill for confirmed/likely, dashed for possible, always with the word. */
export function StatusBadge({ status, confidence, className }: { status: FindingStatus; confidence?: number; className?: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.possible
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', s.cls, className)} title={s.tip}>
      <span aria-hidden="true" className={cx('h-1.5 w-1.5 rounded-full', status === 'possible' ? 'border border-current' : 'bg-current')} />
      {s.label}{confidence !== undefined ? ` · ${Math.round(confidence * 100)}%` : ''}
    </span>
  )
}

const VERDICT: Record<Verdict, { icon: IconName; label: string; cls: string }> = {
  improved: { icon: 'check', label: 'Improved', cls: 'bg-mint text-onpastel' },
  worsened: { icon: 'warning', label: 'Worsened', cls: 'bg-rose text-onpastel' },
  inconclusive: { icon: 'clock', label: 'Inconclusive', cls: 'bg-mist text-onpastel' },
  too_early: { icon: 'clock', label: 'Too early', cls: 'bg-mist text-onpastel' },
  not_started: { icon: 'clock', label: 'Not started', cls: 'border border-dashed border-line/30 text-faint' },
}

/** Before/after verdict: icon + word, never colour alone. */
export function VerdictBadge({ verdict, className }: { verdict: Verdict; className?: string }) {
  const v = VERDICT[verdict] ?? VERDICT.inconclusive
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', v.cls, className)}><Icon name={v.icon} size={12} strokeWidth={2.4} />{v.label}</span>
}

export const VERDICT_TONE: Record<Verdict, string> = { improved: 'mint', worsened: 'rose', inconclusive: 'mist', too_early: 'mist', not_started: 'mist' }

export function PriorityBadge({ p }: { p: string }) {
  const cls = p === 'P1' ? 'border-rose-ink/30 text-rose-ink' : p === 'P2' ? 'border-butter-ink/30 text-butter-ink' : 'border-line/15 text-muted'
  return <span className={cx('inline-flex h-5 items-center rounded-md border px-1.5 font-mono text-[11px]', cls)}>{p}</span>
}

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg className={cx('anim-spin', className)} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9" /></svg>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('shimmer rounded-md', className)} aria-hidden="true" />
}

/** "Working on it": a dot inside a slowly turning dashed lens ring. */
export function LiveDot({ tone = 'mint' }: { tone?: 'mint' | 'sky' | 'rose' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="flex-none">
      <circle cx="7" cy="7" r="6" fill="none" strokeWidth="1.4" strokeDasharray="2 2.4" className="anim-turn-fast" style={{ stroke: `rgb(var(--${tone}-ink))` }} />
      <circle cx="7" cy="7" r="2.6" style={{ fill: `rgb(var(--${tone}-ink))` }} />
    </svg>
  )
}

export function EmptyState({ icon = 'database', title, body, children }: { icon?: IconName; title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="card anim-rise flex flex-col items-center px-6 py-14 text-center">
      <span className="relative mb-4 inline-flex h-14 w-14 items-center justify-center">
        <svg aria-hidden="true" width="56" height="56" viewBox="0 0 56 56" className="absolute inset-0"><circle cx="28" cy="28" r="26" fill="none" strokeDasharray="2 6" className="anim-turn" style={{ stroke: 'rgb(var(--sky-ink) / .5)' }} /></svg>
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-sky text-onpastel"><Icon name={icon} size={18} /></span>
      </span>
      <div className="text-base font-medium">{title}</div>
      {body && <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted">{body}</p>}
      {children && <div className="mt-5 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  )
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-ink/25 bg-rose-ink/[0.06] px-4 py-3 text-sm">
      <span className="text-rose-ink">{message}</span>
      {onRetry && <button type="button" className="btn ml-auto" onClick={onRetry}>Try again</button>}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string; dot?: string }[]; onChange: (v: T) => void; label: string
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex gap-0.5 rounded-[9px] border border-line/[0.06] bg-line/[0.03] p-[3px]">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}
          className={cx('inline-flex h-7 items-center gap-1.5 rounded-md border px-3 text-xs transition duration-200',
            o.value === value ? 'border-line/[0.08] bg-line/[0.08] text-text' : 'border-transparent text-muted hover:text-text')}>
          {o.dot && <span className={cx('h-1.5 w-1.5 rounded-full', o.dot)} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}
