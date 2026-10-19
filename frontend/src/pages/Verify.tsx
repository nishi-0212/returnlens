/* Step 7: did the fixes work? Before/after on comparable periods, plus alerts when a problem comes back. */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/AppShell'
import { ChartCard, LensRings, LineChart, SimpleTable, Slope, ink } from '../components/charts'
import Icon from '../components/Icon'
import { RecordLink } from '../components/RecordDrawer'
import { EmptyState, ErrorNote, Skeleton, VERDICT_TONE, VerdictBadge } from '../components/ui'
import { api } from '../lib/api'
import { longDate, num, pct, shortDate } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useJobs } from '../lib/jobs'
import { useWorkspaces } from '../lib/workspaces'
import { useToast } from '../lib/toast'
import type { Alert, Recommendation, Verification } from '../lib/types'

interface Board { items: { recommendation: Recommendation; verification: Verification | null }[]; alerts: Alert[] }

export default function Verify() {
  const { refreshKey } = useJobs()
  const { refresh: refreshWorkspaces } = useWorkspaces()
  const toast = useToast()
  const res = useAsync(() => api<Board>('/api/verification'), [refreshKey])
  const d = res.data

  const dismiss = async (a: Alert) => {
    try {
      await api(`/api/alerts/${a.id}`, { method: 'PATCH', body: { dismissed: true, read: true } })
      res.setData({ ...d!, alerts: d!.alerts.filter((x) => x.id !== a.id) })
      refreshWorkspaces().catch(() => {})
    } catch (e) { toast.push('error', 'Could not dismiss', (e as Error).message) }
  }

  return (
    <main className="relative min-w-0 flex-1 overflow-hidden pb-12">
      <LensRings className="-right-[280px] -top-[320px]" />
      <PageHeader crumbs={[{ label: 'Step 07' }, { label: 'Did it work?' }]} />
      <section className="anim-rise relative flex flex-wrap items-end gap-4 px-4 pt-4 sm:px-8">
        <div className="min-w-0 flex-1">
          <h1 className="text-[30px] font-semibold tracking-[-0.03em] text-strong">Before and after every fix</h1>
          <p className="mt-1.5 max-w-[800px] text-[15px] text-muted">
            Orders placed the same number of days either side of the date each fix went live, using only orders whose returns have had
            time to arrive, with product mix held fixed. The dashed line is the same complaint on products you didn’t change, so a
            store-wide dip isn’t mistaken for your fix. A result is only called improved or worse when the difference is clear.
          </p>
        </div>
        {d && d.items.length > 0 && (
          <div className="flex flex-wrap gap-2 text-[13px]">
            {(['improved', 'worsened'] as const).map((k) => <span key={k} className={k === 'improved' ? 'rounded-full bg-mint px-3 py-1 text-onpastel' : 'rounded-full bg-rose px-3 py-1 text-onpastel'}>{d.items.filter((x) => x.verification?.verdict === k).length} {k}</span>)}
            <span className="rounded-full bg-mist px-3 py-1 text-onpastel">{d.items.filter((x) => x.verification && !['improved', 'worsened'].includes(x.verification.verdict)).length} not clear yet</span>
          </div>
        )}
      </section>

      {res.error && <div className="px-4 pt-6 sm:px-8"><ErrorNote message={res.error} onRetry={res.reload} /></div>}
      {!d && !res.error && <div className="flex flex-col gap-3 px-4 pt-6 sm:px-8"><Skeleton className="h-20" /><Skeleton className="h-72" /></div>}

      {d && d.alerts.length > 0 && (
        <section className="px-4 pt-6 sm:px-8" aria-label="Alerts">
          <div className="eyebrow mb-2">Alerts</div>
          <ul className="flex flex-col gap-2">
            {d.alerts.map((a) => {
              const linked = d.items.find((x) => x.recommendation.id === a.recommendation_id)?.verification?.series
              return (
                <li key={a.id} className="anim-rise flex flex-wrap items-center gap-4 rounded-xl border border-rose-ink/25 bg-rose-ink/[0.05] px-4 py-3">
                  {linked && linked.length > 3 ? <AlertTrend series={linked} /> : <Icon name="warning" size={18} className="flex-none text-rose-ink" />}
                  <div className="min-w-0 flex-[1_1_300px]">
                    <div className="text-[13px] font-medium text-strong">
                      <span className="mr-2 rounded-full bg-rose px-2 py-px text-[10px] uppercase tracking-wide text-onpastel">
                        {a.kind === 'reappeared' ? 'Came back' : a.kind === 'worsened' ? 'Got worse' : 'Rising'}</span>
                      {a.title}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">{a.text}</div>
                  </div>
                  <button type="button" className="btn text-xs" onClick={() => dismiss(a)}>Dismiss</button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {d && d.items.length === 0 && (
        <div className="px-4 pt-6 sm:px-8">
          <EmptyState icon="shield" title="No completed actions yet" body="Mark a corrective action as completed (with the date it went live) and its before/after result appears here.">
            <Link to="/app/actions" className="btn-primary">Go to corrective actions</Link>
          </EmptyState>
        </div>
      )}

      <div className="relative grid gap-4 px-4 pt-6 sm:px-8 lg:grid-cols-2 2xl:grid-cols-3">
        {d?.items.map(({ recommendation: r, verification: v }, i) => v && (
          <FixCard key={r.id} r={r} v={v} i={i} />
        ))}
      </div>
      {d && d.items.some((x) => x.verification?.before) && <Windows items={d.items} />}
    </main>
  )
}

function FixCard({ r, v, i }: { r: Recommendation; v: Verification; i: number }) {
  const [more, setMore] = useState(false)
  const tone = VERDICT_TONE[v.verdict]
  const after = v.after ? (v.after.mix_adjusted_rate ?? v.after.rate) : null
  return (
    <article className="card card-hover anim-rise flex flex-col p-5" style={{ animationDelay: `${Math.min(i, 6) * 0.05}s` }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-faint">Live {longDate(v.implemented_at)}</span>
        <VerdictBadge verdict={v.verdict} className="ml-auto" />
      </div>
      <h2 className="mt-2 min-h-[40px] text-[15px] font-medium leading-snug">{r.title}</h2>
      {v.before && v.after && after != null ? (
        <Slope before={v.before.rate} after={after} controlBefore={v.control?.before_rate} controlAfter={v.control?.after_rate}
          verdictTone={tone} format={(x) => pct(x)} beforeLabel={`${shortDate(v.before.start)}–${shortDate(v.before.end)}`} afterLabel={`${shortDate(v.after.start)}–${shortDate(v.after.end)}`}
          label={`Complaint rate went from ${pct(v.before.rate)} to ${pct(after)}${v.control ? `; other products ${pct(v.control.before_rate)} to ${pct(v.control.after_rate)}` : ''}`} />
      ) : (
        <div className="my-4 flex items-center gap-3 rounded-lg border border-dashed border-line/20 px-4 py-6 text-[13px] text-muted">
          <Icon name="clock" size={16} className="flex-none text-faint" />Not enough settled orders since the fix to compare yet.
        </div>
      )}
      <p className="border-t border-line/[0.06] pt-3 text-[13px] leading-relaxed text-body">{v.headline}</p>
      {v.detail && <p className="mt-1 text-xs text-muted">{v.detail}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
        {v.relative_change != null && <span className="font-mono text-[11px] text-muted">{v.relative_change > 0 ? '+' : ''}{Math.round(v.relative_change * 100)}% · p {v.p_value != null ? v.p_value.toFixed(3) : '—'}</span>}
        <button type="button" className="btn-ghost ml-auto text-xs" onClick={() => setMore((x) => !x)} aria-expanded={more}>{more ? 'Less' : 'Details'}</button>
        {r.finding && <Link to={`/app/findings/${r.finding.id}`} className="btn text-xs">Case <Icon name="arrowRight" size={12} /></Link>}
      </div>
      {more && (
        <div className="anim-fade mt-3 flex flex-col gap-3 border-t border-line/[0.06] pt-3">
          {v.series && v.series.length > 2 && (
            <ChartCard title="Complaint rate by order week" sub="Shaded: after the fix" className="border-line/[0.05] p-0 shadow-none"
              table={<SimpleTable head={['Week', 'Units', 'Complaints', 'Rate']} rows={v.series.map((p) => [p.period, num(p.units), p.complaints, pct(p.rate)])} />}>
              <LineChart label="Weekly complaint rate before and after the fix" format={(x) => pct(x, 0)} tone={tone} height={170}
                marker={v.implemented_at ? { x: v.implemented_at, label: 'Fix live' } : undefined} shadeAfter={v.implemented_at || undefined}
                points={v.series.map((p) => ({ x: p.period, y: p.rate, extra: `${p.complaints} of ${num(p.units)} units` }))} />
            </ChartCard>
          )}
          {v.before && v.after && (
            <table className="w-full text-[13px]">
              <thead className="text-left text-xs text-faint"><tr><th className="py-1 font-normal" /><th className="py-1 text-right font-normal">Before</th><th className="py-1 text-right font-normal">After</th></tr></thead>
              <tbody className="[&_td]:py-1.5">
                <tr className="border-t border-line/[0.05]"><td className="text-muted">Units ordered</td><td className="text-right tabular-nums">{num(v.before.units)}</td><td className="text-right tabular-nums">{num(v.after.units)}</td></tr>
                <tr className="border-t border-line/[0.05]"><td className="text-muted">Complaints</td><td className="text-right tabular-nums">{v.before.complaints}</td><td className="text-right tabular-nums">{v.after.complaints}</td></tr>
                <tr className="border-t border-line/[0.05]"><td className="text-muted">Rate</td><td className="text-right font-medium tabular-nums">{pct(v.before.rate)}</td><td className="text-right font-medium tabular-nums">{pct(v.after.rate)}</td></tr>
                {v.after.mix_adjusted_rate != null && <tr className="border-t border-line/[0.05]"><td className="text-muted">Same product mix</td><td /><td className="text-right tabular-nums">{pct(v.after.mix_adjusted_rate)}</td></tr>}
                {v.control && <tr className="border-t border-line/[0.05]"><td className="text-muted">Other products</td><td className="text-right tabular-nums">{pct(v.control.before_rate)}</td><td className="text-right tabular-nums">{pct(v.control.after_rate)}</td></tr>}
              </tbody>
            </table>
          )}
          {v.caveats && v.caveats.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-muted">
              {v.caveats.map((c) => <li key={c} className="flex gap-2"><Icon name="shield" size={12} className="mt-0.5 flex-none text-faint" />{c}</li>)}
            </ul>
          )}
          {!!v.recent_examples?.length && (
            <div className="text-xs"><span className="text-faint">Latest complaints of this kind: </span>
              <span className="inline-flex flex-wrap gap-1.5 align-middle">{v.recent_examples.map((e) => <RecordLink key={e.id} kind="return" id={e.id} />)}</span>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

/** The rate after the fix as a small area, ending in a dot: shows a problem climbing back. */
function AlertTrend({ series }: { series: NonNullable<Verification['series']> }) {
  const pts = series.slice(-16)
  const w = 200, h = 50
  const mx = Math.max(...pts.map((p) => p.rate), 0.0001)
  const xy = pts.map((p, i) => [(i / Math.max(1, pts.length - 1)) * (w - 6) + 3, h - 4 - (p.rate / mx) * (h - 10)])
  const fix = pts.findIndex((p) => p.after)
  const line = xy.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Weekly complaint rate for this fix, rising again at the end" className="flex-none">
      {fix > 0 && <line x1={xy[fix][0]} x2={xy[fix][0]} y1={2} y2={h} stroke={ink('mint')} strokeDasharray="2 3" />}
      <path d={`M${xy[0][0]},${h} L${line.replace(/ /g, ' L')} L${xy[xy.length - 1][0]},${h} Z`} fill={ink('rose', 0.15)} />
      <polyline points={line} fill="none" stroke={ink('rose')} strokeWidth={2} />
      <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r={3.5} fill={ink('rose')} />
    </svg>
  )
}

/** Before / after / still-settling windows of every fix on one shared calendar. */
function Windows({ items }: { items: Board['items'] }) {
  const rows = items.filter((x) => x.verification?.before && x.verification.after && x.verification.implemented_at)
  if (!rows.length) return null
  const t = (s: string) => new Date(s).getTime()
  const start = Math.min(...rows.map((x) => t(x.verification!.before!.start)))
  const end = Math.max(...rows.map((x) => Math.max(t(x.verification!.after!.end), Date.now())))
  const P = (v: number) => `${((v - start) / Math.max(1, end - start)) * 100}%`
  const W = (a: number, b: number) => `${(Math.max(0, b - a) / Math.max(1, end - start)) * 100}%`
  return (
    <section className="relative px-4 pt-4 sm:px-8">
      <div className="card card-hover anim-rise p-5">
        <h2 className="text-[15px] font-medium">How each comparison window was picked</h2>
        <p className="mb-4 mt-0.5 text-xs text-muted">Same length on both sides of the fix, up to 60 days. Orders from the last 14 days are left out because their returns haven’t arrived yet.</p>
        <div className="flex flex-col gap-3">
          {rows.map(({ recommendation: r, verification: v }) => {
            const bS = t(v!.before!.start), bE = t(v!.before!.end), aS = t(v!.after!.start), aE = t(v!.after!.end), fx = t(v!.implemented_at!)
            return (
              <div key={r.id} className="grid grid-cols-[minmax(120px,22%)_1fr] items-center gap-4">
                <span className="truncate text-[12px] text-body" title={r.title}>{r.title}</span>
                <span className="relative h-6 rounded-md bg-line/[0.03]">
                  <span className="absolute inset-y-0 flex items-center justify-center rounded-l-md border border-line/[0.14] text-[10px] text-muted" style={{ left: P(bS), width: W(bS, bE) }}>before</span>
                  <span className="absolute inset-y-0 flex items-center justify-center rounded-r-md border border-sky-ink/30 bg-sky-ink/[0.08] text-[10px] text-sky-ink" style={{ left: P(aS), width: W(aS, aE) }}>after</span>
                  {aE < end - 864e5 && <span className="absolute inset-y-0 flex items-center justify-center rounded-r-md border border-dashed border-line/20 text-[10px] text-faint" style={{ left: P(aE), width: W(aE, end) }}>settling</span>}
                  <span className="absolute -bottom-1 -top-1 w-[2px] rounded bg-mint-ink" style={{ left: P(fx) }} title={`Fix live ${shortDate(v!.implemented_at)}`} />
                </span>
              </div>
            )
          })}
          <div className="grid grid-cols-[minmax(120px,22%)_1fr] gap-4"><span /><span className="flex justify-between font-mono text-[10px] text-faint"><span>{shortDate(new Date(start).toISOString())}</span><span>{shortDate(new Date(end).toISOString())}</span></span></div>
        </div>
      </div>
    </section>
  )
}
