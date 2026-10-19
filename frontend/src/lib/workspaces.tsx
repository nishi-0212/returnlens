/* Workspaces are separate data sets shown under "Recents" (like chats). */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, workspaceStore } from './api'
import type { Workspace } from './types'

interface WorkspacesCtx {
  list: Workspace[]
  current: Workspace | null
  loading: boolean
  select: (id: string) => void
  create: () => Promise<Workspace>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
  clearAll: () => Promise<void>
  refresh: () => Promise<void>
}

/** A workspace with no data yet. It isn't listed in Recents until something is uploaded. */
export const isEmptyWorkspace = (p: Workspace) => !p.stats.orders && !p.stats.returns && !p.stats.products && !p.stats.running

const Ctx = createContext<WorkspacesCtx | null>(null)

export function WorkspacesProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Workspace[]>([])
  const [currentId, setCurrentId] = useState<string | null>(workspaceStore.get())
  const [loading, setLoading] = useState(true)

  const select = useCallback((id: string) => {
    workspaceStore.set(id)
    setCurrentId(id)
  }, [])

  const refresh = useCallback(async () => {
    const items = await api<Workspace[]>('/api/workspaces')
    setList(items)
    const saved = workspaceStore.get()
    if (!saved || !items.some((p) => p.id === saved)) {
      if (items[0]) select(items[0].id)
    }
  }, [select])

  useEffect(() => { refresh().finally(() => setLoading(false)) }, [refresh])

  const value = useMemo<WorkspacesCtx>(() => ({
    list,
    current: list.find((p) => p.id === currentId) || null,
    loading,
    select,
    refresh,
    create: async () => {
      const p = await api<Workspace>('/api/workspaces', { body: {} })
      setList((xs) => [p, ...xs.filter((x) => x.id !== p.id)])
      select(p.id)
      return p
    },
    rename: async (id, name) => {
      const p = await api<Workspace>(`/api/workspaces/${id}`, { method: 'PATCH', body: { name } })
      setList((xs) => xs.map((x) => (x.id === id ? p : x)))
    },
    remove: async (id) => {
      await api(`/api/workspaces/${id}`, { method: 'DELETE' })
      if (id === currentId) workspaceStore.set(null)
      await refresh()
    },
    clearAll: async () => {
      await api('/api/workspaces', { method: 'DELETE' })
      workspaceStore.set(null)
      await refresh()
    },
  }), [list, currentId, loading, select, refresh])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWorkspaces(): WorkspacesCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useWorkspaces outside WorkspacesProvider')
  return v
}
