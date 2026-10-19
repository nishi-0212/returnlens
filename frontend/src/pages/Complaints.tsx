/* Step 3: complaint groups. Return reasons, comments and reviews grouped into recurring problems. */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { NextStep, PageHeader } from '../components/AppShell'
import { LensRings, Mosaic, Spark, WordChips, ink } from '../components/charts'
import FilterBar from '../components/FilterBar'
import Icon from '../components/Icon'
import { RecordLink } from '../components/RecordDrawer'
import { EmptyState, ErrorNote, Skeleton, Spinner, StatusBadge } from '../components/ui'
import { api } from '../lib/api'
import { cx, money, num, pct, shortDate } from '../lib/format'
import { filterQuery, useFilters } from '../lib/filters'
import { useAsync } from '../lib/hooks'
import { useJobs } from '../lib/jobs'
import { useWorkspaces } from '../lib/workspaces'
import type { ComplaintGroup, FindingSummary } from '../lib/types'

interface GroupsResponse { groups: ComplaintGroup[]; weeks: string[]; total_returns: number }

export default function Complaints() {
  const { refreshKey } = useJobs()
  const [f] = useFilters()
  const { current } = useWorkspaces()
  const cur = current?.stats.currency || 'USD'
  const res = useAsync(() => api<GroupsResponse>('/api/complaints', { params: filterQuery(f) }), [refreshKey, JSON.stringify(f)])
  const findings = useAsync(() => api<FindingSummary[]>('/api/findings'), [refreshKey])
  const [showOther, setShowOther] = useState(false)
  const groups = res.data?.groups || []
  const main = groups.filter((g) => g.actionable)
  const rest = groups.filter((g) => !g.actionable)

  return (
    <main className="relative min-w-0 flex-1 overflow-hidden pb-12">
      <LensRings className="-right-[260px] -top-[320px]" />
      <PageHeader crumbs={[{ label: 'Step 03' }, { label: 'Complaint groups' }]} />
      <section className="anim-rise relative px-4 pt-4 sm:px-8">
        <h1 className="text-[30px] font-semibold tracking-[-0.03em] text-strong">What customers are telling you</h1>
        <p className="mt-1.5 max-w-[760px] text-[15px] text-muted">
          Every return reason, return comment and low-rated review is read and grouped, so “runs small”, “size 9 fits like an 8”
          and “had to size up” count as one problem. Each group shows how many orders it hit, how customers said it, and real examples.
        </p>
      </section>
      <div className="relative px-4 pt-5 sm:px-8"><FilterBar hide={['cluster']} /></div>
      {main.length > 1 && (
        <section className="anim-rise relative px-4 pt-4 sm:px-8" aria-label="Share of returns by complaint group">
          <div className="mb-2 flex items-baseline gap-2"><span className="eyebrow">The shape of it</span><span className="text-xs text-faint">each tile is a group, sized by its returns · click to jump</span></div>
          <Mosaic label="Complaint groups sized by returns" items={main.map((g) => ({ key: g.key, label: g.label, value: g.returns }))}
            onPick={(k) => document.getElementById(`group-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
        </section>
      )}

      {res.error && <div className="px-4 pt-6 sm:px-8"><ErrorNote message={res.error} onRetry={res.reload} /></div>}
      {!res.data && !res.error && <div className="grid gap-3 px-4 pt-5 sm:px-8 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-72" />)}</div>}
      {res.data && groups.length === 0 && (
        <div className="px-4 pt-8 sm:px-8"><EmptyState icon="chat" title="No complaints in this view" body="Upload returns or widen the filters." /></div>
      )}

      <section className="relative grid gap-4 px-4 pt-5 sm:px-8 xl:grid-cols-2">
        {main.map((g, i) => <GroupCard key={g.key} g={g} i={i} cur={cur} total={res.data?.total_returns || 0}
          findings={(findings.data || []).filter((x) => x.cluster === g.key)} />)}
      </section>

      {rest.length > 0 && (
        <section className="px-4 pt-6 sm:px-8">
          <button type="button" className="btn-ghost -ml-2.5 text-xs" onClick={() => setShowOther((s) => !s)} aria-expanded={showOther}>
            <Icon name="chevronDown" size={13} className={cx('transition', showOther && 'rotate-180')} />
            Not product problems ({rest.map((g) => `${g.label}: ${g.returns}`).join(', ')})
          </button>
          {showOther && <div className="mt-3 grid gap-4 xl:grid-cols-2">{rest.map((g, i) => <GroupCard key={g.key} g={g} i={i} cur={cur} total={res.data?.total_returns || 0} findings={[]} />)}</div>}
        </section>
      )}
      {main.length > 0 && <NextStep to="/app/findings" step={4} title="See the root causes" body="Where each problem concentrates (batch, supplier, carrier, change) and how sure we are." />}
    </main>
  )
}

function GroupCard({ g, i, cur, total, findings }: { g: ComplaintGroup; i: number; cur: string; total: number; findings: FindingSummary[] }) {
  const [all, setAll] = useState(false)
  return (
    <article id={`group-${g.key}`} className="card card-hover anim-rise flex min-w-0 scroll-mt-40 flex-col p-5" style={{ animationDelay: `${Math.min(i, 8) * 0.04}s` }}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-medium">{g.label}</h2>
          <p className="mt-0.5 text-xs text-muted">{g.about}</p>
        </div>
        <div className="w-[120px] flex-none"><Spark values={g.trend} tone="rose" /><div className="mt-0.5 text-right text-[10px] text-faint">returns per week</div></div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[['Orders affected', num(g.orders_affected)], ['Returns', `${num(g.returns)}${total ? ` · ${pct(g.share_of_returns, 0)}` : ''}`],
          ['Reviews', num(g.reviews)], ['Cost', money(g.cost, cur)]].map(([k, v]) => (
          <div key={k}><dt className="text-[11px] text-faint">{k}</dt><dd className="mt-0.5 text-[15px] font-medium tabular-nums">{v}</dd></div>
        ))}
      </dl>

      {g.variants.length > 0 && (
        <div className="mt-4">
          <div className="eyebrow mb-1.5">How customers said it</div>
          <WordChips words={g.variants.map((v) => ({ text: v.text, count: v.count }))} />
        </div>
      )}

      {g.themes.length > 1 && (
        <div className="mt-3 text-xs text-muted">
          <span className="text-faint">Sub-themes: </span>{g.themes.map((t) => `${t.label} (${t.count})`).join(' · ')}
        </div>
      )}

      {g.examples.length > 0 && (
        <div className="mt-4">
          <div className="eyebrow mb-1.5">Representative complaints</div>
          <ul className="flex flex-col gap-2">
            {g.examples.map((e) => (
              <li key={e.id} className="rounded-lg border border-line/[0.06] bg-line/[0.02] px-3 py-2 text-[13px]">
                <p className="text-body">“{e.text}”</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-faint">
                  <RecordLink kind={e.type} id={e.id} />
                  <span>{e.product}</span>{e.batch && <span>· {e.batch}</span>}{e.carrier && e.carrier !== 'Unknown' && <span>· {e.carrier}</span>}
                  <span>· {shortDate(e.date)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
        {[['Products', g.top_products], ['Batches', g.top_batches], ['Carriers', g.top_carriers]].map(([title, rows]) => (
          <div key={title as string}>
            <div className="mb-1 text-faint">{title as string}</div>
            <ul className="flex flex-col gap-0.5">
              {(rows as ComplaintGroup['top_products']).slice(0, 3).map((r) => (
                <li key={r.key} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: ink('rose', 0.35 + 0.65 * Math.min(1, r.share)) }} />
                  <span className="min-w-0 flex-1 truncate text-body">{r.label}</span><span className="tabular-nums text-muted">{pct(r.share, 0)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {findings.slice(0, 2).map((x) => (
          <Link key={x.id} to={`/app/findings/${x.id}`} className="btn max-w-full"><StatusBadge status={x.status} className="py-0" /><span className="truncate">{x.products.join(', ')}</span></Link>
        ))}
        <button type="button" className="btn-ghost text-xs" onClick={() => setAll(true)}>All {num(g.returns + g.reviews)} records</button>
      </div>
      {all && <AllRecords cluster={g.key} label={g.label} onClose={() => setAll(false)} />}
    </article>
  )
}

interface RecordsPage { total: number; items: { type: 'return' | 'review'; id: string; date: string; sku: string; text: string; batch?: string; carrier?: string; confidence?: number; method?: string }[] }

function AllRecords({ cluster, label, onClose }: { cluster: string; label: string; onClose: () => void }) {
  const [f] = useFilters()
  const [limit, setLimit] = useState(50)
  const res = useAsync(() => api<RecordsPage>(`/api/complaints/${cluster}/records`, { params: { ...filterQuery(f), limit } }), [cluster, limit])
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`${label} records`}>
      <button type="button" aria-label="Close" className="anim-fade absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="anim-slide-in relative flex h-full w-full max-w-[560px] flex-col bg-panel2 shadow-pop">
        <div className="flex items-center gap-2 border-b border-line/[0.07] px-5 py-4">
          <div className="min-w-0 flex-1"><div className="text-sm font-medium">{label}</div><div className="text-xs text-muted">{res.data ? `${num(res.data.total)} records` : 'Loading…'}</div></div>
          <button type="button" className="btn-ghost px-2" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <ul className="flex-1 divide-y divide-line/[0.05] overflow-y-auto">
          {res.data?.items.map((x) => (
            <li key={x.type + x.id} className="px-5 py-3 text-[13px]">
              <p className="text-body">{x.text}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-faint">
                <RecordLink kind={x.type} id={x.id} /><span>{x.sku}</span>{x.batch && <span>· {x.batch}</span>}<span>· {shortDate(x.date)}</span>
                {x.method && <span title="How this record was placed in the group">· {x.method === 'llm' ? 'placed by AI' : x.method === 'reason' ? 'from reason code' : x.method === 'text' ? 'from comment' : x.method}</span>}
              </div>
            </li>
          ))}
        </ul>
        {res.data && res.data.total > limit && (
          <div className="border-t border-line/[0.07] p-3"><button type="button" className="btn w-full" onClick={() => setLimit((l) => l + 100)}>{res.loading ? <Spinner /> : null}Show more</button></div>
        )}
      </div>
    </div>
  )
}
