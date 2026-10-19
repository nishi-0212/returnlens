/* Source evidence: clicking any record ID opens the original row (and its order and shipment). */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import type { RecordView } from '../lib/types'
import Icon from './Icon'
import { ErrorNote, Skeleton } from './ui'

const Ctx = createContext<(kind: string, id: string) => void>(() => {})
export const useRecord = () => useContext(Ctx)

const HIDE = new Set(['id', 'key', 'upload_id', 'created_at', 'updated_at', 'cluster_conf', 'cluster_method'])
const LABEL: Record<string, string> = { return: 'Return', review: 'Review', order: 'Order', inspection: 'Inspection', shipment: 'Shipment', change: 'Change', product: 'Product', batch: 'Batch' }

function Fields({ obj }: { obj: Record<string, unknown> | null | undefined }) {
  if (!obj) return null
  return (
    <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-4 gap-y-1.5 text-[13px]">
      {Object.entries(obj).filter(([k, v]) => !HIDE.has(k) && v !== null && v !== '' && v !== undefined).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-faint">{k.replace(/_/g, ' ')}</dt>
          <dd className="min-w-0 break-words text-body">{typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : String(v)}</dd>
        </div>
      ))}
    </dl>
  )
}

function Drawer({ kind, id, onClose }: { kind: string; id: string; onClose: () => void }) {
  const res = useAsync(() => api<RecordView>(`/api/records/${kind}/${encodeURIComponent(id)}`), [kind, id])
  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label={`${LABEL[kind] || kind} ${id}`}>
      <button type="button" aria-label="Close" className="anim-fade absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="anim-slide-in relative flex h-full w-full max-w-[460px] flex-col overflow-y-auto border-l border-line/[0.08] bg-panel2 p-6 shadow-pop">
        <div className="flex items-center gap-2">
          <span className="eyebrow">{LABEL[kind] || kind}</span>
          <span className="font-mono text-xs text-muted">{id}</span>
          <button type="button" className="btn-ghost ml-auto px-2" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <p className="mt-1 text-xs text-faint">The original uploaded record behind this piece of evidence.</p>
        {res.error && <div className="mt-4"><ErrorNote message={res.error} /></div>}
        {!res.data && !res.error && <div className="mt-4 flex flex-col gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-5" />)}</div>}
        {res.data && (
          <div className="mt-4 flex flex-col gap-5">
            <Fields obj={res.data.record} />
            {res.data.order && <div><div className="eyebrow mb-2">Linked order</div><Fields obj={res.data.order} /></div>}
            {res.data.shipment && <div><div className="eyebrow mb-2">Linked shipment</div><Fields obj={res.data.shipment} /></div>}
          </div>
        )}
      </div>
    </div>
  )
}

export function RecordProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<{ kind: string; id: string } | null>(null)
  const show = useCallback((kind: string, id: string) => setOpen({ kind, id }), [])
  return (
    <Ctx.Provider value={show}>
      {children}
      {open && <Drawer kind={open.kind} id={open.id} onClose={() => setOpen(null)} />}
    </Ctx.Provider>
  )
}

/** A clickable record ID chip. */
export function RecordLink({ kind, id, label }: { kind: string; id: string; label?: string }) {
  const show = useRecord()
  return (
    <button type="button" onClick={() => show(kind, id)} title={`Open ${LABEL[kind] || kind} ${id}`}
      className="inline-flex items-center gap-1 rounded-md border border-line/[0.08] bg-line/[0.03] px-1.5 py-px font-mono text-[11px] text-muted transition hover:border-sky-ink/40 hover:text-sky-ink">
      {label || id}
    </button>
  )
}
