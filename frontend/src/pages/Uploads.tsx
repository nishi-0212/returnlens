/* Step 1: bring in data. Files are validated, mapped to the standard schema and linked; analysis starts by itself. */
import { useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { NextStep, PageHeader } from '../components/AppShell'
import Confirm from '../components/Confirm'
import { LensRings } from '../components/charts'
import Icon from '../components/Icon'
import { ErrorNote, Skeleton, Spinner } from '../components/ui'
import { api, API_URL } from '../lib/api'
import { cx, KIND_LABEL, timeAgo } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useJobs } from '../lib/jobs'
import { useWorkspaces } from '../lib/workspaces'
import { useToast } from '../lib/toast'
import type { Job, UploadRecord } from '../lib/types'

const ACCEPT = '.csv,.xlsx,.xls,.txt,.md,.docx,.pdf'
const MAX_MB = 15

const WHAT: { kind: string; title: string; body: string; file: string }[] = [
  { kind: 'orders', title: 'Orders', body: 'One row per order line: order ID, SKU, date, quantity, price. Batch and shipment IDs let returns be traced to a batch and a carrier.', file: 'orders.csv' },
  { kind: 'returns', title: 'Returns', body: 'Order ID, SKU, return date, reason and the customer’s comment. Refund, return-label, replacement and handling costs are used as actual costs when present.', file: 'returns.csv' },
  { kind: 'products', title: 'Products & listings', body: 'SKU, name, category, supplier, unit cost, price and the listing description.', file: 'products.csv' },
  { kind: 'reviews', title: 'Reviews', body: 'SKU or order ID, rating and text. Low-rated reviews join the complaint groups.', file: 'reviews.csv' },
  { kind: 'shipments', title: 'Shipments', body: 'Tracking/shipment ID, order ID, carrier, warehouse, dates and whether the carrier reported damage.', file: 'shipments.csv' },
  { kind: 'batches', title: 'Batches', body: 'Batch ID, SKU, supplier and received date. Used to infer batches for orders that don’t carry one.', file: 'batches.csv' },
  { kind: 'inspections', title: 'Quality inspections', body: 'Batch, result, defect rate and findings. Also accepted as Word/PDF reports that mention a batch ID.', file: 'inspections.csv' },
  { kind: 'changes', title: 'Change log', body: 'Date, SKU, type (listing update, supplier change, packaging change, size chart update) and a description.', file: 'change_log.csv' },
]

interface Pending { name: string; state: 'waiting' | 'uploading' | 'done' | 'error'; result?: UploadRecord; error?: string; waitingFor?: string[] }

export default function Uploads() {
  const { refreshKey, track } = useJobs()
  const { current, refresh: refreshWorkspaces } = useWorkspaces()
  const nav = useNavigate()
  const toast = useToast()
  const history = useAsync(() => api<UploadRecord[]>('/api/uploads'), [refreshKey])
  const [kind, setKind] = useState('auto')
  const [drag, setDrag] = useState(false)
  const [queue, setQueue] = useState<Pending[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmUpdate, setConfirmUpdate] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const stats = current?.stats

  const send = async (files: File[]) => {
    if (!files.length) return
    // reference data first so later files can be linked to it
    const rank = (n: string) => (/product|catalog|batch/i.test(n) ? 0 : /order/i.test(n) ? 1 : /\.(docx|pdf|txt|md)$/i.test(n) ? 3 : 2)
    const ordered = [...files].sort((a, b) => rank(a.name) - rank(b.name))
    setQueue(ordered.map((f) => ({ name: f.name, state: 'waiting' })))
    let job: Job | null = null
    for (const f of ordered) {
      const set = (p: Partial<Pending>) => setQueue((q) => q.map((x) => (x.name === f.name ? { ...x, ...p } : x)))
      if (f.size > MAX_MB * 1024 * 1024) { set({ state: 'error', error: `Larger than ${MAX_MB} MB` }); continue }
      set({ state: 'uploading' })
      const form = new FormData()
      form.append('file', f)
      if (kind !== 'auto') form.append('kind', kind)
      try {
        const r = await api<{ upload: UploadRecord; job: Job | null; waiting_for: string[] }>('/api/uploads', { form, method: 'POST' })
        set({ state: 'done', result: r.upload, waitingFor: r.waiting_for })
        if (r.job) job = r.job
      } catch (e) {
        set({ state: 'error', error: (e as Error).message })
      }
    }
    if (job) track(job)
    history.reload()
    refreshWorkspaces().catch(() => {})
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    send(Array.from(e.dataTransfer.files))
  }

  const sample = async () => {
    setBusy('sample')
    try {
      const r = await api<{ job: Job | null }>('/api/demo/sample', { method: 'POST' })
      track(r.job)
      toast.push('success', 'Sample store loaded', 'Analyzing returns now.')
      refreshWorkspaces().catch(() => {})
      nav('/app')
    } catch (e) { toast.push('error', 'Could not load sample data', (e as Error).message) } finally { setBusy(null) }
  }

  const update = async () => {
    setBusy('update')
    try {
      const r = await api<{ job: Job | null; marked_completed: string[] }>('/api/demo/update', { body: { simulate_fixes: true } })
      track(r.job)
      toast.push('success', 'Next six weeks loaded', r.marked_completed.length ? `${r.marked_completed.length} fixes marked as implemented. Check “Did it work?”.` : undefined)
      refreshWorkspaces().catch(() => {})
      nav('/app/verify')
    } catch (e) { toast.push('error', 'Could not load the update', (e as Error).message) } finally { setBusy(null) }
  }

  const reset = async () => {
    setBusy('reset')
    try {
      await api('/api/demo/data', { method: 'DELETE' })
      toast.push('success', 'Workspace cleared')
      setQueue([])
      history.reload()
      refreshWorkspaces().catch(() => {})
    } catch (e) { toast.push('error', 'Could not clear data', (e as Error).message) } finally { setBusy(null) }
  }

  const waiting = queue.flatMap((q) => q.waitingFor || [])
  return (
    <main className="relative min-w-0 flex-1 overflow-hidden pb-12">
      <LensRings className="-right-[260px] -top-[320px]" />
      <PageHeader crumbs={[{ label: 'Step 01' }, { label: 'Upload data' }]} />
      <section className="anim-rise relative px-4 pt-4 sm:px-8">
        <h1 className="text-[30px] font-semibold tracking-[-0.03em] text-strong">Bring in your returns data</h1>
        <p className="mt-1.5 max-w-[720px] text-[15px] text-muted">
          Orders and returns are all you need to start. Reviews, shipments, batches, inspection reports and a change log make the
          root-cause analysis sharper. Every file is checked, its columns are mapped automatically, and the analysis starts by itself.
        </p>
      </section>

      <div className="relative flex flex-wrap gap-4 px-4 pt-6 sm:px-8">
        <div className="flex min-w-0 flex-[2_1_460px] flex-col gap-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            className={cx('relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-[1.5px] border-dashed px-6 py-12 text-center transition duration-200',
              drag ? 'border-sky-ink/70 bg-sky-ink/[0.07]' : 'border-sky-ink/30 bg-panel/70')}>
            <span className="relative inline-flex h-[92px] w-[92px] items-center justify-center">
              <svg aria-hidden="true" width="92" height="92" viewBox="0 0 92 92" className="absolute inset-0">
                <circle cx="46" cy="46" r="44" fill="none" style={{ stroke: 'rgb(var(--ink) / .08)' }} />
                <circle cx="46" cy="46" r="34" fill="none" strokeDasharray="2 6" strokeWidth="1.5" className={drag ? 'anim-turn-fast' : 'anim-turn'} style={{ stroke: 'rgb(var(--sky-ink) / .6)' }} />
              </svg>
              <span className={cx('inline-flex h-12 w-12 items-center justify-center rounded-full bg-sky text-onpastel transition duration-300', drag && 'scale-110')}><Icon name="upload" size={20} /></span>
            </span>
            <div className="text-base font-medium">{drag ? 'Drop to upload' : 'Drag files here'}</div>
            <div className="text-xs text-muted">CSV, Excel (one type per sheet), Word, PDF or text · up to {MAX_MB} MB each · several at once</div>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
              <button type="button" className="btn-primary" onClick={() => input.current?.click()}>Choose files</button>
              <label className="flex items-center gap-2 text-xs text-muted">File holds
                <select value={kind} onChange={(e) => setKind(e.target.value)} className="input h-8 w-auto py-0 text-xs">
                  <option value="auto">Detect automatically</option>
                  {WHAT.map((w) => <option key={w.kind} value={w.kind}>{w.title}</option>)}
                </select>
              </label>
            </div>
            <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" aria-label="Choose files to upload"
              onChange={(e) => { send(Array.from(e.target.files || [])); e.target.value = '' }} />
          </div>

          {queue.length > 0 && (
            <div className="card divide-y divide-line/[0.05]">
              {queue.map((q) => <QueueRow key={q.name} q={q} />)}
              {queue.every((q) => q.state === 'done' || q.state === 'error') && (
                <div className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  {waiting.length && !(stats?.orders && stats?.returns) ? (
                    <span className="text-[13px] text-butter-ink">Saved. The analysis starts once you also upload {[...new Set(waiting)].join(' and ')}.</span>
                  ) : (
                    <>
                      <span className="text-[13px] text-muted">The analysis is running on the updated data.</span>
                      <Link to="/app" className="btn-primary ml-auto">Watch it live <Icon name="arrowRight" size={14} /></Link>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="card">
            <div className="flex items-center justify-between border-b border-line/[0.06] px-5 py-3.5">
              <div className="text-[13px] font-medium">Upload history</div>
              <span className="text-xs text-faint">{history.data?.length ?? 0} files</span>
            </div>
            {history.error && <div className="p-4"><ErrorNote message={history.error} onRetry={history.reload} /></div>}
            {!history.data && !history.error && <div className="flex flex-col gap-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>}
            {history.data?.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted">No uploads yet.</p>}
            <div className="divide-y divide-line/[0.05]">
              {history.data?.map((u) => <HistoryRow key={u.id} u={u} />)}
            </div>
          </div>
        </div>

        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          <div className="card p-5">
            <div className="eyebrow text-blush-ink">Try it with sample data</div>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              Five and a half months of a store’s orders, returns, reviews, shipments, batches, inspections and changes, with real
              problems hidden inside: a bad batch, flimsy packaging, a rough carrier, a misleading listing, a supplier switch.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button type="button" className="btn-primary h-9 justify-start" onClick={sample} disabled={!!busy}>
                {busy === 'sample' ? <Spinner /> : <Icon name="sparkle" size={14} />}1. Load the sample store
              </button>
              <button type="button" className="btn h-9 justify-start" onClick={() => setConfirmUpdate(true)} disabled={!!busy || !stats?.analyzed}>
                {busy === 'update' ? <Spinner /> : <Icon name="refresh" size={14} />}2. Add the next six weeks
              </button>
              <p className="text-xs leading-relaxed text-faint">
                Step 2 marks six recommended fixes as implemented on the first day, then loads six more weeks of data. Five of
                them really worked in the data; one (ParcelPro) didn’t, so you also see an alert when a problem comes back.
              </p>
            </div>
            <div className="mt-4 border-t border-line/[0.06] pt-4">
              <button type="button" className="btn-ghost -ml-2.5 text-xs" onClick={() => setConfirmReset(true)}><Icon name="trash" size={13} />Clear this workspace</button>
            </div>
            <Confirm open={confirmReset} danger title="Clear this workspace?" confirmLabel="Clear workspace"
              body="All data, uploads, findings, actions and alerts in this workspace will be deleted. Other workspaces are not affected."
              onClose={() => setConfirmReset(false)} onConfirm={reset} />
            <Confirm open={confirmUpdate} title="Simulate the next six weeks?" confirmLabel="Mark fixes & load data"
              body="This marks six recommendations (mug packaging, earbud batch, linen-shirt listing, sneaker supplier, blender batch and the ParcelPro carrier) as completed on the first day of the new period, if they exist and weren’t rejected, then uploads the new data. It’s a demo shortcut; with real data you mark actions completed yourself."
              onClose={() => setConfirmUpdate(false)} onConfirm={update} />
          </div>

          <div className="card p-5 text-[13px]">
            <div className="eyebrow">What you can upload</div>
            <p className="mt-2 text-xs leading-relaxed text-muted">Column names don’t have to match: “RMA #”, “Order Number” or “Item SKU” are recognised. Download any sample file to use as a template.</p>
            <ul className="mt-3 flex flex-col gap-3.5">
              {WHAT.map((w) => (
                <li key={w.kind}>
                  <div className="flex items-center gap-2 font-medium">{w.title}
                    {(w.kind === 'orders' || w.kind === 'returns') && <span className="rounded bg-sky-ink/10 px-1.5 text-[10px] font-normal text-sky-ink">required</span>}
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{w.body}</p>
                  <a className="mt-1 inline-block text-xs text-sky-ink hover:underline" href={`${API_URL}/api/demo/files/${w.file}`} download>Download sample</a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
      {!!stats?.analyzed && <NextStep to="/app" step={2} title="See the return analytics" body="Return rates, trends, breakdowns and what is rising against its baseline." />}
    </main>
  )
}

function QueueRow({ q }: { q: Pending }) {
  const r = q.result
  return (
    <div className="anim-fade px-5 py-3.5 text-[13px]">
      <div className="flex items-center gap-3">
        <Icon name="file" className="text-muted" />
        <span className="min-w-0 flex-1 truncate">{q.name}</span>
        {q.state === 'waiting' && <span className="text-xs text-faint">Waiting</span>}
        {q.state === 'uploading' && <span className="flex items-center gap-1.5 text-xs text-sky-ink"><Spinner size={12} />Reading and checking</span>}
        {q.state === 'error' && <span className="text-xs text-rose-ink">Failed</span>}
        {q.state === 'done' && r && <StatusChip s={r.status} />}
      </div>
      {q.error && <p className="mt-1.5 text-xs text-rose-ink">{q.error}</p>}
      {r && <UploadSummary u={r} />}
    </div>
  )
}

function HistoryRow({ u }: { u: UploadRecord }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="px-5 py-3 text-[13px]">
      <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="file" className="text-muted" />
        <span className="min-w-0 flex-1 truncate">{u.filename}</span>
        <span className="hidden text-xs text-faint sm:inline">{(u.kinds || []).map((k) => KIND_LABEL[k] || k).join(', ')} · {(u.rows_imported ?? 0).toLocaleString()} rows · {timeAgo(u.created_at)}</span>
        <StatusChip s={u.status} />
        <Icon name="chevronDown" size={14} className={cx('text-faint transition', open && 'rotate-180')} />
      </button>
      {open && <UploadSummary u={u} />}
    </div>
  )
}

function StatusChip({ s }: { s: UploadRecord['status'] }) {
  const map = { done: ['Imported', 'border-mint-ink/30 text-mint-ink'], partial: ['Imported with issues', 'border-butter-ink/30 text-butter-ink'], failed: ['Nothing imported', 'border-rose-ink/30 text-rose-ink'], processing: ['Processing', 'border-sky-ink/30 text-sky-ink'] }[s]
  return <span className={cx('chip flex-none py-0 text-[11px]', map[1])}>{map[0]}</span>
}

function UploadSummary({ u }: { u: UploadRecord }) {
  const issues = [...u.errors, ...u.warnings]
  return (
    <div className="anim-fade mt-2.5 pl-7 text-xs text-muted">
      <ul className="flex flex-col gap-0.5">
        {u.sheets.map((s, i) => (
          <li key={i}>
            <span className="text-body">{KIND_LABEL[s.kind] || s.kind}</span>
            {s.sheet && s.sheet !== 'csv' && s.sheet !== u.filename ? ` (sheet “${s.sheet}”)` : ''}: {s.imported.toLocaleString()} of {s.rows.toLocaleString()} rows imported
            {s.skipped ? `, ${s.skipped} skipped` : ''}{s.updated ? `, ${s.updated} already existed and were updated` : ''}
          </li>
        ))}
      </ul>
      {issues.length > 0 && (
        <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-line/[0.06] bg-line/[0.02] p-2.5">
          {issues.map((e, i) => (
            <li key={i} className={e.level === 'warning' ? 'text-butter-ink' : 'text-rose-ink'}>
              {e.row ? `Row ${e.row}` : 'File'}{e.sheet && e.sheet !== 'csv' ? ` (${e.sheet})` : ''}{e.field ? ` · ${e.field}` : ''}: <span className="text-body">{e.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
