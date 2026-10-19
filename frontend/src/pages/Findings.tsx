/* Step 4: root-cause findings, strongest first. */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { NextStep, PageHeader } from '../components/AppShell'
import { BubbleChart, ChartCard, LensRings, SimpleTable } from '../components/charts'
import Icon from '../components/Icon'
import { RecStatusChip } from '../components/RecActions'
import { EmptyState, ErrorNote, Segmented, Skeleton, StatusBadge, VerdictBadge } from '../components/ui'
import { api } from '../lib/api'
import { cx, money, num, pct } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useJobs } from '../lib/jobs'
import { useWorkspaces } from '../lib/workspaces'
import type { FindingSummary } from '../lib/types'

type View = 'all' | 'confirmed' | 'likely' | 'possible'

export default function Findings() {
  const { refreshKey } = useJobs()
  const { current } = useWorkspaces()
  const cur = current?.stats.currency || 'USD'
  const [view, setView] = useState<View>('all')
  const [resolved, setResolved] = useState(false)
  const res = useAsync(() => api<FindingSummary[]>('/api/findings', { params: { include_resolved: resolved } }), [refreshKey, resolved])
  const all = res.data || []
  const items = all.filter((f) => view === 'all' || f.status === view)
  const n = (s: View) => all.filter((f) => f.active && (s === 'all' || f.status === s)).length
  const nav = useNavigate()
  const m = (v: number) => money(v, cur)

  return (
    <main className="relative min-w-0 flex-1 overflow-hidden pb-12">
      <LensRings className="-right-[260px] -top-[320px]" />
      <PageHeader crumbs={[{ label: 'Step 04' }, { label: 'Root causes' }]} />
      <section className="anim-rise relative px-4 pt-4 sm:px-8">
        <h1 className="text-[30px] font-semibold tracking-[-0.03em] text-strong">Why products come back</h1>
        <p className="mt-1.5 max-w-[780px] text-[15px] text-muted">
          Each recurring problem was tested against batches, suppliers, carriers, warehouses and recent changes. A finding is only
          <b className="font-medium text-text"> confirmed </b> when a record documents the cause itself (a failed inspection, carrier damage
          scans); a strong pattern without that is <b className="font-medium text-text">likely</b>, a weak one <b className="font-medium text-text">possible</b>.
        </p>
      </section>

      {all.filter((x) => x.active).length > 0 && (
        <div className="relative px-4 pt-5 sm:px-8">
          <ChartCard title="Every case under the lens" sub="Right = further above the normal rate. Up = costs more each month. Size = returns linked. Click a bubble to open the case."
            table={<SimpleTable head={['Case', 'Status', '× normal', 'Per month', 'Returns']} rows={all.filter((x) => x.active).map((x) => [x.title, x.status, (x.lift || 0).toFixed(1), m(x.cost.monthly), x.cost.returns])} />}>
            <BubbleChart points={all.filter((x) => x.active).map((x) => ({ id: x.id, label: x.products.join(', '), lift: x.lift || 0, cost: x.cost.monthly, returns: x.cost.returns, status: x.status }))}
              format={m} label="Each root cause by how far above normal it is and its monthly cost" onPick={(id) => nav(`/app/findings/${id}`)} />
          </ChartCard>
        </div>
      )}

      <div className="relative flex flex-wrap items-center gap-3 px-4 pt-5 sm:px-8">
        <Segmented label="Certainty" value={view} onChange={setView} options={[
          { value: 'all', label: `All · ${n('all')}` }, { value: 'confirmed', label: `Confirmed · ${n('confirmed')}`, dot: 'bg-rose-ink' },
          { value: 'likely', label: `Likely · ${n('likely')}`, dot: 'bg-butter-ink' }, { value: 'possible', label: `Possible · ${n('possible')}`, dot: 'border border-dashed border-line/40' }]} />
        <label className="ml-auto flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={resolved} onChange={(e) => setResolved(e.target.checked)} className="accent-[rgb(var(--sky-ink))]" />
          Show findings no longer detected
        </label>
      </div>

      {res.error && <div className="px-4 pt-6 sm:px-8"><ErrorNote message={res.error} onRetry={res.reload} /></div>}
      {!res.data && !res.error && <div className="flex flex-col gap-3 px-4 pt-5 sm:px-8">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32" />)}</div>}
      {res.data && items.length === 0 && (
        <div className="px-4 pt-6 sm:px-8"><EmptyState icon="search" title="No findings here" body={all.length ? 'Try another filter.' : 'Upload data or load the sample store to run the investigation.'}>
          {!all.length && <Link to="/app/uploads" className="btn-primary">Upload data</Link>}</EmptyState></div>
      )}

      <ol className="relative flex flex-col gap-3 px-4 pt-5 sm:px-8">
        {items.map((f, i) => (
          <li key={f.id}>
            <Link to={`/app/findings/${f.id}`} className={cx('card card-hover anim-rise flex flex-wrap gap-5 p-5', !f.active && 'opacity-60')}
              style={{ animationDelay: `${Math.min(i, 8) * 0.04}s` }}>
              <div className="min-w-0 flex-[3_1_420px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-faint">Case {String(i + 1).padStart(2, '0')}</span>
                  <StatusBadge status={f.status} confidence={f.confidence} />
                  <span className="rounded-full bg-mist px-2.5 py-0.5 text-xs text-onpastel">{f.cause_label}</span>
                  {!f.active && <span className="rounded-full border border-dashed border-line/25 px-2.5 py-0.5 text-xs text-faint">No longer detected</span>}
                  {f.source === 'ai' && <span className="inline-flex items-center gap-1 rounded-full border border-mist-ink/25 px-2.5 py-0.5 text-xs text-mist-ink" title="Summary written by AI from the computed facts; numbers checked against them"><Icon name="sparkle" size={11} />AI summary</span>}
                </div>
                <h2 className="mt-2 text-[15px] font-medium leading-snug">{f.title}</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{f.summary}</p>
              </div>
              <div className="flex min-w-[240px] flex-[1_1_240px] flex-col gap-2.5 text-[13px]">
                {f.rate != null && f.rate_elsewhere != null && <MiniCompare here={f.rate} elsewhere={f.rate_elsewhere} lift={f.lift} />}
                <div className="flex justify-between gap-3"><span className="text-faint">Per month</span><span className="font-medium tabular-nums">{money(f.cost.monthly, cur)}</span></div>
                <div className="flex justify-between gap-3"><span className="text-faint">Cost so far · orders</span><span className="tabular-nums">{money(f.cost.total, cur)} · {num(f.orders_affected)}</span></div>
                {f.recommendation && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-line/[0.06] pt-2">
                    <RecStatusChip s={f.recommendation.status} />
                    {f.recommendation.verification && <VerdictBadge verdict={f.recommendation.verification.verdict} className="py-0 text-[11px]" />}
                    <span className="ml-auto inline-flex items-center gap-1 text-xs text-sky-ink">Open case <Icon name="arrowRight" size={12} /></span>
                  </div>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ol>
      {items.length > 0 && <NextStep to="/app/costs" step={5} title="See the financial impact" body="What returns cost, which problems cost the most, and how the estimates are made." />}
    </main>
  )
}

/** ○ elsewhere → ● here on one small track. */
function MiniCompare({ here, elsewhere, lift }: { here: number; elsewhere: number; lift?: number }) {
  const max = Math.max(here, elsewhere, 0.0001) * 1.15
  const P = (v: number) => `${(v / max) * 100}%`
  return (
    <div>
      <div className="flex justify-between text-[11px] text-faint"><span>elsewhere {pct(elsewhere)}</span><span className="text-rose-ink">here {pct(here)}{lift ? ` · ${lift.toFixed(1)}×` : ''}</span></div>
      <div className="relative mt-1.5 h-4" aria-hidden="true">
        <span className="absolute inset-x-0 top-[7px] h-[2px] rounded bg-line/[0.07]" />
        <span className="absolute top-[6px] h-1 rounded bg-rose-ink/40" style={{ left: P(Math.min(here, elsewhere)), width: `${(Math.abs(here - elsewhere) / max) * 100}%` }} />
        <span className="absolute top-[1px] box-border h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-muted bg-panel" style={{ left: P(elsewhere) }} />
        <span className="absolute top-[1px] h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-rose-ink" style={{ left: P(here) }} />
      </div>
    </div>
  )
}
