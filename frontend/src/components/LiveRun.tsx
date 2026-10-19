/* Live view of an analysis run: each stage lights up as the backend works through it. */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { cx } from '../lib/format'
import { useJobs } from '../lib/jobs'
import { useToast } from '../lib/toast'
import type { Job } from '../lib/types'
import Confirm from './Confirm'
import Icon, { type IconName } from './Icon'
import { LiveDot } from './ui'

const META: Record<string, { icon: IconName; tone: string; hint: string }> = {
  reading: { icon: 'database', tone: 'sky', hint: 'Orders, returns, reviews, QC' },
  clustering: { icon: 'chat', tone: 'mist', hint: 'Same problem, different words' },
  analyzing: { icon: 'pulse', tone: 'blush', hint: 'Rates vs baselines' },
  investigating: { icon: 'search', tone: 'rose', hint: 'Batches, suppliers, carriers, changes' },
  costing: { icon: 'coins', tone: 'butter', hint: 'Actual vs estimated' },
  recommending: { icon: 'list', tone: 'mint', hint: 'Fix, owner, deadline' },
  checking: { icon: 'shield', tone: 'sky', hint: 'Before/after and alerts' },
}

function elapsed(from?: string | null, to?: string | null): string {
  if (!from) return ''
  const s = Math.max(0, Math.round(((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export default function LiveRun({ job }: { job: Job }) {
  const { cancel, dismiss } = useJobs()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  const [, tick] = useState(0)
  const running = job.status === 'queued' || job.status === 'running'
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [running])
  const done = job.stages.filter((s) => s.status === 'done').length
  const pct = (done / Math.max(1, job.stages.length)) * 100

  return (
    <section className="anim-rise px-4 pt-8 sm:px-8" aria-live="polite">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-mono text-xs text-faint">
            {running ? <LiveDot tone="sky" /> : <Icon name={job.status === 'done' ? 'check' : 'x'} size={13} className={job.status === 'done' ? 'text-mint-ink' : 'text-rose-ink'} />}
            {job.label || 'Analysis'} · {elapsed(job.started_at || job.created_at, running ? null : job.finished_at)}
          </div>
          <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.028em]">
            {running ? 'Analyzing your returns…' : job.status === 'done' ? 'Analysis complete'
              : job.status === 'cancelled' ? 'Analysis stopped' : 'Analysis failed'}
          </h1>
          {job.status === 'done' && job.summary && <p className="mt-1.5 text-[15px] text-muted">{job.summary}</p>}
          {job.status === 'failed' && <p className="mt-1.5 text-sm text-rose-ink">{job.error}</p>}
        </div>
        {running ? (
          <button type="button" className="btn" onClick={() => setConfirm(true)}><Icon name="x" size={13} />Stop</button>
        ) : (
          <div className="flex gap-2">
            {job.status === 'done' && <Link to="/app/findings" className="btn-primary" onClick={dismiss}>See root causes <Icon name="arrowRight" size={14} /></Link>}
            <button type="button" className="btn" onClick={dismiss}>Close</button>
          </div>
        )}
      </div>

      <div className="card mt-5 overflow-x-auto p-5">
        <ol className="flex min-w-[820px]" aria-label="Analysis steps">
          {job.stages.map((s, i) => {
            const m = META[s.key] || { icon: 'sparkle', tone: 'sky', hint: '' }
            const on = s.status === 'running'
            const done = s.status === 'done'
            const bad = s.status === 'failed' || s.status === 'stopped'
            return (
              <li key={s.key} className="relative flex flex-1 flex-col items-center px-1 text-center">
                {i < job.stages.length - 1 && (
                  <span aria-hidden="true" className="absolute left-[calc(50%+22px)] right-[calc(-50%+22px)] top-[19px] h-[2px] overflow-hidden rounded bg-line/[0.08]">
                    <span className="block h-full rounded bg-mint-ink/60 transition-[width] duration-700 ease-out" style={{ width: done ? '100%' : '0%' }} />
                  </span>
                )}
                <span className="relative inline-flex h-10 w-10 items-center justify-center">
                  {on && <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" className="absolute inset-0"><circle cx="20" cy="20" r="18.5" fill="none" strokeWidth="2" strokeDasharray="3 5" className="anim-turn-fast" style={{ stroke: `rgb(var(--${m.tone}-ink))` }} /></svg>}
                  <span className={cx('inline-flex h-7 w-7 items-center justify-center rounded-full transition duration-300',
                    done ? 'bg-mint text-onpastel' : on ? 'text-onpastel' : bad ? 'bg-rose text-onpastel' : 'border border-line/[0.15] text-faint')}
                    style={on ? { background: `rgb(var(--${m.tone}))` } : undefined}>
                    {done ? <Icon name="check" size={13} strokeWidth={2.6} /> : bad ? <Icon name="x" size={13} /> : <Icon name={m.icon} size={13} />}
                  </span>
                </span>
                <span className={cx('mt-2 text-[12px] font-medium', s.status === 'pending' ? 'text-muted' : 'text-text', on && 'anim-sharpen')}>{s.label}</span>
                <span className="mt-0.5 min-h-[30px] max-w-[150px] text-[11px] leading-snug text-muted">
                  {s.detail || (s.status === 'stopped' ? 'Stopped' : s.status === 'failed' ? 'Failed here' : m.hint)}
                </span>
              </li>
            )
          })}
        </ol>
        <div className="mt-3 flex items-center gap-2 border-t border-line/[0.06] pt-3 font-mono text-[11px] text-faint" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          {done} of {job.stages.length} steps done
        </div>
      </div>

      <Confirm open={confirm} danger title="Stop this analysis?" confirmLabel="Stop analysis"
        body="Steps that already finished may have updated some results. Run the analysis again later for a complete, consistent picture."
        onClose={() => setConfirm(false)}
        onConfirm={async () => { await cancel(job.id); toast.push('info', 'Analysis stopped') }} />
    </section>
  )
}
