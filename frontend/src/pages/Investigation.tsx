/* The case file for one finding: why we call it what we call it, how the group compares with its peers,
   what customers said, how it unfolded, the evidence, what it costs and the corrective action. */
import { Link, useParams } from 'react-router-dom'
import { PageHeader } from '../components/AppShell'
import { ChartCard, DotStrip, Dumbbell, LensRings, LineChart, SimpleTable, Slope, Waffle, WordChips, ink } from '../components/charts'
import Icon from '../components/Icon'
import RecActions, { RecStatusChip } from '../components/RecActions'
import { RecordLink } from '../components/RecordDrawer'
import { ErrorNote, PriorityBadge, Skeleton, StatusBadge, VERDICT_TONE, VerdictBadge } from '../components/ui'
import { api } from '../lib/api'
import { COST_LINE_LABEL, cx, DIM_LABEL, longDate, money, num, pct, shortDate } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useJobs } from '../lib/jobs'
import { useWorkspaces } from '../lib/workspaces'
import type { ComplaintGroup, Finding, Peers, Recommendation, TimelineEvent, Verification } from '../lib/types'

interface Detail {
  finding: Finding; recommendation: Recommendation | null; complaint_group: ComplaintGroup | null; verification: Verification | null
  peers: Peers | null; timeline: TimelineEvent[]
}

const EVENT_TONE: Record<TimelineEvent['kind'], string> = { batch: 'mist', change: 'sky', inspection: 'rose', first: 'butter', latest: 'butter', peak: 'rose', fix: 'mint' }
const PEER_NAME: Record<string, string> = { batch: 'batch', supplier: 'supplier', carrier: 'carrier', warehouse: 'warehouse' }

export default function Investigation() {
  const { id = '' } = useParams()
  const { refreshKey } = useJobs()
  const { current } = useWorkspaces()
  const cur = current?.stats.currency || 'USD'
  const res = useAsync(() => api<Detail>(`/api/findings/${id}`), [id, refreshKey])
  const d = res.data
  const f = d?.finding
  const m = (v: number) => money(v, cur)

  return (
    <main className="relative min-w-0 flex-1 overflow-hidden pb-12">
      <LensRings className="-right-[300px] -top-[320px]" />
      <PageHeader crumbs={[{ label: 'Step 04' }, { label: 'Root causes', to: '/app/findings' }, { label: f ? f.products.join(', ') : 'Case' }]} />
      {res.error && <div className="px-4 pt-6 sm:px-8"><ErrorNote message={res.error} onRetry={res.reload} /></div>}
      {!d && !res.error && <div className="flex flex-col gap-3 px-4 pt-8 sm:px-8"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>}
      {f && d && (
        <>
          <section className="anim-rise relative flex flex-wrap items-start gap-6 px-4 pt-4 sm:px-8">
            <div className="min-w-0 flex-[999_1_560px]">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={f.status} confidence={f.confidence} />
                <span className="rounded-full bg-mist px-2.5 py-0.5 text-xs text-onpastel">{f.cause_label}</span>
                <span className="rounded-full border border-line/[0.12] px-2.5 py-0.5 text-xs text-muted">{f.cluster_label}</span>
                {!f.active && <span className="rounded-full border border-dashed border-line/25 px-2.5 py-0.5 text-xs text-faint">No longer detected in the latest data</span>}
              </div>
              <h1 className="mt-3 max-w-[900px] text-[30px] font-semibold leading-[1.12] tracking-[-0.03em] text-strong">{f.title}</h1>
              <p className="mt-2.5 max-w-[860px] text-[15px] leading-relaxed text-body">{f.summary}</p>
              {f.source === 'ai' && f.summary_rules && (
                <details className="mt-2 max-w-[860px] text-xs text-faint">
                  <summary className="cursor-pointer">Summary written by AI from the computed facts (numbers checked). Show the rule-based version</summary>
                  <p className="mt-1 text-muted">{f.summary_rules}</p>
                </details>
              )}
            </div>
            <Chain f={f} v={d.verification} />
          </section>

          <div className="relative flex flex-wrap gap-4 px-4 pt-6 sm:px-8">
            <div className="flex min-w-0 flex-[2_1_600px] flex-col gap-4">
              {d.peers ? (
                <ChartCard title={`One ${PEER_NAME[d.peers.dimension] || 'group'} stands apart`}
                  sub={`${f.cluster_label} returns per unit for every ${PEER_NAME[d.peers.dimension] || 'group'} of ${f.products.join(', ')}. The green band is where the others sit.`}
                  table={<SimpleTable head={[DIM_LABEL[d.peers.dimension] || 'Group', 'Units', 'Complaints', 'Rate']} rows={d.peers.rows.map((r) => [r.highlight ? `${r.value} ←` : r.value, num(r.units), r.complaints, pct(r.rate)])} />}>
                  <DotStrip rows={d.peers.rows} usual={d.peers.usual} format={(v) => pct(v, 1)} label={`Complaint rate of each ${PEER_NAME[d.peers.dimension] || 'group'}, with the one under investigation ringed`} />
                </ChartCard>
              ) : f.series.length > 2 && (
                <ChartCard title={`${f.cluster_label} rate by order week`} sub={f.change_date ? `The green line is the change on ${shortDate(f.change_date)}.` : f.products.join(', ')}
                  table={<SimpleTable head={['Week', 'Units', 'Complaints', 'Rate']} rows={f.series.map((p) => [p.period, num(p.units), p.complaints, pct(p.rate)])} />}>
                  <LineChart label="Weekly complaint rate" format={(v) => pct(v, 0)} tone="rose"
                    marker={f.change_date ? { x: f.change_date, label: `Change ${shortDate(f.change_date)}` } : undefined}
                    points={f.series.map((p) => ({ x: p.period, y: p.rate, extra: `${p.complaints} of ${num(p.units)} units` }))} />
                </ChartCard>
              )}

              {d.timeline.length > 1 && <Timeline events={d.timeline} />}

              <ChartCard title="Everywhere we looked" sub={`○ elsewhere → ● here, for ${f.cluster_label.toLowerCase()} returns. Many places were checked, so p-values are adjusted for that.`}
                table={<SimpleTable head={['Product', 'Checked', 'Value', 'Complaints', 'Units', 'Rate', 'Elsewhere', '×', 'p (adj.)']}
                  rows={f.tests.map((t) => [t.sku, DIM_LABEL[t.dimension] || t.dimension, t.value_label, t.complaints, num(t.units), pct(t.rate), pct(t.rate_elsewhere), t.lift.toFixed(1), (t.p_adjusted ?? t.p_value).toFixed(4)])} />}>
                <Dumbbell format={(v) => pct(v)} rows={f.tests.slice(0, 7).map((t, i) => ({
                  key: `${i}`, label: `${t.chosen ? '★ ' : ''}${DIM_LABEL[t.dimension] || t.dimension}: ${t.value_label}`, from: t.rate_elsewhere, to: t.rate,
                  sub: `${t.complaints} complaints in ${num(t.units)} units · ${t.lift.toFixed(1)}× · p ${(t.p_adjusted ?? t.p_value) < 0.001 ? '< 0.001' : (t.p_adjusted ?? t.p_value).toFixed(3)}${t.chosen ? ' · best explanation' : ''}` }))} />
              </ChartCard>

              {d.peers && f.series.length > 2 && (
                <ChartCard title={`${f.cluster_label} rate by order week`} sub={f.products.join(', ')}
                  table={<SimpleTable head={['Week', 'Units', 'Complaints', 'Rate']} rows={f.series.map((p) => [p.period, num(p.units), p.complaints, pct(p.rate)])} />}>
                  <LineChart label="Weekly complaint rate" format={(v) => pct(v, 0)} tone="rose"
                    marker={d.recommendation?.implemented_at ? { x: d.recommendation.implemented_at, label: 'Fix live' } : undefined}
                    points={f.series.map((p) => ({ x: p.period, y: p.rate, extra: `${p.complaints} of ${num(p.units)} units` }))} />
                </ChartCard>
              )}

              <Evidence f={f} />

              <section className="grid gap-4 md:grid-cols-2">
                <div className="card card-hover anim-rise p-5">
                  <h2 className="text-[15px] font-medium">Other explanations to rule out</h2>
                  <ul className="mt-3 flex flex-col gap-2.5 text-[13px] text-body">{f.alternatives.map((a) => (
                    <li key={a} className="flex gap-2.5"><span className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full border border-line/[0.15] text-faint"><Icon name="x" size={11} /></span>{a}</li>))}</ul>
                </div>
                <div className="card card-hover anim-rise p-5">
                  <h2 className="text-[15px] font-medium">What would make it certain</h2>
                  <ul className="mt-3 flex flex-col gap-2.5 text-[13px] text-body">{f.missing_data.map((a) => (
                    <li key={a} className="flex gap-2.5"><span className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full border border-dashed border-line/30 font-mono text-[11px] text-faint">?</span>{a}</li>))}</ul>
                </div>
              </section>
            </div>

            <aside className="flex min-w-0 flex-[1_1_340px] flex-col gap-4">
              {d.complaint_group && (
                <section className="card card-hover anim-rise p-5">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[15px] font-medium">In customers’ words</h2>
                    <Link to={`/app/complaints?cluster=${d.complaint_group.key}${f.skus.length === 1 ? `&sku=${f.skus[0]}` : ''}`} className="ml-auto text-xs text-sky-ink hover:underline">Group →</Link>
                  </div>
                  <p className="mb-3 mt-0.5 text-xs text-muted">Bigger = said more often · {num(d.complaint_group.orders_affected)} orders affected</p>
                  <WordChips words={[...d.complaint_group.variants.map((v) => ({ text: v.text, count: v.count })), ...d.complaint_group.themes.map((t) => ({ text: t.label.toLowerCase(), count: t.count }))]
                    .filter((w, i, a) => a.findIndex((x) => x.text === w.text) === i).sort((a, b) => b.count - a.count)} />
                  {d.complaint_group.examples[0] && (
                    <blockquote className="mt-4 rounded-lg bg-line/[0.03] px-3 py-2.5 text-[13px] leading-relaxed text-body">
                      “{d.complaint_group.examples[0].text}” <RecordLink kind={d.complaint_group.examples[0].type} id={d.complaint_group.examples[0].id} />
                    </blockquote>
                  )}
                </section>
              )}

              <section className="card card-hover anim-rise p-5">
                <h2 className="text-[15px] font-medium">What this case costs</h2>
                <div className="mt-1 flex items-baseline gap-2"><span className="text-[28px] font-semibold tabular-nums tracking-tight text-strong">{m(f.cost.monthly)}</span><span className="text-xs text-muted">a month · {m(f.cost.total)} so far</span></div>
                <div className="mt-3"><Waffle actual={f.cost.actual} estimated={f.cost.estimated} format={m} /></div>
                <table className="mt-3 w-full text-xs">
                  <tbody>{f.cost.lines.filter((l) => l.total > 0).map((l) => (
                    <tr key={l.line} className="border-t border-line/[0.05]">
                      <td className="py-1.5 text-muted">{COST_LINE_LABEL[l.line] || l.line}</td>
                      <td className="py-1.5 text-right tabular-nums">{m(l.total)}</td>
                      <td className="py-1.5 pl-2 text-right text-faint">{l.estimated > 0 ? (l.actual > 0 ? 'partly est.' : 'estimated') : 'recorded'}</td>
                    </tr>))}</tbody>
                </table>
                <div className="mt-2 text-xs text-muted">{num(f.cost.returns)} returns · {num(f.orders_affected)} orders · <Link to="/app/costs" className="text-sky-ink hover:underline">assumptions</Link></div>
              </section>

              {d.recommendation && (
                <section className="anim-rise rounded-xl border border-sky-ink/25 bg-sky-ink/[0.05] p-5">
                  <div className="flex items-center gap-2">
                    <span className="eyebrow text-sky-ink">Recommended action</span>
                    <PriorityBadge p={d.recommendation.priority} />
                    <span className="ml-auto"><RecStatusChip s={d.recommendation.status} /></span>
                  </div>
                  <p className="mt-2 text-[16px] font-medium leading-snug text-strong">{d.recommendation.title}</p>
                  <ol className="mt-2 flex flex-col gap-1.5 text-[13px] text-body">{d.recommendation.steps.map((s, i) => (
                    <li key={s} className="flex gap-2"><span className="mt-px inline-flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-panel font-mono text-[10px] text-muted">{i + 1}</span>{s}</li>))}</ol>
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-faint">Owner</dt><dd>{d.recommendation.owner}</dd>
                    <dt className="text-faint">Due</dt><dd>{longDate(d.recommendation.due_date)}</dd>
                    <dt className="text-faint">Expected</dt><dd className="text-body">{d.recommendation.expected_impact}</dd>
                  </dl>
                  <div className="mt-4 border-t border-sky-ink/15 pt-3"><RecActions rec={d.recommendation} onChanged={() => res.reload()} /></div>
                </section>
              )}

              {d.verification && (
                <section className="card card-hover anim-rise p-5">
                  <div className="flex items-center gap-2"><h2 className="text-[15px] font-medium">Did it work?</h2><VerdictBadge verdict={d.verification.verdict} className="ml-auto" /></div>
                  {d.verification.before && d.verification.after && (
                    <Slope before={d.verification.before.rate} after={d.verification.after.mix_adjusted_rate ?? d.verification.after.rate}
                      controlBefore={d.verification.control?.before_rate} controlAfter={d.verification.control?.after_rate}
                      verdictTone={VERDICT_TONE[d.verification.verdict]} format={(v) => pct(v)} beforeLabel="before" afterLabel="after"
                      label={`Complaint rate ${pct(d.verification.before.rate)} before and ${pct(d.verification.after.rate)} after the fix`} />
                  )}
                  <p className="mt-1 text-[13px] text-body">{d.verification.headline}</p>
                  <Link to="/app/verify" className="mt-2 inline-block text-xs text-sky-ink hover:underline">Full before/after →</Link>
                </section>
              )}

              {f.history?.length > 0 && (
                <section className="card anim-rise p-5">
                  <h2 className="text-[15px] font-medium">History</h2>
                  <ol className="mt-2 flex flex-col gap-1.5 text-xs">
                    {f.history.map((h, i) => <li key={i} className="flex gap-2"><span className="w-16 flex-none font-mono text-faint">Run {h.run}</span><span className="text-body">{h.note}</span></li>)}
                  </ol>
                </section>
              )}
            </aside>
          </div>
        </>
      )}
    </main>
  )
}

/** Three linked checks: a strong pattern, a record that documents it, and proof the fix worked. */
function Chain({ f, v }: { f: Finding; v: Verification | null }) {
  const chosen = f.tests.find((t) => t.chosen)
  const docs = f.evidence.inspections[0]?.id || (f.evidence.shipments.length ? 'carrier damage scans' : null)
  const steps = [
    { ok: f.status !== 'possible', label: 'Pattern', sub: chosen ? `${chosen.lift.toFixed(1)}×, p ${(chosen.p_adjusted ?? chosen.p_value) < 0.001 ? '< 0.001' : (chosen.p_adjusted ?? chosen.p_value).toFixed(3)}` : 'weak' },
    { ok: f.corroborated, label: 'Record', sub: f.corroborated ? (docs || 'documented') : 'none yet' },
    { ok: v?.verdict === 'improved', label: 'Fix proven', sub: v ? v.verdict.replace('_', ' ') : 'not fixed yet' },
  ]
  return (
    <div className="card min-w-0 flex-[1_1_320px] p-4">
      <div className="eyebrow">Why it’s “{f.status}”</div>
      <svg viewBox="0 0 320 92" width="100%" role="img" aria-label={steps.map((s) => `${s.label}: ${s.ok ? 'yes' : 'not yet'}`).join(', ')} className="mt-2 block">
        {[0, 1].map((i) => (
          <line key={i} x1={42 + i * 132} y1={30} x2={146 + i * 132} y2={30} strokeWidth={2}
            className={steps[i].ok && steps[i + 1].ok ? 'anim-march' : undefined}
            stroke={steps[i].ok && steps[i + 1].ok ? ink('mint') : 'rgb(var(--dim))'} strokeDasharray={steps[i].ok && steps[i + 1].ok ? undefined : '3 5'} />
        ))}
        {steps.map((s, i) => {
          const x = 28 + i * 132
          return (
            <g key={s.label}>
              {s.ok ? <><circle cx={x} cy={30} r={14} fill="rgb(var(--mint))" /><path d={`M${x - 6} 30l4 4 8-8`} stroke="#0b1520" strokeWidth={2} fill="none" /></>
                : <><circle cx={x} cy={30} r={13} fill="none" stroke="rgb(var(--dim))" strokeWidth={1.5} strokeDasharray="3 3" /><text x={x} y={35} textAnchor="middle" fontSize={13} fill="rgb(var(--muted))">?</text></>}
              <text x={x} y={64} textAnchor="middle" fontSize={12} fill="rgb(var(--text))">{s.label}</text>
              <text x={x} y={80} textAnchor="middle" fontSize={10.5} fill="rgb(var(--muted))">{s.sub.length > 22 ? s.sub.slice(0, 21) + '…' : s.sub}</text>
            </g>
          )
        })}
      </svg>
      <p className="mt-1 text-xs leading-relaxed text-muted">{f.status_reason}</p>
    </div>
  )
}

/** The dated records behind the case, alternating above and below one line. */
function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <section className="card card-hover anim-rise p-5">
      <h2 className="text-[15px] font-medium">How it unfolded</h2>
      <p className="mt-0.5 text-xs text-muted">The records behind this case, in order. Click an ID to open the original.</p>
      <div className="overflow-x-auto">
        <ol className="relative grid gap-3 pb-1 pt-4" style={{ gridTemplateColumns: `repeat(${events.length}, minmax(150px, 1fr))`, minWidth: events.length * 160 }}>
          <span aria-hidden="true" className="absolute inset-x-0 top-[calc(16px+104px+25px)] h-[2px] rounded bg-line/[0.1]" />
          {events.map((e, i) => {
            const card = (
              <div className="max-w-[230px] rounded-lg border border-line/[0.07] bg-line/[0.02] px-3 py-2">
                <div className={cx('text-[13px] font-medium', e.bad && 'text-rose-ink')}>{e.title}</div>
                {e.body && <div className="mt-0.5 line-clamp-3 text-[12px] leading-snug text-muted">{e.body}</div>}
                {e.ref && <div className="mt-1"><RecordLink kind={e.ref.kind} id={e.ref.id} /></div>}
              </div>
            )
            const top = i % 2 === 0
            return (
              <li key={i} className="anim-rise grid grid-rows-[104px_50px_104px]" style={{ animationDelay: `${i * 0.06}s` }}>
                <div className="self-end">{top && card}</div>
                <div className="flex items-center gap-2">
                  <span className="relative z-10 h-4 w-4 flex-none rounded-full ring-4 ring-panel" style={{ background: ink(EVENT_TONE[e.kind] || 'sky') }} />
                  <span className="relative z-10 bg-panel pr-1.5 font-mono text-[11px] text-muted">{shortDate(e.date)}</span>
                </div>
                <div>{!top && card}</div>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}

function Evidence({ f }: { f: Finding }) {
  return (
    <section className="card anim-rise p-5">
      <h2 className="text-[15px] font-medium">Evidence board</h2>
      <p className="mt-0.5 text-xs text-muted">Click any ID to open the original record.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {f.evidence.inspections.map((e) => (
          <article key={e.id} className="rounded-lg border border-rose-ink/25 bg-rose-ink/[0.05] p-3 text-[13px]">
            <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.06em] text-muted"><span className="inline-flex items-center gap-1.5"><Icon name="flask" size={13} className="text-rose-ink" />Inspection</span><span className="text-rose-ink">Documents it</span></div>
            <p className="mt-2 text-body">“{e.text}”</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-faint"><RecordLink kind="inspection" id={e.id} />batch {e.batch} · {e.result}{e.defect_rate ? ` · ${pct(e.defect_rate)} defects` : ''} · {shortDate(e.date)}{e.source && e.source !== 'table' ? ` · from ${e.source}` : ''}</div>
          </article>
        ))}
        {f.evidence.shipments.map((e) => (
          <article key={e.id} className="rounded-lg border border-rose-ink/25 bg-rose-ink/[0.05] p-3 text-[13px]">
            <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.06em] text-muted"><span className="inline-flex items-center gap-1.5"><Icon name="truck" size={13} className="text-rose-ink" />Carrier scans</span><span className="text-rose-ink">Documents it</span></div>
            <p className="mt-2 text-body">{e.text}</p>
          </article>
        ))}
        {f.evidence.changes.filter((c) => !c.context).map((c) => (
          <article key={c.id} className="rounded-lg border border-sky-ink/25 bg-sky-ink/[0.05] p-3 text-[13px]">
            <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.06em] text-muted"><span>Change</span><span className="text-sky-ink">The finding follows it</span></div>
            <p className="mt-2 text-body">{c.description}</p>
            <div className="mt-2"><RecordLink kind="change" id={c.id} label={shortDate(c.date)} /></div>
          </article>
        ))}
        {f.evidence.returns.slice(0, 4).map((e) => (
          <article key={e.id} className="rounded-lg border border-line/[0.07] bg-line/[0.02] p-3 text-[13px]">
            <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.06em] text-muted"><span>Return</span><span>{shortDate(e.date)}</span></div>
            <p className="mt-2 text-body">“{e.text}”</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-faint"><RecordLink kind="return" id={e.id} />{e.sku} · {e.batch || 'no batch'} · {e.carrier}{e.damaged_scan ? ' · damage scan' : ''}</div>
          </article>
        ))}
        {f.evidence.reviews.slice(0, 2).map((e) => (
          <article key={e.id} className="rounded-lg border border-line/[0.07] bg-line/[0.02] p-3 text-[13px]">
            <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.06em] text-muted"><span>Review · {'★'.repeat(Math.round(e.rating || 0))}</span><span>{shortDate(e.date)}</span></div>
            <p className="mt-2 text-body">“{e.text}”</p>
            <div className="mt-2"><RecordLink kind="review" id={e.id} /></div>
          </article>
        ))}
      </div>
      {f.evidence.returns.length > 4 && (
        <details className="mt-3 text-[13px]">
          <summary className="cursor-pointer text-xs text-sky-ink">More returns ({num(f.cost.returns)} in total, latest {f.evidence.returns.length} listed)</summary>
          <ul className="mt-2 divide-y divide-line/[0.05]">
            {f.evidence.returns.slice(4).map((e) => (
              <li key={e.id} className="flex flex-wrap items-start gap-2 py-2">
                <RecordLink kind="return" id={e.id} /><span className="min-w-0 flex-1 text-body">“{e.text}”</span>
                <span className="text-[11px] text-faint">{e.sku} · {e.batch || 'no batch'} · {shortDate(e.date)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {f.evidence.changes.some((c) => c.context) && (
        <div className="mt-3 text-xs text-muted"><span className="text-faint">Other changes on this product: </span>
          {f.evidence.changes.filter((c) => c.context).map((c) => <span key={c.id} className="mr-2 inline-flex items-center gap-1"><RecordLink kind="change" id={c.id} label={shortDate(c.date)} />{c.description}</span>)}
        </div>
      )}
    </section>
  )
}
