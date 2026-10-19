/* Step 6: corrective actions. Approve, reject or complete each recommendation; owners and deadlines are editable. */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { NextStep, PageHeader } from '../components/AppShell'
import { LensRings } from '../components/charts'
import RecActions, { RecStatusChip } from '../components/RecActions'
import { EmptyState, ErrorNote, PriorityBadge, Segmented, Skeleton, StatusBadge, VerdictBadge } from '../components/ui'
import { api } from '../lib/api'
import { cx, longDate, money } from '../lib/format'
import { useAsync, useCountUp } from '../lib/hooks'
import { useJobs } from '../lib/jobs'
import { useWorkspaces } from '../lib/workspaces'
import type { RecStatus, Recommendation } from '../lib/types'

type View = 'all' | RecStatus

export default function Actions() {
  const { refreshKey } = useJobs()
  const { current } = useWorkspaces()
  const cur = current?.stats.currency || 'USD'
  const res = useAsync(() => api<Recommendation[]>('/api/recommendations'), [refreshKey])
  const [view, setView] = useState<View>('proposed')
  const recs = res.data || []
  const count = (s: View) => recs.filter((r) => s === 'all' || r.status === s).length
  const items = recs.filter((r) => view === 'all' || r.status === view)
  const savings = recs.filter((r) => r.status !== 'rejected').reduce((s, r) => s + r.expected_monthly_savings, 0)
  const sv = useCountUp(savings)
  const today = new Date().toISOString().slice(0, 10)
  const replace = (r: Recommendation) => res.setData(recs.map((x) => (x.id === r.id ? { ...x, ...r } : x)))

  return (
    <main className="relative min-w-0 flex-1 overflow-hidden pb-12">
      <LensRings className="-right-[260px] -top-[320px]" />
      <PageHeader crumbs={[{ label: 'Step 06' }, { label: 'Corrective actions' }]} />
      <section className="anim-rise relative px-4 pt-4 sm:px-8">
        <h1 className="text-[30px] font-semibold tracking-[-0.03em] text-strong">
          {recs.length ? <>Fixes worth about <span className="text-mint-ink">{money(sv, cur)}</span> a month</> : 'Corrective actions'}
        </h1>
        <p className="mt-1.5 max-w-[760px] text-[15px] text-muted">
          One recommendation per root cause, matched to what was found: batch inspection and supplier review for defects, packaging
          tests for damage in the box, carrier reviews for transit damage, listing fixes for “not as described”, size guidance for fit.
          When you mark one completed, record the date it went live so we can measure whether it worked.
        </p>
      </section>

      <section aria-label="Where the actions are" className="anim-rise relative px-4 pt-5 sm:px-8">
        <div className="card overflow-x-auto p-4">
          <ol className="flex min-w-[640px] items-start">
            {([['proposed', 'To review', 'sky'], ['approved', 'In progress', 'butter'], ['completed', 'Completed', 'mint'], ['rejected', 'Rejected', null]] as const).map(([k, l, tone], i) => {
              const n = count(k)
              const size = 34 + Math.min(1, n / Math.max(1, recs.length)) * 26
              return (
                <li key={k} className="relative flex flex-1 flex-col items-center">
                  {i < 2 && <span aria-hidden="true" className="absolute left-[calc(50%+34px)] right-[calc(-50%+34px)] top-[30px] h-[2px] rounded bg-line/[0.1]" />}
                  <button type="button" onClick={() => setView(k)} aria-pressed={view === k} className="group flex flex-col items-center gap-2 rounded-xl px-3 py-1">
                    <span className="flex h-[60px] items-center">
                      <span className={cx('inline-flex items-center justify-center rounded-full font-mono text-[15px] font-medium transition', tone ? 'text-onpastel' : 'border border-dashed border-line/30 text-muted')}
                        style={{ width: size, height: size, background: tone ? `rgb(var(--${tone}))` : undefined, boxShadow: view === k ? '0 0 0 5px rgb(var(--sky-ink) / .16)' : undefined }}>{n}</span>
                    </span>
                    <span className={cx('text-[13px]', view === k ? 'font-medium text-strong' : 'text-muted group-hover:text-text')}>{l}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      </section>

      <div className="relative flex items-center gap-3 px-4 pt-5 sm:px-8">
        <Segmented label="Show" value={view} onChange={setView} options={[{ value: 'all', label: `All · ${count('all')}` },
          { value: 'proposed', label: 'To review' }, { value: 'approved', label: 'Approved' }, { value: 'completed', label: 'Completed' }, { value: 'rejected', label: 'Rejected' }]} />
      </div>

      {res.error && <div className="px-4 pt-6 sm:px-8"><ErrorNote message={res.error} onRetry={res.reload} /></div>}
      {!res.data && !res.error && <div className="flex flex-col gap-3 px-4 pt-5 sm:px-8">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>}
      {res.data && items.length === 0 && (
        <div className="px-4 pt-6 sm:px-8"><EmptyState icon="list" title={recs.length ? 'Nothing in this list' : 'No recommendations yet'}
          body={recs.length ? 'Pick another view above.' : 'Recommendations appear after the analysis finds root causes.'} /></div>
      )}

      <ol className="relative flex flex-col gap-3 px-4 pt-4 sm:px-8">
        {items.map((r, i) => {
          const overdue = r.status !== 'completed' && r.status !== 'rejected' && r.due_date < today
          return (
            <li key={r.id} className={cx('card card-hover anim-rise flex flex-wrap gap-5 p-5', r.status === 'rejected' && 'opacity-60')} style={{ animationDelay: `${Math.min(i, 8) * 0.04}s` }}>
              <div className="min-w-0 flex-[3_1_440px]">
                <div className="flex flex-wrap items-center gap-2">
                  <PriorityBadge p={r.priority} />
                  <RecStatusChip s={r.status} />
                  {r.finding && <StatusBadge status={r.finding.status} className="py-0" />}
                  {r.verification && r.status === 'completed' && <VerdictBadge verdict={r.verification.verdict} className="py-0" />}
                  {!r.finding_active && <span className="rounded-full border border-dashed border-line/25 px-2 py-0.5 text-[11px] text-faint">Problem no longer detected</span>}
                </div>
                <h2 className="mt-2 text-[15px] font-medium leading-snug">{r.title}</h2>
                {r.finding && <Link to={`/app/findings/${r.finding.id}`} className="mt-0.5 block text-xs text-sky-ink hover:underline">For: {r.finding.title}</Link>}
                <ol className="mt-2 flex flex-col gap-1.5 text-[13px] text-body">{r.steps.map((s, k) => (
                  <li key={s} className="flex gap-2"><span className="mt-px inline-flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-line/[0.05] font-mono text-[10px] text-muted">{k + 1}</span>{s}</li>))}</ol>
                <div className="mt-3"><RecActions rec={r} onChanged={replace} /></div>
              </div>
              <dl className="grid min-w-[220px] flex-[1_1_220px] grid-cols-[auto_1fr] content-start gap-x-3 gap-y-1.5 text-[13px]">
                <dt className="text-faint">Owner</dt><dd>{r.owner}</dd>
                <dt className="text-faint">Due</dt><dd className={cx(overdue && 'text-rose-ink')}>{longDate(r.due_date)}{overdue && ' · overdue'}</dd>
                <dt className="text-faint">Problem costs</dt><dd className="tabular-nums">{money(r.monthly_cost, cur)} / month</dd>
                <dt className="text-faint">Expected</dt><dd className="text-body">{r.expected_impact}</dd>
                {r.verification && r.status === 'completed' && <><dt className="text-faint">Result</dt><dd className="text-body">{r.verification.headline}</dd></>}
              </dl>
            </li>
          )
        })}
      </ol>
      {recs.some((r) => r.status === 'completed') && <NextStep to="/app/verify" step={7} title="Check whether the fixes worked" body="Before/after comparisons and alerts when a problem comes back." />}
    </main>
  )
}
