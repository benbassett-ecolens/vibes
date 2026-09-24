import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /** Shown in the fallback so the crash can be reported. */
  label: string
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Contains a render crash to one section instead of blanking the whole page,
 * and shows the error text so it can be reported. The rest of the app (tabs,
 * Export) keeps working, so data can always be backed up.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.label} crashed:`, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="empty-state" role="alert" style={{ padding: 16 }}>
        <strong>{this.props.label} hit an error.</strong>
        <p className="hint" style={{ margin: '8px 0' }}>
          Your data is safe — other tabs and Export still work.
        </p>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: '0 0 12px' }}>
          {error.message}
        </pre>
        <button onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    )
  }
}
