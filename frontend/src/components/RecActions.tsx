/* Approve / reject / complete a recommendation, and edit its owner and deadline. Shared by the
   investigation page and the actions board. */
import { useState } from 'react'
import { api } from '../lib/api'
import { cx, longDate, REC_STATUS_LABEL } from '../lib/format'
import { useJobs } from '../lib/jobs'
import { useWorkspaces } from '../lib/workspaces'
import { useToast } from '../lib/toast'
import type { RecStatus, Recommendation } from '../lib/types'
import Icon from './Icon'
import { Spinner } from './ui'

const today = () => new Date().toISOString().slice(0, 10)

export function RecStatusChip({ s }: { s: RecStatus }) {
  const cls = { proposed: 'bg-sky text-onpastel', approved: 'bg-butter text-onpastel',
    completed: 'bg-mint text-onpastel', rejected: 'border border-dashed border-line/25 text-faint' }[s]
  const icon = { proposed: 'sparkle', approved: 'check', completed: 'check', rejected: 'x' }[s] as 'check'
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium', cls)}><Icon name={icon} size={11} strokeWidth={2.4} />{REC_STATUS_LABEL[s]}</span>
}

export default function RecActions({ rec, onChanged, compact }: { rec: Recommendation; onChanged: (r: Recommendation) => void; compact?: boolean }) {
  const toast = useToast()
  const { refresh } = useJobs()
  const { refresh: refreshWorkspaces } = useWorkspaces()
  const [busy, setBusy] = useState<string | null>(null)
  const [completing, setCompleting] = useState(false)
  const [date, setDate] = useState(today())

  const patch = async (body: Record<string, unknown>, label: string, msg?: string) => {
    setBusy(label)
    try {
      const r = await api<Recommendation>(`/api/recommendations/${rec.id}`, { method: 'PATCH', body })
      onChanged(r)
      refreshWorkspaces().catch(() => {})
      if (body.status === 'completed') refresh()
      if (msg) toast.push('success', msg)
      setCompleting(false)
    } catch (e) {
      toast.push('error', 'Could not update', (e as Error).message)
    } finally { setBusy(null) }
  }

  const btn = (label: string, body: Record<string, unknown>, cls: string, icon: 'check' | 'x' | 'refresh', msg: string) => (
    <button type="button" className={cls} disabled={!!busy} onClick={() => patch(body, label, msg)}>
      {busy === label ? <Spinner /> : <Icon name={icon} size={13} strokeWidth={2.2} />}{label}
    </button>
  )

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {rec.status === 'proposed' && <>
          {btn('Approve', { status: 'approved' }, 'btn-mint', 'check', `Approved: ${rec.title}`)}
          {btn('Reject', { status: 'rejected' }, 'btn', 'x', 'Rejected')}
        </>}
        {rec.status === 'approved' && <>
          <button type="button" className="btn-mint" onClick={() => setCompleting((c) => !c)} disabled={!!busy}><Icon name="check" size={13} strokeWidth={2.2} />Mark completed</button>
          {btn('Reject', { status: 'rejected' }, 'btn', 'x', 'Rejected')}
        </>}
        {rec.status === 'completed' && <>
          <span className="text-xs text-muted">Implemented {longDate(rec.implemented_at)}</span>
          <button type="button" className="btn-ghost text-xs" onClick={() => { setDate((rec.implemented_at || today()).slice(0, 10)); setCompleting((c) => !c) }}>Change date</button>
          {btn('Reopen', { status: 'approved' }, 'btn-ghost text-xs', 'refresh', 'Reopened')}
        </>}
        {rec.status === 'rejected' && btn('Restore', { status: 'proposed' }, 'btn', 'refresh', 'Restored')}
      </div>
      {completing && (
        <div className="anim-fade flex flex-wrap items-end gap-2 rounded-lg border border-line/[0.07] bg-line/[0.02] p-3">
          <label className="flex flex-col gap-1 text-xs text-muted">When did this go live?
            <input type="date" className="input h-8 w-[150px] py-0 text-xs" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
          </label>
          <button type="button" className="btn-primary" disabled={!!busy || !date}
            onClick={() => patch(rec.status === 'completed' ? { implemented_at: date } : { status: 'completed', implemented_at: date }, 'Save',
              'Saved. The before/after check uses this date.')}>
            {busy === 'Save' ? <Spinner /> : null}Save
          </button>
          <p className="basis-full text-[11px] text-faint">The before/after check compares orders placed before and after this date.</p>
        </div>
      )}
      {!compact && rec.status !== 'rejected' && (
        <div className="flex flex-wrap gap-3 text-xs">
          <label className="flex items-center gap-1.5 text-muted">Owner
            <input className="input h-7 w-[170px] py-0 text-xs" defaultValue={rec.owner} aria-label="Owner"
              onBlur={(e) => e.target.value.trim() && e.target.value !== rec.owner && patch({ owner: e.target.value.trim() }, 'owner', 'Owner updated')} />
          </label>
          <label className="flex items-center gap-1.5 text-muted">Due
            <input type="date" className="input h-7 w-[140px] py-0 text-xs" defaultValue={rec.due_date} aria-label="Due date"
              onBlur={(e) => e.target.value && e.target.value !== rec.due_date && patch({ due_date: e.target.value }, 'due', 'Deadline updated')} />
          </label>
        </div>
      )}
    </div>
  )
}
