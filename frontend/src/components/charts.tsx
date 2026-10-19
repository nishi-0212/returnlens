/* ReturnLens's charts. Colours come from the shared pastel palette (the "-ink" tones for marks, the pastel
   fills for chips); recorded vs estimated is told apart by solid vs dashed, never colour alone.
   Every chart has an accessible label and, where it matters, a "Table" view through ChartCard. */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { cx, shortDate } from '../lib/format'
import type { DayPoint, FindingStatus, Flow } from '../lib/types'

/* ------------------------------------------------------------------ helpers */

export const ink = (tone: string, a?: number) => (a === undefined ? `rgb(var(--${tone}-ink))` : `rgb(var(--${tone}-ink) / ${a})`)
export const STATUS_TONE: Record<FindingStatus, string> = { confirmed: 'rose', likely: 'butter', possible: 'mist' }
const TEXT = 'rgb(var(--text))'
const MUTED = 'rgb(var(--muted))'
const FAINT = 'rgb(var(--faint))'
const LINE = 'rgb(var(--ink) / .07)'
const LINE2 = 'rgb(var(--ink) / .14)'

function useWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(600)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver((e) => setW(Math.max(260, Math.floor(e[0].contentRect.width))))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p
}

function Tip({ x, y, w, children }: { x: number; y: number; w: number; children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute z-10 min-w-[150px] rounded-lg border border-line/10 bg-panel2 px-3 py-2 text-xs shadow-pop"
      style={{ left: Math.min(Math.max(0, x + 14), Math.max(0, w - 180)), top: Math.max(0, y - 10) }}>{children}</div>
  )
}

/** Decorative concentric lens rings for page backgrounds. */
export function LensRings({ className, size = 760 }: { className?: string; size?: number }) {
  const c = size / 2
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cx('pointer-events-none absolute', className)}>
      <circle cx={c} cy={c} r={size * 0.2} fill="none" stroke={LINE2} />
      <circle cx={c} cy={c} r={size * 0.29} fill="none" stroke={LINE} />
      <circle className="anim-turn" cx={c} cy={c} r={size * 0.38} fill="none" stroke={ink('sky', 0.35)} strokeDasharray="2 10" />
      <circle cx={c} cy={c} r={size * 0.47} fill="none" stroke={LINE} />
    </svg>
  )
}

/* ------------------------------------------------------------------ line (time series) */

export interface LinePoint { x: string; y: number; dim?: boolean; extra?: ReactNode }

/** One series over time as a dotted path with a crosshair; `marker` draws a labelled date (e.g. a fix). */
export function LineChart({ points, format, height = 200, marker, shadeAfter, label, tone = 'sky' }: {
  points: LinePoint[]; format: (v: number) => string; height?: number
  marker?: { x: string; label: string }; shadeAfter?: string; label: string; tone?: string
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const pad = { l: 44, r: 12, t: 14, b: 26 }
  const iw = w - pad.l - pad.r
  const ih = height - pad.t - pad.b
  const max = niceMax(Math.max(...points.map((p) => p.y), 0.0001) * 1.1)
  const X = (i: number) => pad.l + (points.length <= 1 ? iw / 2 : (i / (points.length - 1)) * iw)
  const Y = (v: number) => pad.t + ih - (v / max) * ih
  const ticks = [0, 0.5, 1].map((t) => t * max)
  const markerI = marker ? nearestIndex(points, marker.x) : -1
  const shadeI = shadeAfter ? nearestIndex(points, shadeAfter) : -1
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(iw / 70))))
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ')
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(((x - pad.l) / Math.max(1, iw)) * (points.length - 1)))))
  }
  const hp = hover !== null ? points[hover] : null
  return (
    <div ref={ref} className="relative" role="img" aria-label={label}>
      <svg width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="block select-none">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={Y(t)} y2={Y(t)} stroke={LINE} />
            <text x={pad.l - 8} y={Y(t) + 4} textAnchor="end" fill={FAINT} fontSize={10}>{format(t)}</text>
          </g>
        ))}
        {shadeI >= 0 && <rect x={X(shadeI)} y={pad.t} width={Math.max(0, w - pad.r - X(shadeI))} height={ih} fill={ink(tone, 0.06)} />}
        <path d={d} fill="none" stroke={ink(tone, 0.5)} strokeWidth={1.5} strokeLinejoin="round" />
        {points.map((p, i) => <circle key={i} cx={X(i)} cy={Y(p.y)} r={p.dim ? 2.5 : 3.2} fill={p.dim ? 'rgb(var(--panel))' : ink(tone)} stroke={ink(tone)} strokeWidth={p.dim ? 1.2 : 0} />)}
        {markerI >= 0 && (
          <g>
            <line x1={X(markerI)} x2={X(markerI)} y1={pad.t - 4} y2={pad.t + ih} stroke={ink('mint')} strokeDasharray="3 4" strokeWidth={1.5} />
            <text x={X(markerI) + 6} y={pad.t + 6} fill={ink('mint')} fontSize={10} fontWeight={500}>{marker!.label}</text>
          </g>
        )}
        {points.map((p, i) => (i % labelEvery === 0 || i === points.length - 1) && (
          <text key={`l${i}`} x={X(i)} y={height - 8} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} fill={FAINT} fontSize={10}>{shortDate(p.x)}</text>
        ))}
        {hp && hover !== null && <circle cx={X(hover)} cy={Y(hp.y)} r={7} fill="none" stroke={ink(tone)} strokeWidth={1.5} pointerEvents="none" />}
      </svg>
      {hp && hover !== null && (
        <Tip x={X(hover)} y={6} w={w}>
          <div className="text-faint">Week of {shortDate(hp.x)}</div>
          <div className="mt-0.5 text-sm font-medium text-text">{format(hp.y)}</div>
          {hp.extra && <div className="mt-1 text-muted">{hp.extra}</div>}
          {hp.dim && <div className="mt-1 text-faint">Still collecting returns</div>}
        </Tip>
      )}
    </div>
  )
}

function nearestIndex(points: LinePoint[], x: string): number {
  const t = new Date(x).getTime()
  let best = -1, d = Infinity
  points.forEach((p, i) => { const dd = Math.abs(new Date(p.x).getTime() - t); if (dd < d) { d = dd; best = i } })
  return best
}

/* ------------------------------------------------------------------ lollipops (ranked list) */

export interface BarRow { key: string; label: string; value: number; sub?: string; flag?: ReactNode; to?: string; tip?: ReactNode }

/** Ranked values as lollipops: a thin stem and a dot at the value. */
export function BarList({ rows, format, max, onSelect, empty = 'Nothing to show', tone = 'sky' }: {
  rows: BarRow[]; format: (v: number) => string; max?: number; onSelect?: (r: BarRow) => void; empty?: string; tone?: string
}) {
  const m = max ?? Math.max(...rows.map((r) => r.value), 0)
  if (!rows.length) return <p className="py-6 text-center text-sm text-faint">{empty}</p>
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((r, i) => {
        const p = m ? Math.max(1, (r.value / m) * 100) : 0
        const inner = (
          <div className="grid grid-cols-[minmax(120px,32%)_1fr_auto] items-center gap-3 py-1.5">
            <span className="min-w-0">
              <span className="block truncate text-[13px] text-body">{r.label}</span>
              {r.sub && <span className="block truncate text-[11px] text-faint">{r.sub}</span>}
            </span>
            <span className="relative h-4">
              <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line/[0.07]" />
              <span className="anim-develop absolute top-1/2 h-[2px] -translate-y-1/2 rounded" style={{ width: `${p}%`, background: ink(tone, 0.45), animationDelay: `${i * 0.03}s` }} />
              <span className="anim-develop absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${p}%`, background: ink(tone), animationDelay: `${0.1 + i * 0.03}s` }} />
            </span>
            <span className="flex items-center gap-2 text-[13px] font-medium tabular-nums text-text">{r.flag}{format(r.value)}</span>
          </div>
        )
        return (
          <li key={r.key} title={typeof r.tip === 'string' ? r.tip : undefined}>
            {onSelect ? <button type="button" onClick={() => onSelect(r)} className="block w-full rounded-md px-1 text-left transition hover:bg-line/[0.03]">{inner}</button> : inner}
          </li>
        )
      })}
    </ul>
  )
}

/* ------------------------------------------------------------------ waffle (recorded vs estimated) */

/** 20 squares: solid = recorded, dashed = estimated. Replaces a split bar. */
export function Waffle({ actual, estimated, format, cells = 20, size = 11, legend = true, tone = 'sky' }: {
  actual: number; estimated: number; format: (v: number) => string; cells?: number; size?: number; legend?: boolean; tone?: string
}) {
  const total = actual + estimated
  const solid = total ? Math.round((actual / total) * cells) : 0
  return (
    <div>
      <div role="img" aria-label={`Recorded ${format(actual)}, estimated ${format(estimated)}`} className="grid w-max gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${Math.min(10, cells)}, ${size}px)` }}>
        {Array.from({ length: cells }, (_, i) => (
          <span key={i} className="anim-develop box-border rounded-[3px]" style={{ width: size, height: size, animationDelay: `${i * 0.02}s`,
            ...(i < solid ? { background: ink(tone) } : { border: `1.5px dashed ${ink(tone)}` }) }} />
        ))}
      </div>
      {legend && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: ink(tone) }} />Recorded · {format(actual)}</span>
          <span className="inline-flex items-center gap-1.5"><span className="box-border h-2.5 w-2.5 rounded-[3px]" style={{ border: `1.5px dashed ${ink(tone)}` }} />Estimated · {format(estimated)}</span>
        </div>
      )}
    </div>
  )
}
/** Kept for older call sites. */
export const SplitBar = Waffle

export function Legend({ items }: { items: { label: string; cls?: string; color?: string; dashed?: boolean }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((x) => (
        <span key={x.label} className="inline-flex items-center gap-1.5">
          <span className={cx('box-border h-2.5 w-2.5 rounded-full', x.cls)} style={x.dashed ? { border: `1.5px dashed ${x.color}` } : x.color ? { background: x.color } : undefined} />{x.label}
        </span>
      ))}
    </div>
  )
}

/** A week-by-week pulse: one dot per week, bigger = more. */
export function Spark({ values, height = 30, tone = 'sky' }: { values: number[]; height?: number; tone?: string }) {
  const mx = Math.max(...values, 1)
  const n = Math.max(values.length, 1)
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${n * 10} ${height}`} preserveAspectRatio="none" aria-hidden="true" className="block">
      {values.map((v, i) => {
        const r = 1 + (v / mx) * 4
        return <circle key={i} cx={i * 10 + 5} cy={height - 4 - (v / mx) * (height - 12)} r={r} fill={ink(tone, 0.25 + 0.75 * (v / mx))} />
      })}
    </svg>
  )
}

/* ------------------------------------------------------------------ gauge */

/** Half-dial: the arc is the current value, the tick is normal (the baseline). */
export function Gauge({ value, baseline, label, tone = 'rose', width = 112 }: { value: number; baseline?: number | null; label: string; tone?: string; width?: number }) {
  const max = Math.max(value, baseline || 0) * 1.6 || 1
  const r = 48, cx = 56, cy = 58
  const pt = (f: number) => { const a = Math.PI * (1 - Math.min(1, f)); return [cx + r * Math.cos(a), cy - r * Math.sin(a)] }
  const [ex, ey] = pt(value / max)
  const large = 0
  const b = baseline != null ? pt(baseline / max) : null
  return (
    <svg width={width} height={width * 0.58} viewBox="0 0 112 65" role="img" aria-label={label} className="flex-none">
      <path d={`M8 58a48 48 0 0196 0`} fill="none" stroke={LINE2} strokeWidth={9} strokeLinecap="round" />
      <path d={`M8 58A48 48 0 ${large} 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`} fill="none" stroke={ink(tone)} strokeWidth={9} strokeLinecap="round" className="anim-trace" style={{ ['--len' as string]: 160 } as CSSProperties} />
      {b && <line x1={b[0]} y1={b[1]} x2={cx + (b[0] - cx) * 0.72} y2={cy + (b[1] - cy) * 0.72} stroke={TEXT} strokeWidth={2} />}
    </svg>
  )
}

/* ------------------------------------------------------------------ calendar heatmap */

/** One square per order day, darker = more of that day's orders came back. */
export function Heatmap({ days, format, tone = 'rose', label }: { days: DayPoint[]; format: (v: number) => string; tone?: string; label: string }) {
  const [hover, setHover] = useState<{ d: DayPoint; x: number; y: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const { weeks, bins, months } = useMemo(() => {
    if (!days.length) return { weeks: [] as (DayPoint | null)[][], bins: [0, 0, 0, 0], months: [] as string[] }
    const settled = days.filter((d) => !d.maturing && d.units >= 5)
    const tot = settled.reduce((a, d) => a + d.units, 0) || 1
    const mean = settled.reduce((a, d) => a + d.returned, 0) / tot
    const bins = [0.7, 0.95, 1.2, 1.5].map((k) => k * mean)
    const byDate = new Map(days.map((d) => [d.date, d]))
    const first = new Date(days[0].date + 'T00:00:00Z')
    const start = new Date(first); start.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7))
    const last = new Date(days[days.length - 1].date + 'T00:00:00Z')
    const weeks: (DayPoint | null)[][] = []
    const months: string[] = []
    for (let t = new Date(start); t <= last; t.setUTCDate(t.getUTCDate() + 7)) {
      const col: (DayPoint | null)[] = []
      let month = ''
      for (let k = 0; k < 7; k++) {
        const d = new Date(t); d.setUTCDate(t.getUTCDate() + k)
        const iso = d.toISOString().slice(0, 10)
        if (d.getUTCDate() === 1 || (weeks.length === 0 && k === 0)) month = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
        col.push(byDate.get(iso) || null)
      }
      weeks.push(col); months.push(month)
    }
    return { weeks, bins, months }
  }, [days])
  const level = (d: DayPoint) => (d.rate < bins[0] ? 0 : d.rate < bins[1] ? 1 : d.rate < bins[2] ? 2 : d.rate < bins[3] ? 3 : 4)
  const alpha = [0.07, 0.2, 0.36, 0.58, 0.88]
  if (!weeks.length) return <p className="py-6 text-center text-sm text-faint">No orders in this view</p>
  return (
    <div>
      <div ref={boxRef} className="relative overflow-x-auto pb-1" onMouseLeave={() => setHover(null)}>
        <div className="flex w-max gap-2">
          <div className="grid grid-rows-[16px_repeat(7,13px)] gap-y-[3px] font-mono text-[10px] text-faint">
            <span /><span>Mon</span><span /><span>Wed</span><span /><span>Fri</span><span /><span>Sun</span>
          </div>
          <div role="img" aria-label={label} className="flex gap-[3px]">
            {weeks.map((col, w) => (
              <div key={w} className="grid grid-rows-[16px_repeat(7,13px)] gap-y-[3px]">
                <span className="whitespace-nowrap font-mono text-[10px] text-faint">{months[w]}</span>
                {col.map((d, k) => d ? (
                  <span key={k} className="anim-develop box-border h-[13px] w-[13px] rounded-[3px]"
                    onMouseEnter={(e) => { const b = boxRef.current!.getBoundingClientRect(); const c = e.currentTarget.getBoundingClientRect(); setHover({ d, x: c.left - b.left, y: c.top - b.top }) }}
                    style={{ animationDelay: `${Math.min(w, 60) * 0.02}s`, opacity: d.maturing ? 0.45 : 1,
                      ...(d.units < 5 ? { border: `1px dashed ${LINE2}` } : { background: ink(tone, alpha[level(d)]) }) }} />
                ) : <span key={k} className="h-[13px] w-[13px]" />)}
              </div>
            ))}
          </div>
        </div>
        {hover && (
          <Tip x={hover.x} y={hover.y + 18} w={boxRef.current?.clientWidth || 600}>
            <div className="text-faint">{new Date(hover.d.date + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}</div>
            <div className="mt-0.5 text-sm font-medium text-text">{format(hover.d.rate)}</div>
            <div className="mt-0.5 text-muted">{hover.d.returned} of {hover.d.units} units came back</div>
            {hover.d.maturing && <div className="mt-0.5 text-faint">Still collecting returns</div>}
          </Tip>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
        <span className="inline-flex items-center gap-1">Under {format(bins[0])}
          {alpha.map((a) => <span key={a} className="h-3 w-3 rounded-[3px]" style={{ background: ink(tone, a) }} />)}Over {format(bins[3])}</span>
        <span>Faded = orders under 14 days old</span>
        <span className="inline-flex items-center gap-1"><span className="box-border h-3 w-3 rounded-[3px]" style={{ border: `1px dashed ${LINE2}` }} />Under 5 units</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ flow (complaint → cause) */

const SOURCE_TONES = ['rose', 'sky', 'butter', 'blush', 'mist', 'mint']

/** Complaints on the left flowing into the root cause they were traced to on the right. */
export function FlowChart({ flows, label, onPick }: { flows: Flow[]; label: string; onPick?: (findingId: string) => void }) {
  const W = 720, H = 300, NW = 12, GAP = 10, LX = 170, RX = W - 190
  const layout = useMemo(() => {
    const sum = (k: 'source' | 'target') => {
      const m = new Map<string, { key: string; label: string; total: number; status?: FindingStatus | null; fid?: string | null }>()
      flows.forEach((f) => {
        const key = f[k]
        const e = m.get(key) || { key, label: k === 'source' ? f.source_label : f.target_label, total: 0, status: k === 'target' ? f.target_status : undefined, fid: k === 'target' ? f.finding_id : undefined }
        e.total += f.returns; m.set(key, e)
      })
      const arr = [...m.values()].sort((a, b) => b.total - a.total)
      const tail = (x: { key: string }) => (x.key === 'other' ? 1 : x.key === 'none' ? 2 : 0)
      return arr.sort((a, b) => tail(a) - tail(b) || b.total - a.total)
    }
    const S = sum('source'), T = sum('target')
    const total = flows.reduce((a, f) => a + f.returns, 0) || 1
    const scale = (H - GAP * (Math.max(S.length, T.length) - 1)) / total
    const place = (arr: typeof S) => { let y = 0; return arr.map((n) => { const o = { ...n, y, h: Math.max(2, n.total * scale) }; y += o.h + GAP; return o }) }
    const sN = place(S), tN = place(T)
    const sOff = new Map(sN.map((n) => [n.key, n.y])), tOff = new Map(tN.map((n) => [n.key, n.y]))
    const tIdx = new Map(tN.map((n, i) => [n.key, i])), sIdx = new Map(sN.map((n, i) => [n.key, i]))
    const ordered = [...flows].sort((a, b) => (sIdx.get(a.source)! - sIdx.get(b.source)!) || (tIdx.get(a.target)! - tIdx.get(b.target)!))
    const bands = ordered.map((f) => {
      const h = Math.max(1, f.returns * scale)
      const y0 = sOff.get(f.source)!; sOff.set(f.source, y0 + h)
      return { f, h, y0, tone: SOURCE_TONES[sIdx.get(f.source)! % SOURCE_TONES.length] }
    })
    const byTarget = [...bands].sort((a, b) => (tIdx.get(a.f.target)! - tIdx.get(b.f.target)!) || (sIdx.get(a.f.source)! - sIdx.get(b.f.source)!))
    byTarget.forEach((b) => { const r0 = tOff.get(b.f.target)!; (b as typeof b & { r0: number }).r0 = r0; tOff.set(b.f.target, r0 + b.h) })
    return { sN, tN, bands: bands as (typeof bands[number] & { r0: number })[] }
  }, [flows])
  if (!flows.length) return <p className="py-6 text-center text-sm text-faint">No product complaints traced yet</p>
  const mid = (LX + NW + RX) / 2
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H + 20}`} width="100%" role="img" aria-label={label} className="block min-w-[560px]">
        <g transform="translate(0,10)">
          {layout.bands.map((b, i) => (
            <path key={i} className="transition-opacity hover:opacity-80" opacity={b.f.target === 'none' || b.f.target === 'other' ? 0.16 : 0.34} fill={ink(b.tone)}
              d={`M${LX + NW},${b.y0} C${mid},${b.y0} ${mid},${b.r0} ${RX},${b.r0} L${RX},${b.r0 + b.h} C${mid},${b.r0 + b.h} ${mid},${b.y0 + b.h} ${LX + NW},${b.y0 + b.h} Z`}>
              <title>{`${b.f.source_label} → ${b.f.target_label}: ${b.f.returns} returns`}</title>
            </path>
          ))}
          {layout.sN.map((n, i) => (
            <g key={n.key}>
              <rect x={LX} y={n.y} width={NW} height={n.h} rx={3} fill={ink(SOURCE_TONES[i % SOURCE_TONES.length])} />
              <text x={LX - 8} y={n.y + n.h / 2 + 4} textAnchor="end" fontSize={12} fill={TEXT}>{trunc(n.label, 24)} · {n.total}</text>
            </g>
          ))}
          {layout.tN.map((n) => {
            const muted = n.key === 'none' || n.key === 'other'
            return (
              <g key={n.key} className={cx(n.fid && onPick && 'cursor-pointer')} onClick={() => n.fid && onPick?.(n.fid)}>
                <rect x={RX} y={n.y} width={NW} height={n.h} rx={3} fill={muted ? 'rgb(var(--dim))' : TEXT} opacity={muted ? 0.8 : 0.85} />
                <text x={RX + NW + 8} y={n.y + n.h / 2 + (n.status ? 0 : 4)} fontSize={12} fontWeight={muted ? 400 : 600} fill={muted ? MUTED : TEXT}>{trunc(n.label, 26)}</text>
                {n.status && <text x={RX + NW + 8} y={n.y + n.h / 2 + 14} fontSize={11} fill={MUTED}>{n.status} · {n.total}</text>}
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}

function trunc(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + '…' : s }

/* ------------------------------------------------------------------ bubbles (strength × cost) */

export interface BubblePoint { id: string; label: string; lift: number; cost: number; returns: number; status: FindingStatus }

/** Each case as a bubble: right = further above normal (log scale), up = costs more a month, size = returns. */
export function BubbleChart({ points, format, label, onPick, height = 300 }: {
  points: BubblePoint[]; format: (v: number) => string; label: string; onPick?: (id: string) => void; height?: number
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<BubblePoint | null>(null)
  const pad = { l: 50, r: 20, t: 20, b: 34 }
  const pts = points.filter((p) => p.lift > 0)
  if (!pts.length) return <p className="py-6 text-center text-sm text-faint">No cases to plot yet</p>
  const maxLift = Math.min(100, Math.max(2, Math.max(...pts.map((p) => p.lift)) * 1.3))
  const lx = (v: number) => Math.log(Math.max(1, Math.min(v, maxLift)))
  const X = (v: number) => pad.l + (lx(v) / lx(maxLift)) * (w - pad.l - pad.r)
  const ymax = niceMax(Math.max(...pts.map((p) => p.cost), 1) * 1.15)
  const Y = (v: number) => pad.t + (height - pad.t - pad.b) * (1 - v / ymax)
  const rmax = Math.max(...pts.map((p) => p.returns), 1)
  const R = (n: number) => 6 + Math.sqrt(n / rmax) * 18
  const xt = [1, 2, 5, 10, 20, 50].filter((t) => t <= maxLift)
  const top = [...pts].sort((a, b) => b.cost - a.cost).slice(0, 4).map((p) => p.id)
  return (
    <div ref={ref} className="relative" role="img" aria-label={label}>
      <svg width={w} height={height} className="block" onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}><line x1={pad.l} x2={w - pad.r} y1={Y(t * ymax)} y2={Y(t * ymax)} stroke={t ? LINE : LINE2} />
            <text x={pad.l - 8} y={Y(t * ymax) + 4} textAnchor="end" fontSize={10} fill={FAINT}>{format(t * ymax)}</text></g>
        ))}
        {xt.map((t) => <text key={t} x={X(t)} y={height - 14} textAnchor="middle" fontSize={10} fill={FAINT}>{t}×</text>)}
        <text x={w - pad.r} y={height - 2} textAnchor="end" fontSize={10} fill={FAINT}>times the normal rate →</text>
        {[...pts].sort((a, b) => b.returns - a.returns).map((p) => {
          const tone = STATUS_TONE[p.status]
          return (
            <g key={p.id} className={cx(onPick && 'cursor-pointer')} onClick={() => onPick?.(p.id)} onMouseEnter={() => setHover(p)}>
              {p.status === 'confirmed' && p.id === top[0] && <circle className="anim-ring" cx={X(p.lift)} cy={Y(p.cost)} r={R(p.returns)} fill="none" stroke={ink(tone, 0.6)} />}
              <circle className="anim-develop transition-transform" cx={X(p.lift)} cy={Y(p.cost)} r={R(p.returns)}
                fill={p.status === 'possible' ? 'transparent' : ink(tone, 0.25)} stroke={ink(tone)} strokeWidth={hover?.id === p.id ? 2.5 : 1.5}
                strokeDasharray={p.status === 'possible' ? '3 2' : undefined} />
              {top.includes(p.id) && (
                <text x={X(p.lift) + R(p.returns) + 6} y={Y(p.cost) + 4} fontSize={12} fill={TEXT} fontWeight={500}>{trunc(p.label, 30)}</text>
              )}
            </g>
          )
        })}
      </svg>
      {hover && (
        <Tip x={X(hover.lift)} y={Y(hover.cost)} w={w}>
          <div className="font-medium text-text">{hover.label}</div>
          <div className="mt-1 text-muted">{hover.lift.toFixed(1)}× normal · {format(hover.cost)} a month · {hover.returns} returns</div>
          <div className="mt-0.5 capitalize text-faint">{hover.status}</div>
        </Tip>
      )}
      <Legend items={[{ label: 'Confirmed', color: ink('rose') }, { label: 'Likely', color: ink('butter') }, { label: 'Possible', color: ink('mist'), dashed: true }]} />
    </div>
  )
}

/* ------------------------------------------------------------------ waterfall (cost build-up) */

export interface CostStep { key: string; label: string; actual: number; estimated: number }

/** Each cost line stacked on the last, recorded part solid and estimated part dashed, ending in the total. */
export function Waterfall({ steps, format, label, totalLabel = 'Total' }: { steps: CostStep[]; format: (v: number) => string; label: string; totalLabel?: string }) {
  const W = 560, H = 250, base = 200, top = 22
  const rows = steps.filter((s) => s.actual + s.estimated > 0)
  const total = rows.reduce((a, s) => a + s.actual + s.estimated, 0)
  if (!total) return <p className="py-6 text-center text-sm text-faint">No costs in this view</p>
  const k = (base - top) / total
  const n = rows.length + 1
  const slot = (W - 20) / n
  const bw = Math.min(56, slot * 0.62)
  let cum = 0
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} className="block">
      <line x1={10} y1={base} x2={W - 10} y2={base} stroke={LINE2} />
      {rows.map((s, i) => {
        const x = 10 + i * slot + (slot - bw) / 2
        const yA = base - (cum + s.actual) * k
        const yE = base - (cum + s.actual + s.estimated) * k
        const yStart = base - cum * k
        cum += s.actual + s.estimated
        return (
          <g key={s.key} className="anim-develop" style={{ animationDelay: `${i * 0.08}s`, transformOrigin: `${x + bw / 2}px ${yStart}px` }}>
            <title>{`${s.label}: ${format(s.actual)} recorded, ${format(s.estimated)} estimated`}</title>
            {s.actual > 0 && <rect x={x} y={yA} width={bw} height={Math.max(1, yStart - yA)} rx={3} fill={ink('sky', 0.85)} />}
            {s.estimated > 0 && <rect x={x + 0.75} y={yE} width={bw - 1.5} height={Math.max(1, yA - yE)} rx={3} fill={ink('sky', 0.12)} stroke={ink('sky')} strokeDasharray="4 3" />}
            <line x1={x + bw} x2={x + slot} y1={yE} y2={yE} stroke="rgb(var(--dim))" strokeDasharray="2 3" />
            <text x={x + bw / 2} y={yE - 6} textAnchor="middle" fontSize={11} fill={TEXT} className="tabular-nums">{format(s.actual + s.estimated)}</text>
            <text x={x + bw / 2} y={base + 16} textAnchor="middle" fontSize={11} fill={MUTED}>{trunc(s.label, 14)}</text>
          </g>
        )
      })}
      {(() => {
        const x = 10 + rows.length * slot + (slot - bw) / 2
        return (
          <g className="anim-develop" style={{ animationDelay: `${rows.length * 0.08}s` }}>
            <rect x={x} y={base - total * k} width={bw} height={total * k} rx={3} fill={TEXT} opacity={0.85} />
            <text x={x + bw / 2} y={base - total * k - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill={TEXT}>{format(total)}</text>
            <text x={x + bw / 2} y={base + 16} textAnchor="middle" fontSize={11} fontWeight={600} fill={TEXT}>{totalLabel}</text>
          </g>
        )
      })()}
      <g fontSize={11} fill={MUTED}>
        <rect x={10} y={H - 18} width={10} height={10} rx={2} fill={ink('sky', 0.85)} /><text x={26} y={H - 9}>Recorded</text>
        <rect x={100} y={H - 18} width={10} height={10} rx={2} fill={ink('sky', 0.12)} stroke={ink('sky')} strokeDasharray="3 2" /><text x={116} y={H - 9}>Estimated</text>
      </g>
    </svg>
  )
}

/* ------------------------------------------------------------------ dumbbell (before → now) */

export interface DumbbellRow { key: string; label: string; from: number; to: number; sub?: string; onClick?: () => void }

/** ○ before, ● now, joined; rose when it went up, mint when it came down. */
export function Dumbbell({ rows, format, empty = 'Nothing unusual' }: { rows: DumbbellRow[]; format: (v: number) => string; empty?: string }) {
  if (!rows.length) return <p className="py-6 text-sm text-muted">{empty}</p>
  const max = Math.max(...rows.flatMap((r) => [r.from, r.to]), 0.0001) * 1.12
  const P = (v: number) => `${(v / max) * 100}%`
  return (
    <ul className="flex flex-col">
      {rows.map((r) => {
        const up = r.to > r.from
        const c = up ? ink('rose') : ink('mint')
        const body = (
          <div className="grid grid-cols-[minmax(130px,30%)_1fr_104px] items-center gap-4 border-b border-line/[0.05] py-2.5 text-left">
            <span className="min-w-0"><span className="block truncate text-[13px] text-body">{r.label}</span>{r.sub && <span className="block truncate text-[11px] text-faint">{r.sub}</span>}</span>
            <span className="relative h-5">
              <span className="absolute inset-x-0 top-[9px] h-[2px] rounded bg-line/[0.06]" />
              <span className="absolute top-[8px] h-1 rounded" style={{ left: P(Math.min(r.from, r.to)), width: `${(Math.abs(r.to - r.from) / max) * 100}%`, background: c, opacity: 0.45 }} />
              <span className="absolute top-[3px] box-border h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 bg-panel" style={{ left: P(r.from), borderColor: 'rgb(var(--muted))' }} />
              <span className="anim-develop absolute top-[3px] h-3.5 w-3.5 -translate-x-1/2 rounded-full" style={{ left: P(r.to), background: c }} />
            </span>
            <span className="text-right font-mono text-xs tabular-nums" style={{ color: c }}>{format(r.from)} → {format(r.to)}</span>
          </div>
        )
        return <li key={r.key}>{r.onClick ? <button type="button" className="block w-full transition hover:bg-line/[0.02]" onClick={r.onClick}>{body}</button> : body}</li>
      })}
    </ul>
  )
}

/* ------------------------------------------------------------------ dot strip (one group vs its peers) */

export interface StripRow { value: string; rate: number; units: number; highlight: boolean }

/** Every peer placed on one axis by its rate; the group under investigation is ringed. */
export function DotStrip({ rows, usual, format, label }: { rows: StripRow[]; usual: { low: number; high: number }; format: (v: number) => string; label: string }) {
  const W = 760, H = 170, L = 40, Rr = 740, cy = 92
  const max = niceMax(Math.max(...rows.map((r) => r.rate), 0.001) * 1.1)
  const X = (v: number) => L + (v / max) * (Rr - L)
  const hit = rows.find((r) => r.highlight)
  const others = rows.filter((r) => !r.highlight)
  const avg = others.length ? others.reduce((a, r) => a + r.rate * r.units, 0) / Math.max(1, others.reduce((a, r) => a + r.units, 0)) : 0
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} className="block">
      <rect x={X(usual.low) - 8} y={cy - 30} width={Math.max(16, X(usual.high) - X(usual.low) + 16)} height={60} rx={10} fill={ink('mint', 0.12)} />
      <text x={(X(usual.low) + X(usual.high)) / 2} y={cy - 36} textAnchor="middle" fontSize={11} fill={ink('mint')}>usual range</text>
      <line x1={L} y1={cy + 44} x2={Rr} y2={cy + 44} stroke={LINE2} />
      {ticks.map((t) => <text key={t} x={X(t)} y={cy + 62} textAnchor="middle" fontSize={10} fill={FAINT}>{format(t)}</text>)}
      {others.map((r, i) => (
        <circle key={r.value} className="anim-develop" style={{ animationDelay: `${i * 0.04}s` }} cx={X(r.rate)} cy={cy + ((i % 3) - 1) * 13} r={6.5} fill={ink('sky', 0.85)}>
          <title>{`${r.value}: ${format(r.rate)} of ${r.units} units`}</title>
        </circle>
      ))}
      {hit && (
        <g>
          {avg > 0 && hit.rate > avg && (
            <>
              <path d={`M${X(usual.high) + 14} ${cy} L${X(hit.rate) - 20} ${cy}`} stroke={ink('rose')} strokeWidth={1.5} className="anim-march" fill="none" />
              <rect x={(X(usual.high) + X(hit.rate)) / 2 - 28} y={cy - 13} width={56} height={26} rx={13} fill="rgb(var(--panel))" stroke={ink('rose')} />
              <text x={(X(usual.high) + X(hit.rate)) / 2} y={cy + 4} textAnchor="middle" fontSize={12} fontWeight={600} fill={ink('rose')}>{(hit.rate / avg).toFixed(1)}×</text>
            </>
          )}
          <circle className="anim-ring" cx={X(hit.rate)} cy={cy} r={14} fill="none" stroke={ink('rose')} strokeWidth={1.5} />
          <circle cx={X(hit.rate)} cy={cy} r={10} fill={ink('rose')} />
          <text x={Math.min(X(hit.rate), Rr - 60)} y={cy - 38} textAnchor="middle" fontSize={12} fontWeight={600} fill={TEXT}>{hit.value} · {format(hit.rate)}</text>
          <text x={Math.min(X(hit.rate), Rr - 60)} y={cy - 24} textAnchor="middle" fontSize={11} fill={MUTED}>{hit.units.toLocaleString()} units</text>
        </g>
      )}
    </svg>
  )
}

/* ------------------------------------------------------------------ slope (before → after) */

/** Before and after a fix as two points joined by a line; the dashed line is products that weren't changed. */
export function Slope({ before, after, controlBefore, controlAfter, verdictTone, format, beforeLabel, afterLabel, label }: {
  before: number; after: number; controlBefore?: number | null; controlAfter?: number | null; verdictTone: string
  format: (v: number) => string; beforeLabel: string; afterLabel: string; label: string
}) {
  const W = 320, H = 190, x1 = 70, x2 = 250
  const max = Math.max(before, after, controlBefore || 0, controlAfter || 0, 0.0001) * 1.18
  const Y = (v: number) => 160 - (v / max) * 140
  const hasC = controlBefore != null && controlAfter != null
  const near = hasC && Math.abs(Y(controlAfter!) - Y(after)) < 16
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} className="block">
      <line x1={x1} y1={20} x2={x1} y2={160} stroke={LINE2} />
      <line x1={x2} y1={20} x2={x2} y2={160} stroke={LINE2} />
      {hasC && (
        <g>
          <line x1={x1} y1={Y(controlBefore!)} x2={x2} y2={Y(controlAfter!)} stroke="rgb(var(--dim))" strokeWidth={1.5} strokeDasharray="4 4" />
          <circle cx={x1} cy={Y(controlBefore!)} r={3} fill="rgb(var(--dim))" /><circle cx={x2} cy={Y(controlAfter!)} r={3} fill="rgb(var(--dim))" />
          <text x={x2 + 10} y={Y(controlAfter!) + (near ? 18 : 4)} fontSize={10.5} fill={FAINT}>others {format(controlAfter!)}</text>
        </g>
      )}
      <line className="anim-trace" style={{ ['--len' as string]: 220 } as CSSProperties} x1={x1} y1={Y(before)} x2={x2} y2={Y(after)} stroke={ink(verdictTone)} strokeWidth={3} strokeLinecap="round" />
      <circle cx={x1} cy={Y(before)} r={6} fill="rgb(var(--panel))" stroke={ink(verdictTone)} strokeWidth={2.5} />
      <circle cx={x2} cy={Y(after)} r={6} fill={ink(verdictTone)} />
      <text x={x1 - 10} y={Y(before) + 4} textAnchor="end" fontSize={13} fontWeight={500} fill={TEXT} className="font-mono">{format(before)}</text>
      <text x={x2 + 10} y={Y(after) + 4} fontSize={13} fontWeight={500} fill={ink(verdictTone)} className="font-mono">{format(after)}</text>
      <text x={x1} y={182} textAnchor="middle" fontSize={11} fill={MUTED}>{beforeLabel}</text>
      <text x={x2} y={182} textAnchor="middle" fontSize={11} fill={MUTED}>{afterLabel}</text>
    </svg>
  )
}

/* ------------------------------------------------------------------ mosaic + word chips */

const PASTELS = ['rose', 'sky', 'butter', 'blush', 'mist', 'mint']

/** One row of tiles sized by share: the shape of what customers complain about, at a glance. */
export function Mosaic({ items, onPick, label }: { items: { key: string; label: string; value: number; sub?: string }[]; onPick?: (key: string) => void; label: string }) {
  const total = items.reduce((a, x) => a + x.value, 0) || 1
  return (
    <div role="list" aria-label={label} className="flex h-[92px] w-full gap-1 overflow-hidden rounded-xl">
      {items.map((x, i) => {
        const share = x.value / total
        const tone = PASTELS[i % PASTELS.length]
        return (
          <button key={x.key} type="button" role="listitem" onClick={() => onPick?.(x.key)} title={`${x.label}: ${x.value}`}
            className="anim-develop group relative min-w-[28px] overflow-hidden rounded-lg p-2.5 text-left text-onpastel transition hover:brightness-[0.97]"
            style={{ flex: `${Math.max(share, 0.02)} 1 0`, background: `rgb(var(--${tone}))`, animationDelay: `${i * 0.05}s` }}>
            {share > 0.07 && <>
              <span className="block truncate text-[13px] font-medium">{x.label}</span>
              <span className="block truncate font-mono text-[11px] opacity-75">{x.value} · {Math.round(share * 100)}%</span>
            </>}
          </button>
        )
      })}
    </div>
  )
}

/** Phrases sized by how often customers used them. */
export function WordChips({ words, max = 14 }: { words: { text: string; count: number }[]; max?: number }) {
  const list = words.slice(0, max)
  const hi = Math.max(...list.map((w) => w.count), 1)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {list.map((w, i) => {
        const k = w.count / hi
        const size = 12 + Math.round(k * 9)
        const pastel = k > 0.45 ? PASTELS[i % PASTELS.length] : null
        return (
          <span key={w.text} title={`${w.count}×`} className={cx('anim-develop inline-flex items-baseline gap-1 rounded-[10px] px-2.5 py-1 leading-tight', pastel ? 'text-onpastel' : 'border border-line/[0.12] text-body')}
            style={{ fontSize: size, fontWeight: k > 0.7 ? 600 : k > 0.45 ? 500 : 400, background: pastel ? `rgb(var(--${pastel}))` : undefined, animationDelay: `${i * 0.03}s` }}>
            {w.text}<span className={cx('text-[10px]', pastel ? 'opacity-60' : 'text-faint')}>{w.count}</span>
          </span>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ card + table */

/** Card wrapper with a Chart/Table toggle. */
export function ChartCard({ title, sub, children, table, right, className }: {
  title: string; sub?: ReactNode; children: ReactNode; table?: ReactNode; right?: ReactNode; className?: string
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  return (
    <section className={cx('card card-hover anim-rise min-w-0 p-5', className)}>
      <div className="mb-3 flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-medium text-text">{title}</h2>
          {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
        </div>
        {right}
        {table && (
          <div className="inline-flex rounded-lg border border-line/[0.08] bg-line/[0.03] p-0.5 text-[11px]">
            {(['chart', 'table'] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
                className={cx('rounded-md px-2.5 py-1 capitalize transition', view === v ? 'bg-panel text-text shadow-[0_1px_2px_rgb(var(--shadow)/0.12)]' : 'text-muted hover:text-text')}>{v}</button>
            ))}
          </div>
        )}
      </div>
      {view === 'chart' || !table ? children : <div className="max-h-[340px] overflow-auto">{table}</div>}
    </section>
  )
}

export function SimpleTable({ head, rows }: { head: string[]; rows: (string | number | ReactNode)[][] }) {
  return (
    <table className="w-full text-left text-xs">
      <thead className="sticky top-0 bg-panel text-faint"><tr>{head.map((h) => <th key={h} className="py-1.5 pr-3 font-normal">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line/[0.05]">{r.map((c, j) => <td key={j} className="py-1.5 pr-3 tabular-nums text-body">{c}</td>)}</tr>)}</tbody>
    </table>
  )
}

export function useMemoRows<T>(fn: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(fn, deps)
}
