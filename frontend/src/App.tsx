import type { ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppShell from './components/AppShell'
import { Logo, Spinner } from './components/ui'
import { useAuth } from './lib/auth'
import Actions from './pages/Actions'
import { Login, Register } from './pages/Auth'
import Complaints from './pages/Complaints'
import Costs from './pages/Costs'
import Findings from './pages/Findings'
import Home from './pages/Home'
import Investigation from './pages/Investigation'
import Overview from './pages/Overview'
import Uploads from './pages/Uploads'
import Verify from './pages/Verify'

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const loc = useLocation()
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 text-sm text-muted">
        <Spinner className="text-sky-ink" /> Loading your workspace…
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />
  return <>{children}</>
}

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <Logo size={32} withText={false} />
      <h1 className="text-2xl font-semibold tracking-tight">This page doesn't exist</h1>
      <Link to="/" className="btn-primary">Go home</Link>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/app" element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<Overview />} />
        <Route path="uploads" element={<Uploads />} />
        <Route path="complaints" element={<Complaints />} />
        <Route path="findings" element={<Findings />} />
        <Route path="findings/:id" element={<Investigation />} />
        <Route path="costs" element={<Costs />} />
        <Route path="actions" element={<Actions />} />
        <Route path="verify" element={<Verify />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
