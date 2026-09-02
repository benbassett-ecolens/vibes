import { useRef, useState } from 'react'
import { AppProvider, emptyData, isAppData, normalizeData, seedData, useApp } from './store'
import { Scorecard } from './components/Scorecard'
import { Headlines } from './components/Headlines'
import { Rocks } from './components/Rocks'
import { Issues } from './components/Issues'
import { MeetingTab } from './components/Meeting'
import { Team } from './components/Team'

const TABS = [
  { id: 'scorecard', label: 'Scorecard', icon: '📊' },
  { id: 'rocks', label: 'Rocks', icon: '🪨' },
  { id: 'headlines', label: 'Headlines', icon: '📰' },
  { id: 'issues', label: 'Issues', icon: '🧩' },
  { id: 'meeting', label: 'Rate the Meeting', icon: '⭐' },
  { id: 'team', label: 'Team', icon: '👥' },
] as const

type TabId = (typeof TABS)[number]['id']

function SyncBadge() {
  const { syncStatus } = useApp()
  if (syncStatus === 'live') {
    return (
      <span
        className="sync-badge live"
        title="Shared workspace: everyone this page is shared with sees the same data, updated live."
      >
        ● Shared · live
      </span>
    )
  }
  if (syncStatus === 'connecting') {
    return <span className="sync-badge">◌ Connecting…</span>
  }
  return (
    <span className="sync-badge" title="Data is stored in this browser only. Use Export/Import to move it.">
      ○ This browser only
    </span>
  )
}

function DataControls() {
  const { data, setData } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)

  const exportJson = async () => {
    const json = JSON.stringify({ version: 2, data }, null, 2)
    const filename = `ecolens-l10-export-${new Date().toISOString().slice(0, 10)}.json`
    // Inside the artifact viewer, downloads go through the viewer's
    // save prompt; elsewhere, a plain browser download.
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
        return // viewer declined or save unavailable — don't double-prompt
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
        else alert('That file does not look like an Ecolens L10 export.')
      } catch {
        alert('Could not parse that file as JSON.')
      }
    })
  }

  return (
    <div className="data-controls">
      <button onClick={exportJson} title="Download all data as JSON">
        Export
      </button>
      <button onClick={() => fileRef.current?.click()} title="Load data from a JSON export">
        Import
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) importJson(f)
          e.target.value = ''
        }}
      />
      <button
        onClick={() => {
          if (confirm('Replace everything with the sample data?')) setData(seedData())
        }}
        title="Reset to sample data"
      >
        Sample
      </button>
      <button
        className="danger-text"
        onClick={() => {
          if (confirm('Delete ALL data? Export first if you want a backup.')) setData(emptyData())
        }}
        title="Clear all data"
      >
        Clear
      </button>
    </div>
  )
}

function Shell() {
  const [tab, setTab] = useState<TabId>('scorecard')
  const { syncStatus } = useApp()

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">🎯</span>
          <div>
            <h1>Ecolens L10</h1>
            <p className="tagline">EOS Level 10 Meeting hub — scorecard, rocks, headlines, issues</p>
          </div>
        </div>
        <div className="header-right">
          <SyncBadge />
          <DataControls />
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'scorecard' && <Scorecard />}
        {tab === 'rocks' && <Rocks />}
        {tab === 'headlines' && <Headlines />}
        {tab === 'issues' && <Issues />}
        {tab === 'meeting' && <MeetingTab />}
        {tab === 'team' && <Team />}
      </main>

      <footer className="app-footer">
        Built on the EOS® / <em>Traction</em> Level 10 Meeting model.{' '}
        {syncStatus === 'live'
          ? 'Shared workspace: everyone this page is shared with sees the same data.'
          : 'Data is stored in this browser — use Export/Import to move or back it up.'}
      </footer>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
