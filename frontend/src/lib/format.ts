const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', INR: '₹' }

export function money(v: number | null | undefined, currency = 'USD', compact = true): string {
  const n = Number(v || 0)
  const s = SYMBOL[currency] ?? ''
  if (!compact) return s + Math.round(n).toLocaleString('en-US')
  if (Math.abs(n) >= 1_000_000) return `${s}${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `${s}${Math.round(n / 1_000)}k`
  return `${s}${Math.round(n)}`
}

export function shortDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function longDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  const d = Math.round(s / 86400)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return `${(v * 100).toFixed(digits)}%`
}

export function num(v: number | null | undefined): string {
  return Number(v || 0).toLocaleString('en-US')
}

export const TRIGGER_LABEL: Record<string, string> = {
  upload: 'New data uploaded', manual: 'Manual re-analysis',
}

export const STATUS_LABEL: Record<string, string> = {
  confirmed: 'Confirmed', likely: 'Likely', possible: 'Possible',
}

export const REC_STATUS_LABEL: Record<string, string> = {
  proposed: 'Proposed', approved: 'Approved', rejected: 'Rejected', completed: 'Completed',
}

export const KIND_LABEL: Record<string, string> = {
  orders: 'Orders', returns: 'Returns', products: 'Products', reviews: 'Reviews', shipments: 'Shipments',
  batches: 'Batches', inspections: 'Inspections', changes: 'Change log', unknown: 'Unrecognised',
}

export const COST_LINE_LABEL: Record<string, string> = {
  refund: 'Refunds', reverse_ship: 'Return shipping', replacement: 'Replacements', handling: 'Handling', write_off: 'Write-offs',
}

export const DIM_LABEL: Record<string, string> = {
  batch: 'Batch', supplier: 'Supplier', carrier: 'Carrier', warehouse: 'Warehouse', product: 'Whole product',
  'change:listing_update': 'Listing update', 'change:supplier_change': 'Supplier change', 'change:packaging_change': 'Packaging change',
  'change:size_chart_update': 'Size chart update', 'change:carrier_change': 'Carrier change', 'change:price_change': 'Price change',
  'change:other': 'Other change',
}

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ')
}
