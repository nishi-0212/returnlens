/* Step 5: financial impact. Recorded costs are kept apart from estimates, and every estimate's assumption is editable. */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { NextStep, PageHeader } from '../components/AppShell'
import { BarList, ChartCard, LensRings, SimpleTable, Waffle, Waterfall } from '../components/charts'
import FilterBar from '../components/FilterBar'
import Icon from '../components/Icon'
import { EmptyState, ErrorNote, Segmented, Skeleton, Spinner, StatusBadge } from '../components/ui'
import { api } from '../lib/api'
import { COST_LINE_LABEL, money, num } from '../lib/format'
import { filterQuery, useFilters } from '../lib/filters'
import { useAsync } from '../lib/hooks'
import { useJobs } from '../lib/jobs'
import { useToast } from '../lib/toast'
import type { Assumptions, CostReport, CostRow } from '../lib/types'

type By = 'by_cause' | 'by_product' | 'by_supplier' | 'by_batch' | 'by_cluster'
const BY: { value: By; label: string }[] = [
  { value: 'by_cause', label: 'Root cause' }, { value: 'by_product', label: 'Product' }, { value: 'by_supplier', label: 'Supplier' },
  { value: 'by_batch', label: 'Batch' }, { value: 'by_cluster', label: 'Complaint group' },
]

export default function Costs() {
  const { refreshKey } = useJobs()
  const [f] = useFilters()
  const [n, setN] = useState(0)
  const res = useAsync(() => api<CostReport>('/api/costs', { params: filterQuery(f) }), [refreshKey, JSON.stringify(f), n])
  const [by, setBy] = useState<By>('by_cause')
  const d = res.data
  const cur = d?.currency || 'USD'
  const m = (v: number) => money(v, cur)

  return (
    <main className="relative min-w-0 flex-1 overflow-hidden pb-12">
      <LensRings className="-right-[260px] -top-[320px]" />
      <PageHeader crumbs={[{ label: 'Step 05' }, { label: 'Financial impact' }]} />
      <section className="anim-rise relative px-4 pt-4 sm:px-8">
        <h1 className="text-[30px] font-semibold tracking-[-0.03em] text-strong">{d?.has_data ? `Returns cost ${m(d.summary.total)}` : 'What returns cost'}</h1>
        <p className="mt-1.5 max-w-[760px] text-[15px] text-muted">
          Refunds, return shipping, replacements, handling and write-offs. Amounts in your data are used as recorded;
          the rest are estimates from the assumptions below, and are always shown separately.
        </p>
      </section>
      <div className="relative px-4 pt-5 sm:px-8"><FilterBar /></div>
      {res.error && <div className="px-4 pt-6 sm:px-8"><ErrorNote message={res.error} onRetry={res.reload} /></div>}
      {!d && !res.error && <div className="grid gap-3 px-4 pt-5 sm:px-8 md:grid-cols-2"><Skeleton className="h-56" /><Skeleton className="h-56" /></div>}
      {d && !d.has_data && <div className="px-4 pt-6 sm:px-8"><EmptyState icon="coins" title="No returns yet" body="Upload returns to see their cost."><Link to="/app/uploads" className="btn-primary">Upload data</Link></EmptyState></div>}

      {d?.has_data && (
        <>
          <section className="relative grid gap-4 px-4 pt-4 sm:px-8 xl:grid-cols-[1.1fr_1fr]">
            <div className="card card-hover anim-rise p-5">
              <h2 className="text-[15px] font-medium">Where the money goes</h2>
              <p className="mt-0.5 text-xs text-muted">Each cost line added to the last. Solid is from your records, dashed is estimated.</p>
              <div className="mt-3"><Waterfall steps={d.summary.lines.map((l) => ({ key: l.line, label: COST_LINE_LABEL[l.line] || l.line, actual: l.actual, estimated: l.estimated }))}
                format={m} label={`Return costs add up to ${m(d.summary.total)}`} /></div>
              <div className="mt-3"><Waffle actual={d.summary.actual} estimated={d.summary.estimated} format={m} cells={40} size={9} /></div>
              <table className="mt-4 w-full text-[13px]">
                <thead className="text-left text-xs text-faint"><tr><th className="py-1 font-normal">Cost line</th><th className="py-1 text-right font-normal">Recorded</th><th className="py-1 text-right font-normal">Estimated</th><th className="py-1 text-right font-normal">Total</th></tr></thead>
                <tbody>
                  {d.summary.lines.map((l) => (
                    <tr key={l.line} className="border-t border-line/[0.05]">
                      <td className="py-2 text-body">{COST_LINE_LABEL[l.line] || l.line}</td>
                      <td className="py-2 text-right tabular-nums">{l.actual ? m(l.actual) : '—'}</td>
                      <td className="py-2 text-right tabular-nums text-muted">{l.estimated ? m(l.estimated) : '—'}</td>
                      <td className="py-2 text-right font-medium tabular-nums">{m(l.total)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-line/[0.1]"><td className="py-2 font-medium">Total</td><td className="py-2 text-right tabular-nums">{m(d.summary.actual)}</td>
                    <td className="py-2 text-right tabular-nums text-muted">{m(d.summary.estimated)}</td><td className="py-2 text-right font-semibold tabular-nums">{m(d.summary.total)}</td></tr>
                </tbody>
              </table>
              <p className="mt-2 text-xs text-faint">{num(d.summary.returns)} returns in this view.</p>
            </div>

            <div className="card card-hover anim-rise p-5">
              <h2 className="text-[15px] font-medium">Highest-cost recurring problems</h2>
              <p className="mt-0.5 text-xs text-muted">Root-cause findings by monthly cost (all data, not filtered).</p>
              <ul className="mt-3 flex flex-col gap-2">
                {d.top_problems.slice(0, 6).map((x) => (
                  <li key={x.id}>
                    <Link to={`/app/findings/${x.id}`} className="card-hover flex items-center gap-3 rounded-lg border border-line/[0.06] p-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] text-text">{x.title}</div>
                        <div className="mt-0.5 text-xs text-muted">{x.cause_label} · {m(x.cost.total)} so far ({m(x.cost.actual)} recorded)</div>
                      </div>
                      <StatusBadge status={x.status} />
                      <div className="w-20 text-right"><div className="text-sm font-medium tabular-nums">{m(x.cost.monthly)}</div><div className="text-[10px] text-faint">per month</div></div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="relative px-4 pt-4 sm:px-8">
            <ChartCard title="Cost broken down" sub="Total cost per group; recorded vs estimated under each name"
              right={<Segmented label="Break down by" value={by} options={BY} onChange={setBy} />}
              table={<CostTable rows={d[by]} m={m} />}>
              <BarList rows={d[by].map((r) => ({ key: r.key, label: r.label, value: r.total, sub: `${m(r.actual)} recorded · ${m(r.estimated)} estimated · ${num(r.returns)} returns` }))} format={m} />
            </ChartCard>
          </section>

          <AssumptionsEditor a={d.assumptions} text={d.assumptions_text} onSaved={() => setN((x) => x + 1)} />
          <NextStep to="/app/actions" step={6} title="Review the corrective actions" body="Approve, reject or complete the recommended fixes." />
        </>
      )}
    </main>
  )
}

function CostTable({ rows, m }: { rows: CostRow[]; m: (v: number) => string }) {
  return <SimpleTable head={['', 'Returns', 'Recorded', 'Estimated', 'Total']} rows={rows.map((r) => [r.label, num(r.returns), m(r.actual), m(r.estimated), m(r.total)])} />
}

function AssumptionsEditor({ a, text, onSaved }: { a: Assumptions; text: CostReport['assumptions_text']; onSaved: () => void }) {
  const toast = useToast()
  const [v, setV] = useState(a)
  const [busy, setBusy] = useState(false)
  useEffect(() => setV(a), [a])
  const num_ = (k: keyof Assumptions, label: string, step = 0.5, suffix = a.currency) => (
    <label className="flex flex-col gap-1 text-xs text-muted">{label}
      <span className="flex items-center gap-1.5">
        <input type="number" min={0} step={step} className="input h-8 w-[110px] py-0 text-xs" value={v[k] as number}
          onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} /><span className="text-faint">{suffix}</span>
      </span>
    </label>
  )
  const save = async () => {
    setBusy(true)
    try {
      await api('/api/costs/assumptions', { method: 'PUT', body: v })
      toast.push('success', 'Assumptions saved', 'Every cost view now uses them.')
      onSaved()
    } catch (e) { toast.push('error', 'Could not save', (e as Error).message) } finally { setBusy(false) }
  }
  return (
    <section className="relative px-4 pt-4 sm:px-8">
      <div className="card anim-rise p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-medium">Assumptions behind the estimates</h2>
          <span className="text-xs text-muted">Used only where your data has no recorded amount.</span>
        </div>
        <ul className="mt-3 grid gap-2 text-[13px] md:grid-cols-2">
          {text.map((t) => <li key={t.key} className="rounded-lg border border-line/[0.06] p-3"><div className="text-xs text-faint">{t.label}</div><div className="mt-0.5 text-body">{t.text}</div></li>)}
        </ul>
        <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-line/[0.06] pt-4">
          {num_('reverse_shipping_per_unit', 'Return shipping per unit')}
          {num_('handling_per_return', 'Handling per return')}
          {num_('replacement_shipping_per_unit', 'Replacement shipping per unit')}
          <label className="flex flex-col gap-1 text-xs text-muted">Unit cost if unknown
            <span className="flex items-center gap-1.5"><input type="number" min={0} max={100} step={5} className="input h-8 w-[80px] py-0 text-xs"
              value={Math.round(v.cost_share_of_price_if_unknown * 100)} onChange={(e) => setV({ ...v, cost_share_of_price_if_unknown: Number(e.target.value) / 100 })} /><span className="text-faint">% of price</span></span>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">Currency
            <select className="input h-8 w-[90px] py-0 text-xs" value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })}>
              {['USD', 'EUR', 'GBP', 'INR'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <span className="text-xs text-muted">Write-off share by item condition:</span>
          {(Object.entries(v.write_off_share) as [string, number][]).map(([k, val]) => (
            <label key={k} className="flex flex-col gap-1 text-[11px] text-faint">{k}
              <input type="number" min={0} max={100} step={5} className="input h-8 w-[70px] py-0 text-xs" value={Math.round(val * 100)}
                onChange={(e) => setV({ ...v, write_off_share: { ...v.write_off_share, [k]: Number(e.target.value) / 100 } })} />
            </label>
          ))}
          <button type="button" className="btn-primary ml-auto" onClick={save} disabled={busy}>{busy ? <Spinner /> : <Icon name="check" size={13} />}Save assumptions</button>
        </div>
      </div>
    </section>
  )
}
