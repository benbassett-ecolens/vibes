import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, onUnauthorized } from './api'
import type { User } from '../shared/types'

interface AuthState {
  user: User | null
  loading: boolean
  setUser: (u: User | null) => void
  logout: () => Promise<void>
}

const Ctx = createContext<AuthState>({ user: null, loading: true, setUser: () => {}, logout: async () => {} })
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    onUnauthorized.handler = () => setUser(null)
    api
      .get<{ user: User }>('/api/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
    return () => {
      onUnauthorized.handler = null
    }
  }, [])
  const logout = useCallback(async () => {
    await api.post('/api/auth/logout')
    setUser(null)
  }, [])
  return <Ctx.Provider value={{ user, loading, setUser, logout }}>{children}</Ctx.Provider>
}

interface AuthConfig { googleClientId: string; allowedDomain: string; devMode: boolean }

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (opts: { client_id: string; callback: (r: { credential: string }) => void; hosted_domain?: string; auto_select?: boolean; ux_mode?: string }) => void
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void
          prompt: () => void
        }
      }
    }
  }
}

export function LoginPage() {
  const { setUser } = useAuth()
  const [cfg, setCfg] = useState<AuthConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [devEmail, setDevEmail] = useState('')
  const btnRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.get<AuthConfig>('/api/auth/config').then(setCfg).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!cfg?.googleClientId || !btnRef.current) return
    let tries = 0
    const init = () => {
      const g = window.google
      if (!g) {
        if (tries++ < 50) setTimeout(init, 100)
        else setError('Google sign-in script failed to load. Check your network or ad blocker.')
        return
      }
      g.accounts.id.initialize({
        client_id: cfg.googleClientId,
        hosted_domain: cfg.allowedDomain,
        callback: async ({ credential }) => {
          setError(null)
          try {
            const r = await api.post<{ user: User }>('/api/auth/google', { credential })
            setUser(r.user)
          } catch (e) {
            setError((e as Error).message)
          }
        },
      })
      g.accounts.id.renderButton(btnRef.current!, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', width: 300 })
    }
    init()
  }, [cfg, setUser])

  const devLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const r = await api.post<{ user: User }>('/api/auth/dev', { email: devEmail })
      setUser(r.user)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="login">
      <div className="box">
        <div className="logo">🌱</div>
        <h1>Ecolens CRM</h1>
        <p className="muted">Sign in with your {cfg?.allowedDomain ?? 'ecolens.io'} Google account.</p>
        {cfg && !cfg.googleClientId && !cfg.devMode && <p className="error-box" style={{ marginTop: 16 }}>Google sign-in is not configured (GOOGLE_CLIENT_ID).</p>}
        <div className="gsi" ref={btnRef} />
        {error && <p className="error">{error}</p>}
        {cfg?.devMode && (
          <form className="dev" onSubmit={devLogin}>
            <div className="small muted" style={{ marginBottom: 6 }}>Development login (disabled in production)</div>
            <div className="row">
              <input className="input" placeholder={`you@${cfg.allowedDomain}`} value={devEmail} onChange={(e) => setDevEmail(e.target.value)} />
              <button className="btn primary" type="submit">Sign in</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
