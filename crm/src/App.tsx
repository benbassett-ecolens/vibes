import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, LoginPage, useAuth } from './auth'
import { Avatar, ToastProvider } from './components/ui'
import { RefProvider } from './refdata'
import { Dashboard } from './pages/Dashboard'
import { DealsPage } from './pages/Deals'
import { DealDetail } from './pages/DealDetail'
import { ContactsPage } from './pages/Contacts'
import { ContactDetail } from './pages/ContactDetail'
import { CompaniesPage } from './pages/Companies'
import { CompanyDetail } from './pages/CompanyDetail'
import { ActivitiesPage } from './pages/Activities'
import { ReportsPage } from './pages/Reports'
import { SettingsPage } from './pages/Settings'

const NAV = [
  { to: '/', label: 'Dashboard', ico: '◎', end: true },
  { to: '/deals', label: 'Deals', ico: '▦' },
  { to: '/contacts', label: 'Contacts', ico: '◉' },
  { to: '/companies', label: 'Companies', ico: '▣' },
  { to: '/activities', label: 'Tasks & activity', ico: '✓' },
  { to: '/reports', label: 'Reports', ico: '▥' },
  { to: '/settings', label: 'Settings', ico: '⚙' },
]

function Shell() {
  const { user, loading, logout } = useAuth()
  if (loading) return <div className="login"><div className="muted">Loading…</div></div>
  if (!user) return <LoginPage />
  return (
    <RefProvider>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand"><span className="logo">🌱</span><span>Ecolens CRM</span></div>
          <nav>
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                <span className="ico">{n.ico}</span>
                <span className="lbl">{n.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="spacer" />
          <div className="me">
            <Avatar name={user.name} src={user.picture_url} />
            <div className="txt grow">
              <div className="name truncate">{user.name}</div>
              <div className="email truncate">{user.email}{user.role === 'admin' ? ' · admin' : ''}</div>
            </div>
            <button className="btn ghost sm" style={{ color: '#c3d1c8' }} onClick={logout} title="Sign out">⎋</button>
          </div>
        </aside>
        <div className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/deals" element={<DealsPage />} />
            <Route path="/deals/:id" element={<DealDetail />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/contacts/:id" element={<ContactDetail />} />
            <Route path="/companies" element={<CompaniesPage />} />
            <Route path="/companies/:id" element={<CompanyDetail />} />
            <Route path="/activities" element={<ActivitiesPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </RefProvider>
  )
}

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </ToastProvider>
  )
}
