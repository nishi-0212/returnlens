/* One row of filters above the charts: date range, SKU, category, supplier, batch, complaint group, root cause. */
import { api } from '../lib/api'
import { cx } from '../lib/format'
import { useFilters } from '../lib/filters'
import { useAsync } from '../lib/hooks'
import { useJobs } from '../lib/jobs'
import type { Facets, Filters } from '../lib/types'
import Icon from './Icon'

function addDays(iso: string, d: number): string {
  const t = new Date(iso + 'T00:00:00Z')
  t.setUTCDate(t.getUTCDate() + d)
  return t.toISOString().slice(0, 10)
}

export default function FilterBar({ hide = [] }: { hide?: (keyof Filters)[] }) {
  const { refreshKey } = useJobs()
  const facets = useAsync(() => api<Facets>('/api/facets'), [refreshKey])
  const [f, set, clear, setMany] = useFilters()
  const fc = facets.data
  const end = fc?.range?.end || undefined
  const active = Object.keys(f).length
  const quick = (days: number | null) => {
    if (!end) return
    setMany({ ...f, date_from: days ? addDays(end, -days + 1) : undefined, date_to: days ? end : undefined })
  }
  const isQuick = (days: number | null) => (days === null ? !f.date_from && !f.date_to : f.date_to === end && f.date_from === (end ? addDays(end, -days + 1) : ''))
  const sel = (k: keyof Filters, label: string, opts: { value: string; label: string }[]) =>
    hide.includes(k) ? null : (
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-[11px] text-faint">{label}</span>
        <select value={f[k] || ''} onChange={(e) => set(k, e.target.value || null)}
          className={cx('input h-8 w-[150px] truncate py-0 text-xs', f[k] && 'border-sky-ink/50 text-text')}>
          <option value="">All</option>
          {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    )
  return (
    <div className="card flex flex-wrap items-end gap-3 px-4 py-3" role="group" aria-label="Filters">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-faint">Order date</span>
        <div className="flex items-center gap-1.5">
          <div className="inline-flex rounded-lg border border-line/[0.08] p-0.5 text-[11px]">
            {([['All', null], ['90d', 90], ['30d', 30]] as [string, number | null][]).map(([l, d]) => (
              <button key={l} type="button" onClick={() => quick(d)} disabled={!end}
                className={cx('rounded-md px-2 py-1 transition', isQuick(d) ? 'bg-line/[0.08] text-text' : 'text-muted hover:text-text')}>{l}</button>
            ))}
          </div>
          <input type="date" aria-label="From" value={f.date_from || ''} min={fc?.range?.start || undefined} max={end}
            onChange={(e) => set('date_from', e.target.value || null)} className="input h-8 w-[136px] py-0 text-xs" />
          <span className="text-faint">–</span>
          <input type="date" aria-label="To" value={f.date_to || ''} min={fc?.range?.start || undefined} max={end}
            onChange={(e) => set('date_to', e.target.value || null)} className="input h-8 w-[136px] py-0 text-xs" />
        </div>
      </div>
      {sel('sku', 'SKU', fc?.skus || [])}
      {sel('category', 'Category', (fc?.categories || []).map((c) => ({ value: c, label: c })))}
      {sel('supplier', 'Supplier', fc?.suppliers || [])}
      {sel('batch', 'Batch', (fc?.batches || []).map((b) => ({ value: b, label: b })))}
      {sel('cluster', 'Complaint group', fc?.clusters || [])}
      {sel('cause', 'Root cause', (fc?.causes || []).map((c) => ({ value: c, label: fc?.cause_labels?.[c] || c })))}
      {active > 0 && (
        <button type="button" onClick={clear} className="btn-ghost h-8 text-xs"><Icon name="x" size={12} />Clear {active}</button>
      )}
    </div>
  )
}
