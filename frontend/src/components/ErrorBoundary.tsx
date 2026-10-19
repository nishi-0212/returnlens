/* Catches render errors so a bug shows a readable message instead of a blank page. */
import { Component, type ErrorInfo, type ReactNode } from 'react'

export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; info: string }> {
  state = { error: null as Error | null, info: '' }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ReturnLens crashed:', error, info.componentStack)
    this.setState({ info: info.componentStack || '' })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto flex min-h-screen max-w-[760px] flex-col justify-center gap-4 px-6 py-12">
        <div className="eyebrow text-rose-ink">Something broke on this page</div>
        <h1 className="text-2xl font-semibold tracking-tight">{this.state.error.message || String(this.state.error)}</h1>
        <pre className="max-h-[320px] overflow-auto rounded-xl border border-line/[0.1] bg-panel p-4 font-mono text-[11px] leading-relaxed text-muted">
          {(this.state.error.stack || '').split('\n').slice(0, 8).join('\n')}
          {this.state.info ? '\n\nIn:' + this.state.info.split('\n').slice(0, 10).join('\n') : ''}
        </pre>
        <div className="flex gap-2">
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>Reload</button>
          <a href="/" className="btn">Go home</a>
        </div>
      </div>
    )
  }
}
