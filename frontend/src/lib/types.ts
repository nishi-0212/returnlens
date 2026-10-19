export interface User { id: string; name: string; email: string }

export interface WorkspaceStats {
  orders: number
  returns: number
  reviews: number
  products: number
  uploads: number
  analyzed: boolean
  run_version: number | null
  return_rate: number | null
  refunds: number | null
  currency: string
  findings: number
  confirmed: number
  clusters: number
  recs_total: number
  recs_proposed: number
  recs_approved: number
  recs_rejected: number
  recs_completed: number
  verified: number
  improved?: number
  alerts: number
  running: boolean
}

export interface Workspace { id: string; name: string; created_at: string; updated_at: string; stats: WorkspaceStats }

export type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'stopped'
export interface Job {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  trigger: string
  label: string | null
  stages: { key: string; label: string; status: StageStatus; detail: string | null }[]
  error: string | null
  run_version: number | null
  summary?: string
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface UploadError { row: number | null; field: string | null; message: string; sheet?: string | null; level?: string }
export interface UploadRecord {
  id: string
  filename: string
  size: number
  status: 'processing' | 'done' | 'partial' | 'failed'
  created_at: string
  kinds?: string[]
  rows_imported?: number
  sheets: { sheet: string; kind: string; rows: number; imported: number; skipped: number; created?: number; updated?: number }[]
  errors: UploadError[]
  warnings: UploadError[]
  job_id?: string
}

export interface Filters {
  date_from?: string
  date_to?: string
  sku?: string
  category?: string
  supplier?: string
  batch?: string
  cluster?: string
  cause?: string
}

export interface Facets {
  skus: { value: string; label: string }[]
  categories: string[]
  suppliers: { value: string; label: string }[]
  batches: string[]
  clusters: { value: string; label: string }[]
  causes: string[]
  cause_labels: Record<string, string>
  range: { start?: string | null; end?: string | null }
}

export interface Kpis {
  orders: number
  units: number
  returns: number
  returned_units: number
  return_rate: number
  refunds: number
  costs_total: number
  costs_actual: number
  costs_estimated: number
  cost_lines: CostLine[]
  affected_products: number
  high_risk_suppliers: number
  reviews: number
  currency: string
}

export interface TrendPoint { period: string; units: number; returned: number; rate: number; refunds: number; cost: number; maturing: boolean }
export interface BreakdownRow { key: string; label: string; units: number; orders?: number; returned: number; rate: number; refunds: number; cost: number; share?: number }
export interface BaselineRow {
  dimension: string; key: string; label: string; current_units: number; current_returned: number; current_rate: number
  baseline_units: number; baseline_returned: number; baseline_rate: number; compared_to: 'baseline' | 'overall'
  change: number; lift: number; p_value: number; unusual: boolean
}
export interface BatchOutlier { batch: string; sku: string; label: string; units: number; returned: number; rate: number; other_batches_rate: number; lift: number; p_value: number; unusual: boolean }

export interface RunInfo { version: number; created_at: string; summary: string; changes: { kind: string; text: string }[]; source: string; trigger: string }

export interface Overview {
  has_data: boolean
  run: RunInfo | null
  filters?: Filters
  range?: { start: string | null; end: string | null }
  kpis: Kpis
  high_risk_suppliers: { key: string; label: string; current_rate: number; baseline_rate: number; compared_to: string; unusual: boolean }[]
  trend: TrendPoint[]
  by: Record<'sku' | 'supplier' | 'category' | 'batch' | 'reason' | 'carrier' | 'month', BreakdownRow[]>
  baseline: { windows: Record<string, string> | null; overall?: { current_rate: number; baseline_rate: number }; rows: BaselineRow[]; spikes: BaselineRow[] }
  batch_outliers: BatchOutlier[]
  links: Record<string, number>
  top_findings: FindingSummary[]
  all_findings: Pick<FindingSummary, 'id' | 'key' | 'title' | 'status' | 'cause_label' | 'cluster_label' | 'products' | 'lift' | 'cost' | 'orders_affected'>[]
  daily: DayPoint[]
  flows: Flow[]
}

export interface DayPoint { date: string; units: number; returned: number; rate: number; maturing: boolean }
export interface Flow { source: string; source_label: string; target: string; target_label: string; target_status: FindingStatus | null; finding_id: string | null; returns: number }
export interface Peers { dimension: string; rows: { value: string; units: number; complaints: number; rate: number; highlight: boolean }[]; usual: { low: number; high: number } }
export interface TimelineEvent { date: string; kind: 'batch' | 'change' | 'inspection' | 'first' | 'latest' | 'peak' | 'fix'; title: string; body: string; ref: { kind: string; id: string } | null; bad?: boolean }

export interface ComplaintExample { type: 'return' | 'review'; id: string; date: string | null; sku: string; product: string; text: string; batch?: string | null; carrier?: string | null }
export interface ComplaintGroup {
  key: string; label: string; about: string; actionable: boolean; default_cause: string
  returns: number; returned_units: number; reviews: number; orders_affected: number; share_of_returns: number; rate: number
  refunds: number; cost: number; trend: number[]
  top_products: { key: string; label: string; count: number; share: number }[]
  top_suppliers: { key: string; label: string; count: number; share: number }[]
  top_batches: { key: string; label: string; count: number; share: number }[]
  top_carriers: { key: string; label: string; count: number; share: number }[]
  themes: { label: string; count: number }[]
  variants: { text: string; count: number }[]
  examples: ComplaintExample[]
  confidence: number | null
  for_products?: { key: string; label: string; count: number }[]
}

export type FindingStatus = 'confirmed' | 'likely' | 'possible'
export interface CostBlock { total: number; actual: number; estimated: number; refunds: number; units: number; returns: number; monthly: number; lines: CostLine[] }
export interface CostLine { line: string; actual: number; estimated: number; total: number }

export interface FindingSummary {
  id: string
  key: string
  title: string
  summary: string
  status: FindingStatus
  confidence: number
  cause: string
  cause_label: string
  cluster: string
  cluster_label: string
  dimension: string
  value: string
  skus: string[]
  products: string[]
  cost: CostBlock
  orders_affected: number
  active: boolean
  change_date?: string | null
  source?: string
  lift?: number
  rate?: number
  rate_elsewhere?: number
  recommendation?: { id: string; status: RecStatus; title: string; priority: string; owner: string; due_date: string; verification?: VerificationLite | null } | null
}

export interface EvidenceRecord {
  type: 'return' | 'review' | 'inspection' | 'carrier_scans' | 'change'
  id: string
  date?: string | null
  sku?: string
  batch?: string | null
  carrier?: string | null
  supplier?: string | null
  text?: string | null
  reason?: string | null
  rating?: number | null
  result?: string
  defect_rate?: number | null
  source?: string
  change_type?: string
  description?: string | null
  context?: boolean
  damaged_scan?: boolean
  count?: number
  of?: number
}

export interface TestRow { sku: string; dimension: string; value: string; value_label: string; complaints: number; units: number; rate: number; rate_elsewhere: number; lift: number; p_value: number; p_adjusted?: number; chosen: boolean }

export interface Finding extends FindingSummary {
  status_reason: string
  alternatives: string[]
  missing_data: string[]
  tests: TestRow[]
  evidence: { returns: EvidenceRecord[]; reviews: EvidenceRecord[]; inspections: EvidenceRecord[]; shipments: EvidenceRecord[]; changes: EvidenceRecord[] }
  series: { period: string; units: number; complaints: number; rate: number }[]
  scope_desc: string
  corroborated: boolean
  history: { run: number; at: string; status: string; note: string }[]
  summary_rules?: string
}

export type RecStatus = 'proposed' | 'approved' | 'rejected' | 'completed'
export type Verdict = 'improved' | 'worsened' | 'inconclusive' | 'too_early' | 'not_started'
export interface VerificationLite { verdict: Verdict; headline: string; detail?: string }
export interface Verification extends VerificationLite {
  implemented_at: string | null
  cluster: string
  skus: string[]
  caveats?: string[]
  after_days?: number
  before?: { start: string; end: string; units: number; complaints: number; rate: number }
  after?: { start: string; end: string; units: number; complaints: number; rate: number; mix_adjusted_rate: number | null }
  control?: { before_rate: number; after_rate: number; change: number }
  relative_change?: number
  p_value?: number
  recent_complaints?: number
  recent_examples?: { id: string; date: string; sku: string; text: string }[]
  series?: { period: string; units: number; complaints: number; rate: number; after: boolean }[]
}

export interface Recommendation {
  id: string
  finding_key: string
  title: string
  steps: string[]
  action_type: string
  cause: string
  owner: string
  priority: 'P1' | 'P2' | 'P3'
  expected_impact: string
  expected_monthly_savings: number
  due_date: string
  status: RecStatus
  implemented_at: string | null
  finding_status: FindingStatus
  finding_active: boolean
  monthly_cost: number
  total_cost: number
  scope: { skus: string[]; cluster: string; dimension: string; value: string; change_date?: string | null }
  verification?: VerificationLite | null
  history: { at: string; status: string; note?: string | null }[]
  finding?: { id: string; title: string; status: FindingStatus; cause_label: string; cluster_label: string; products: string[]; active: boolean; confidence: number } | null
}

export interface Alert {
  id: string
  key: string
  kind: 'reappeared' | 'worsened' | 'rising'
  severity: 'high' | 'medium'
  title: string
  text: string
  skus?: string[]
  recommendation_id?: string
  read: boolean
  dismissed: boolean
  created_at: string
}

export interface CostReport {
  has_data: boolean
  currency: string
  summary: { lines: CostLine[]; total: number; actual: number; estimated: number; returns: number }
  by_product: CostRow[]
  by_supplier: CostRow[]
  by_batch: CostRow[]
  by_cluster: CostRow[]
  by_cause: CostRow[]
  top_problems: FindingSummary[]
  assumptions: Assumptions
  assumptions_text: { key: string; label: string; text: string }[]
}
export interface CostRow { key: string; label: string; returns: number; units: number; total: number; actual: number; estimated: number; refunds: number }
export interface Assumptions {
  currency: string
  reverse_shipping_per_unit: number
  handling_per_return: number
  replacement_shipping_per_unit: number
  cost_share_of_price_if_unknown: number
  write_off_share: Record<string, number>
}

export interface Run extends RunInfo {
  id: string
  kpis: Kpis
  findings: { key: string; title: string; status: FindingStatus; cause: string; cost: number }[]
  data_range: { start: string; end: string }
}

export interface RecordView {
  kind: string
  record: Record<string, unknown>
  order?: Record<string, unknown> | null
  shipment?: Record<string, unknown> | null
}
