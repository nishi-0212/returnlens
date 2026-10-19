/* Step 2: return analytics. The rate against normal, a day-by-day heatmap, where complaints lead,
   which cases matter most, what returns cost, and unusual jumps. Every filter applies. */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { NextStep, PageHeader } from '../components/AppShell'
import { BarList, BubbleChart, ChartCard, Dumbbell, FlowChart, Gauge, Heatmap, LensRings, SimpleTable, STATUS_TONE, Waffle, Waterfall, ink } from '../components/charts'
import FilterBar from '../components/FilterBar'
import Icon from '../components/Icon'
import LiveRun from '../components/LiveRun'
import { EmptyState, ErrorNote, Segmented, Skeleton, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { COST_LINE_LABEL, longDate, money, num, pct, timeAgo } from '../lib/format'
import { filterQuery, useFilters } from '../lib/filters'
import { useAsync, useCountUp } from '../lib/hooks'
import { useJobs } from '../lib/jobs'
import { useToast } from '../lib/toast'
import { useWorkspaces } from '../lib/workspaces'
import type { BreakdownRow, Job, Overview as OverviewData } from '../lib/types'

type Dim = 'sku' | 'supplier' | 'category' | 'batch' | 'reason' | 'carrier' | 'month'
const DIMS: { value: Dim; label: string }[] = [
  { value: 'sku', label: 'Product' }, { value: 'supplier', label: 'Supplier' }, { value: 'category', label: 'Category' },
  { value: 'batch', label: 'Batch' }, { value: 'reason', label: 'Reason' }, { value: 'carrier', label: 'Carrier' }, { value: 'month', label: 'Month' },
]

export default function Overview() {
  const { refreshKey, live, track, active } = useJobs()
  const { current } = useWorkspaces()
  const [f, set] = useFilters()
  const toast = useToast()
  const nav = useNavigate()
  const res = useAsync(() => api<OverviewData>('/api/overview', { params: filterQuery(f) }), [refreshKey, JSON.stringify(f)])
  const [dim, setDim] = useState<Dim>('sku')
  const [busy, setBusy] = useState(false)
  const d = res.data
  const cur = d?.kpis?.currency || current?.stats.currency || 'USD'
  const m = (v: number) => money(v, cur)
  const stats = current?.stats

  const rerun = async () => {
    setBusy(true)
    try { track((await api<{ job: Job }>('/api/analysis/run', { method: 'POST' })).job); toast.push('info', 'Re-running the analysis') }
    catch (e) { toast.push('error', 'Could not start', (e as Error).message) } finally { setBusy(false) }
  }

  const findings = d?.all_findings || []
  const counts = { confirmed: findings.filter((x) => x.status === 'confirmed').length, likely: findings.filter((x) => x.status === 'likely').length, possible: findings.filter((x) => x.status === 'possible').length }
  const jumps = d?.has_data ? [
    ...d.baseline.spikes.slice(0, 6).map((s) => ({ key: s.dimension + s.key, label: s.label, from: s.baseline_rate, to: s.current_rate, sub: `${s.dimension} · ${s.lift.toFixed(1)}× its usual rate`,
      onClick: s.dimension === 'sku' ? () => set('sku', s.key) : s.dimension === 'supplier' ? () => set('supplier', s.key) : s.dimension === 'category' ? () => set('category', s.key) : undefined })),
    ...d.batch_outliers.filter((b) => b.unusual).slice(0, 4).map((b) => ({ key: 'b' + b.batch, label: `Batch ${b.batch}`, from: b.other_batches_rate, to: b.rate,
      sub: `${b.label} · other batches of the same product`, onClick: () => set('batch', b.batch) })),
  ] : []

  return (
    <main className="relative min-w-0 flex-1 overflow-hidden pb-12">
      <LensRings className="-right-[260px] -top-[300px]" />
      <PageHeader crumbs={[{ label: 'Step 02' }, { label: 'Return analytics' }]}>
        {d?.has_data && <button type="button" className="btn" onClick={rerun} disabled={busy || active.length > 0}>
          {busy || active.length ? <Spinner /> : <Icon name="refresh" size={14} />}Re-check data</button>}
        <Link to="/app/uploads" className="btn-primary"><Icon name="upload" size={14} strokeWidth={2} />Upload data</Link>
      </PageHeader>

      {live && <LiveRun job={live} />}
      {res.error && <div className="px-4 pt-6 sm:px-8"><ErrorNote message={res.error} onRetry={res.reload} /></div>}
      {!d && !res.error && !live && <div className="grid gap-3 px-4 pt-8 sm:px-8 md:grid-cols-4">{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <Skeleton key={i} className="h-28" />)}</div>}

      {d && !d.has_data && !live && (
        <div className="px-4 pt-10 sm:px-8">
          <EmptyState icon="upload" title="No data yet" body="Upload orders and returns (or load the sample store) and the analysis starts by itself.">
            <Link to="/app/uploads" className="btn-primary">Go to step 1: Upload data</Link>
          </EmptyState>
        </div>
      )}

      {d?.has_data && (
        <>
          <section className="anim-rise relative px-4 pt-4 sm:px-8">
            <h1 className="text-[30px] font-semibold tracking-[-0.03em] text-strong">{pct(d.kpis.return_rate)} of units come back</h1>
            <p className="mt-1.5 text-[15px] text-muted">
              {longDate(d.range?.start)} – {longDate(d.range?.end)} · {num(d.kpis.orders)} orders · counted by order date, so each return sits in the period its order was placed.
            </p>
            {d.run && (
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line/[0.07] bg-panel/70 px-4 py-2.5 text-[13px]">
                <span className="inline-flex items-center gap-2 font-mono text-[11px] text-faint"><Icon name="history" size={13} className="text-sky-ink" />Run {d.run.version} · {timeAgo(d.run.created_at)} · {d.run.source === 'ai' ? 'AI-assisted' : 'rule-based'}</span>
                <span className="min-w-0 flex-1 text-body">{d.run.summary}</span>
                {d.run.changes.length > 0 && (
                  <details className="w-full text-xs text-muted">
                    <summary className="cursor-pointer text-sky-ink">What changed since the last run ({d.run.changes.length})</summary>
                    <ul className="mt-2 flex flex-col gap-1">{d.run.changes.slice(0, 8).map((c, i) => <li key={i} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-sky-ink" />{c.text}</li>)}</ul>
                  </details>
                )}
              </div>
            )}
          </section>

          <div className="relative px-4 pt-5 sm:px-8"><FilterBar /></div>

          <section aria-label="Key numbers" className="relative grid gap-3 px-4 pt-4 sm:grid-cols-2 sm:px-8 xl:grid-cols-4">
            <div className="card card-hover anim-rise flex items-center gap-4 p-4">
              <Gauge value={d.kpis.return_rate} baseline={d.baseline.overall?.baseline_rate}
                label={`Return rate ${pct(d.kpis.return_rate)}${d.baseline.overall ? `, normal ${pct(d.baseline.overall.baseline_rate)}` : ''}`}
                tone={d.baseline.overall && d.baseline.overall.current_rate > d.baseline.overall.baseline_rate * 1.1 ? 'rose' : 'sky'} />
              <div className="min-w-0">
                <div className="eyebrow">Return rate</div>
                <Count value={d.kpis.return_rate} fmt={(v) => pct(v)} />
                {d.baseline.overall && <div className="text-xs text-muted">Last 30 settled days {pct(d.baseline.overall.current_rate)} · normal {pct(d.baseline.overall.baseline_rate)} (tick)</div>}
              </div>
            </div>
            <div className="card card-hover anim-rise flex items-center gap-4 p-4" style={{ animationDelay: '.05s' }}>
              <Waffle actual={d.kpis.costs_actual} estimated={d.kpis.costs_estimated} format={m} legend={false} size={10} />
              <div className="min-w-0">
                <div className="eyebrow">Cost of returns</div>
                <Count value={d.kpis.costs_total} fmt={m} />
                <div className="text-xs text-muted">■ {m(d.kpis.costs_actual)} recorded · ▢ {m(d.kpis.costs_estimated)} estimated</div>
              </div>
            </div>
            <Link to="/app/findings" className="card card-hover anim-rise block p-4" style={{ animationDelay: '.1s' }}>
              <div className="eyebrow">Root causes found</div>
              <div className="flex items-baseline gap-2"><Count value={findings.length} fmt={(v) => String(Math.round(v))} /><span className="text-xs text-muted">open cases</span></div>
              <div className="mt-2 flex flex-wrap gap-[5px]" role="img" aria-label={`${counts.confirmed} confirmed, ${counts.likely} likely, ${counts.possible} possible`}>
                {findings.map((x, i) => <span key={x.id} className="anim-develop box-border h-3.5 w-3.5 rounded-full" style={{ animationDelay: `${i * 0.04}s`,
                  ...(x.status === 'possible' ? { border: `1.5px dashed ${ink('mist')}` } : { background: ink(STATUS_TONE[x.status]) }) }} />)}
              </div>
              <div className="mt-1.5 text-xs text-muted">{counts.confirmed} confirmed · {counts.likely} likely · {counts.possible} possible</div>
            </Link>
            <Link to="/app/verify" className="card card-hover anim-rise flex items-center gap-4 p-4" style={{ animationDelay: '.15s' }}>
              <FixGlyph done={stats?.verified || 0} worked={stats?.improved || 0} />
              <div className="min-w-0">
                <div className="eyebrow">Fixes that worked</div>
                <div className="text-[26px] font-semibold tabular-nums tracking-tight">{stats?.improved || 0} <span className="text-sm font-normal text-muted">of {stats?.verified || 0} checked</span></div>
                <div className="text-xs text-muted">{stats?.recs_proposed ? `${stats.recs_proposed} actions waiting for you` : 'Before/after for every completed fix'}</div>
              </div>
            </Link>
          </section>

          <section className="relative flex flex-wrap gap-4 px-4 pt-4 sm:px-8">
            <ChartCard className="flex-[1_1_560px]" title="Return-rate heatmap" sub="One square per order day. Darker means more of that day's orders came back. Hover for the numbers."
              table={<SimpleTable head={['Week', 'Units', 'Returned', 'Rate']} rows={d.trend.map((t) => [t.period, num(t.units), num(t.returned), pct(t.rate)])} />}>
              <Heatmap days={d.daily || []} format={(v) => pct(v, 1)} label="Return rate for each order day in the selected period" />
            </ChartCard>
            <ChartCard className="flex-[1_1_560px]" title="From complaint to cause" sub="What customers said (left) and the root cause those returns were traced to (right). Click a cause to open it."
              table={<SimpleTable head={['Complaint', 'Traced to', 'Returns']} rows={(d.flows || []).map((x) => [x.source_label, x.target_label, x.returns])} />}>
              <FlowChart flows={d.flows || []} label="Returns flowing from complaint groups to root causes" onPick={(id) => nav(`/app/findings/${id}`)} />
            </ChartCard>
          </section>

          <section className="relative flex flex-wrap gap-4 px-4 pt-4 sm:px-8">
            <ChartCard className="flex-[1_1_620px]" title="Cases: how strong vs how costly" sub="Right = further above the normal rate. Up = costs more each month. Size = returns linked."
              right={<Link to="/app/findings" className="text-xs text-sky-ink hover:underline">All cases →</Link>}
              table={<SimpleTable head={['Case', 'Status', '× normal', 'Per month', 'Returns']} rows={findings.map((x) => [x.title, x.status, (x.lift || 0).toFixed(1), m(x.cost.monthly), x.cost.returns])} />}>
              <BubbleChart points={findings.map((x) => ({ id: x.id, label: x.products.join(', '), lift: x.lift || 0, cost: x.cost.monthly, returns: x.cost.returns, status: x.status }))}
                format={m} label="Each root cause by how far above normal it is and its monthly cost" onPick={(id) => nav(`/app/findings/${id}`)} />
            </ChartCard>
            <ChartCard className="flex-[1_1_480px]" title="What returns cost, step by step" sub="Each cost line added to the last. Solid is from your records, dashed is estimated."
              right={<Link to="/app/costs" className="text-xs text-sky-ink hover:underline">Assumptions →</Link>}
              table={<SimpleTable head={['Cost line', 'Recorded', 'Estimated', 'Total']} rows={(d.kpis.cost_lines || []).map((l) => [COST_LINE_LABEL[l.line] || l.line, m(l.actual), m(l.estimated), m(l.total)])} />}>
              <Waterfall steps={(d.kpis.cost_lines || []).map((l) => ({ key: l.line, label: COST_LINE_LABEL[l.line] || l.line, actual: l.actual, estimated: l.estimated }))}
                format={m} label={`Return costs add up to ${m(d.kpis.costs_total)}`} />
            </ChartCard>
          </section>

          <section className="relative px-4 pt-4 sm:px-8">
            <ChartCard title="Unusual jumps" sub={<>○ before → ● now. Last 30 settled days against the 90 days before{d.baseline.windows ? ` (${d.baseline.windows.current_start} → ${d.baseline.windows.current_end})` : ''}; batches against the product's other batches. Click to filter.</>}>
              <Dumbbell rows={jumps} format={(v) => pct(v)} empty="No product, supplier, category, carrier or batch is returning unusually more than its normal." />
              {d.high_risk_suppliers.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  <span className="eyebrow mr-1">High-risk suppliers</span>
                  {d.high_risk_suppliers.map((s) => (
                    <button key={s.key} type="button" onClick={() => set('supplier', s.key)} className="inline-flex items-center gap-1.5 rounded-full bg-rose px-2.5 py-0.5 text-xs text-onpastel transition hover:brightness-95">
                      {s.label} · {pct(s.current_rate)}
                    </button>
                  ))}
                </div>
              )}
            </ChartCard>
          </section>

          <section className="relative px-4 pt-4 sm:px-8">
            <ChartCard title="Returns broken down" sub={dim === 'reason' ? 'Share of all returns for each reason; click to filter' : 'Return rate for each; click a row to filter by it'}
              right={<Segmented label="Break down by" value={dim} options={DIMS} onChange={setDim} />}
              table={<Breakdown rows={d.by[dim]} cur={cur} />}>
              <BarList rows={(d.by[dim] || []).map((r) => ({ key: r.key, label: r.label, value: dim === 'reason' ? (r.share || 0) : r.rate,
                sub: `${num(r.returned)} returned of ${num(r.units)} units · ${money(r.refunds, cur)} refunded` }))}
                format={(v) => pct(v)}
                onSelect={(r) => {
                  const k = { sku: 'sku', supplier: 'supplier', category: 'category', batch: 'batch', reason: 'cluster' }[dim as string]
                  if (k) set(k as 'sku', r.key)
                }} />
            </ChartCard>
          </section>

          <p className="relative px-4 pt-4 text-xs text-faint sm:px-8">
            Data links: {num(d.links.returns_matched)} of {num(d.links.returns)} returns matched to an order line ·{' '}
            {num(d.links.batches_inferred)} order lines had their batch inferred from the batch table · {num(d.links.orders_with_carrier)} of {num(d.links.orders)} have a carrier.
          </p>
          <NextStep to="/app/complaints" step={3} title="See what customers are complaining about" body="Return reasons and reviews grouped into recurring problems." />
        </>
      )}
    </main>
  )
}

function Count({ value, fmt }: { value: number; fmt: (v: number) => string }) {
  const v = useCountUp(value)
  return <div className="text-[26px] font-semibold tabular-nums tracking-tight text-strong">{fmt(v)}</div>
}

/** Little slope marks, one per completed fix: down (mint) if it worked, flat (mist) otherwise. */
function FixGlyph({ done, worked }: { done: number; worked: number }) {
  const n = Math.min(4, Math.max(done, 1))
  return (
    <svg width={n * 30 + 6} height="52" viewBox={`0 0 ${n * 30 + 6} 52`} aria-hidden="true" className="flex-none">
      {Array.from({ length: n }, (_, i) => {
        const ok = i < worked
        const x = 6 + i * 30
        const c = done === 0 ? 'rgb(var(--ink) / .15)' : ok ? ink('mint') : ink('mist')
        return (
          <g key={i}>
            <line x1={x} y1={ok ? 10 : 22} x2={x + 18} y2={ok ? 40 : 27} stroke={c} strokeWidth={2.5} strokeLinecap="round" strokeDasharray={ok ? undefined : '3 4'} />
            <circle cx={x} cy={ok ? 10 : 22} r={3.5} fill={c} /><circle cx={x + 18} cy={ok ? 40 : 27} r={3.5} fill={c} />
          </g>
        )
      })}
    </svg>
  )
}

function Breakdown({ rows, cur }: { rows: BreakdownRow[]; cur: string }) {
  return <SimpleTable head={['', 'Units', 'Returned', 'Rate', 'Refunds', 'All costs']}
    rows={rows.map((r) => [r.label, num(r.units), num(r.returned), pct(r.rate), money(r.refunds, cur), money(r.cost, cur)])} />
}
