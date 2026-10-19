export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:8000'

const TOKEN_KEY = 'rl-token'

export const tokenStore = {
  get: (): string | null => {
    try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
  },
  set: (t: string | null) => {
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* private mode */ }
  },
}

const WORKSPACE_KEY = 'rl-workspace'

/** The workspace every data request is scoped to. */
export const workspaceStore = {
  get: (): string | null => {
    try { return localStorage.getItem(WORKSPACE_KEY) } catch { return null }
  },
  set: (id: string | null) => {
    try { id ? localStorage.setItem(WORKSPACE_KEY, id) : localStorage.removeItem(WORKSPACE_KEY) } catch { /* ignore */ }
  },
}

export class ApiError extends Error {
  status: number
  data: unknown
  constructor(message: string, status: number, data?: unknown) {
    super(message)
    this.status = status
    this.data = data
  }
}

type Options = { method?: string; body?: unknown; form?: FormData; params?: Record<string, string | number | boolean | undefined | null> }

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const url = new URL(API_URL + path)
  Object.entries(opts.params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  })
  const headers: Record<string, string> = {}
  const token = tokenStore.get()
  if (token) headers.Authorization = `Bearer ${token}`
  const ws = workspaceStore.get()
  if (ws) headers['X-Workspace-Id'] = ws
  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  let res: Response
  try {
    res = await fetch(url, { method: opts.method || (body ? 'POST' : 'GET'), headers, body })
  } catch {
    throw new ApiError(`Can't reach the server at ${API_URL}. Is the backend running?`, 0)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    if (res.status === 401 && token) window.dispatchEvent(new Event('rl-unauthorized'))
    const msg = (data && typeof data === 'object' && data.detail) || `Request failed (${res.status})`
    throw new ApiError(typeof msg === 'string' ? msg : 'Request failed', res.status, data)
  }
  return data as T
}
