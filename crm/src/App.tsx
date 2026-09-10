import { useMemo, useRef, useState } from 'react'
import { AppProvider, emptyData, isAppData, normalizeData, useApp } from './store'
import { seedData } from './seed'
import { UIContext } from './ui'
import { Pipeline } from './components/Pipeline'
import { DealList } from './components/DealList'
import { DealDrawer } from './components/DealDrawer'
import { Activities } from './components/Activities'
import { Contacts } from './components/Contacts'
import { Insights } from './components/Insights'
import { Settings } from './components/Settings'
import { NewDealModal } from './components/NewDealModal'
import { PersonSelect } from './components/common'
import { SheetSyncButton } from './components/SheetSync'
import { openActivities } from './insights'
import { useSheetSync } from './useSheetSync'

const NAV = [
  { id: 'deals', label: 'Deals', icon: '▦' },
  { id: 'activities', label: 'Activities', icon: '☑' },
  { id: 'contacts', label: 'Contacts', icon: '☺' },
  { id: 'insights', label: 'Insights', icon: '◔' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
] as const
type View = (typeof NAV)[number]['id']

function SyncBadge() {
  const { syncStatus } = useApp()
  if (syncStatus === 'live')
    return (
      <span className="sync-badge live" title="Shared workspace: everyone this page is shared with sees the same pipeline, live.">
        ● Shared · live
      </span>
    )
  if (syncStatus === 'connecting') return <span className="sync-badge">◌ Connecting…</span>
  return (
    <span className="sync-badge" title="Data is stored in this browser only. Export from Settings to move it.">
      ○ This browser only
    </span>
  )
}

export function useDataControls() {
  const { data, setData } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)

  const exportJson = async () => {
    const json = JSON.stringify({ version: 1, data }, null, 2)
    const filename = `ecolens-pipeline-${new Date().toISOString().slice(0, 10)}.json`
    if (window.claude?.use) {
      try {
        const downloads = (await window.claude.use('downloads')) as {
          save(req: { filename: string; data: string }): Promise<unknown>
        } | null
        if (downloads) {
          await downloads.save({ filename, data: json })
          return
        }
      } catch {
        return
      }
    }
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const importJson = (file: File) => {
    file.text().then((text) => {
      try {
        const parsed = JSON.parse(text)
        const candidate = parsed.data ?? parsed
        if (isAppData(candidate)) setData(normalizeData(candidate))
        else alert('That file does not look like an Ecolens Pipeline export.')
      } catch {
        alert('Could not parse that file as JSON.')
      }
    })
  }

  const resetToSheet = () => {
    if (confirm('Replace everything with the data imported from the Ecolens Sales Pipeline sheet?'))
      setData(seedData())
  }
  const clearAll = () => {
    if (confirm('Delete ALL deals, notes, activities and dashboards? Export first for a backup.'))
      setData({ ...emptyData(), stages: data.stages, people: data.people })
  }

  return { exportJson, importJson, resetToSheet, clearAll, fileRef }
}

function Shell() {
  const { data, actions } = useApp()
  const [view, setView] = useState<View>('deals')
  const [dealsMode, setDealsMode] = useState<'board' | 'list'>('board')
  const [openDealId, setOpenDealId] = useState<string | null>(null)
  const [ownerFilter, setOwnerFilter] = useState('')
  const [search, setSearch] = useState('')
  const [showNewDeal, setShowNewDeal] = useState(false)

  const overdue = useMemo(() => openActivities(data, 'overdue').length, [data])
  const sheet = useSheetSync()
  const ui = useMemo(
    () => ({ openDeal: (id: string) => setOpenDealId(id), ownerFilter, search, sheet }),
    [ownerFilter, search, sheet],
  )
  const openDeal = openDealId ? data.deals.find((d) => d.id === openDealId) : undefined

  return (
    <UIContext.Provider value={ui}>
      <div className="crm">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              🧭
            </span>
            <div>
              <div className="brand-name">Ecolens Pipeline</div>
              <div className="brand-sub">Partner services CRM</div>
            </div>
          </div>
          <nav aria-label="Sections">
            {NAV.map((n) => (
              <button
                key={n.id}
                className={`nav-item ${view === n.id ? 'active' : ''}`}
                onClick={() => setView(n.id)}
                aria-current={view === n.id ? 'page' : undefined}
              >
                <span className="nav-icon" aria-hidden="true">
                  {n.icon}
                </span>
                {n.label}
                {n.id === 'activities' && overdue > 0 && (
                  <span className="nav-badge" title={`${overdue} overdue`}>
                    {overdue}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <div className="sidebar-foot">
            <SyncBadge />
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <div className="topbar-left">
              <h1 className="view-title">
                {NAV.find((n) => n.id === view)?.label}
                {view === 'deals' && (
                  <span className="seg" role="tablist" aria-label="Deals layout">
                    <button
                      role="tab"
                      aria-selected={dealsMode === 'board'}
                      className={dealsMode === 'board' ? 'on' : ''}
                      onClick={() => setDealsMode('board')}
                    >
                      Board
                    </button>
                    <button
                      role="tab"
                      aria-selected={dealsMode === 'list'}
                      className={dealsMode === 'list' ? 'on' : ''}
                      onClick={() => setDealsMode('list')}
                    >
                      List
                    </button>
                  </span>
                )}
              </h1>
            </div>
            <div className="topbar-right">
              {(view === 'deals' || view === 'activities' || view === 'contacts') && (
                <>
                  <input
                    type="search"
                    className="search"
                    placeholder="Search…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Search"
                  />
                  <PersonSelect value={ownerFilter} onChange={setOwnerFilter} emptyLabel="Everyone" className="owner-filter" />
                </>
              )}
              <SheetSyncButton />
              <button className="primary" onClick={() => setShowNewDeal(true)}>
                + Deal
              </button>
            </div>
          </header>

          <main className={`content content-${view}`}>
            {view === 'deals' && (dealsMode === 'board' ? <Pipeline /> : <DealList />)}
            {view === 'activities' && <Activities />}
            {view === 'contacts' && <Contacts />}
            {view === 'insights' && <Insights />}
            {view === 'settings' && <Settings />}
          </main>
        </div>

        {openDeal && <DealDrawer deal={openDeal} onClose={() => setOpenDealId(null)} />}
        {showNewDeal && (
          <NewDealModal
            onClose={() => setShowNewDeal(false)}
            onCreate={(input) => {
              const id = actions.addDeal(input)
              setShowNewDeal(false)
              setOpenDealId(id)
            }}
          />
        )}
      </div>
    </UIContext.Provider>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
