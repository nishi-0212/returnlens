/* Filters live in the URL, so a filtered view can be bookmarked or shared. */
import { useSearchParams } from 'react-router-dom'
import type { Filters } from './types'

export const FILTER_KEYS: (keyof Filters)[] = ['date_from', 'date_to', 'sku', 'category', 'supplier', 'batch', 'cluster', 'cause']

export function useFilters(): [Filters, (k: keyof Filters, v: string | null) => void, () => void, (f: Filters) => void] {
  const [params, setParams] = useSearchParams()
  const filters: Filters = {}
  FILTER_KEYS.forEach((k) => { const v = params.get(k); if (v) filters[k] = v })
  const set = (k: keyof Filters, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v); else next.delete(k)
    setParams(next, { replace: true })
  }
  const setMany = (f: Filters) => {
    const next = new URLSearchParams(params)
    FILTER_KEYS.forEach((k) => { if (f[k]) next.set(k, f[k] as string); else next.delete(k) })
    setParams(next, { replace: true })
  }
  const clear = () => {
    const next = new URLSearchParams(params)
    FILTER_KEYS.forEach((k) => next.delete(k))
    setParams(next, { replace: true })
  }
  return [filters, set, clear, setMany]
}

export function filterQuery(f: Filters): Record<string, string> {
  const out: Record<string, string> = {}
  FILTER_KEYS.forEach((k) => { if (f[k]) out[k] = f[k] as string })
  return out
}
