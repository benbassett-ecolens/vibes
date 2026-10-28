import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { fmtDateTime } from '../format'
import { useRefData } from '../refdata'
import { Avatar, ConfirmButton, Field, Modal, useToast } from '../components/ui'
import type { Pipeline, Product, Stage, User } from '../../shared/types'
import { GoogleCard, SlackCard } from '../components/Integrations'
import { PRICING_LABEL } from '../../shared/pricing'
import { useQuery } from '../hooks'

const FORECAST = ['pipeline', 'best_case', 'commit', 'closed', 'omitted'] as const

function StageEditor({ pipeline, stage, onClose }: { pipeline: Pipeline; stage?: Stage; onClose: () => void }) {
  const { refresh } = useRefData()
  const toast = useToast()
  const [form, setForm] = useState({
    name: stage?.name ?? '',
    probability: stage?.probability ?? 50,
    kind: stage?.kind ?? 'open',
    forecast_category: stage?.forecast_category ?? 'pipeline',
    rot_after_days: stage?.rot_after_days?.toString() ?? '',
    color: stage?.color ?? '#2a78d6',
  })
  const [error, setError] = useState<string | null>(null)
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }))
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const body = { name: form.name, probability: Number(form.probability), kind: form.kind, forecast_category: form.forecast_category, rot_after_days: form.rot_after_days === '' ? null : Number(form.rot_after_days), color: form.color }
    try {
      if (stage) await api.patch(`/api/pipelines/${pipeline.id}/stages/${stage.id}`, body)
      else await api.post(`/api/pipelines/${pipeline.id}/stages`, body)
      toast('Saved')
      await refresh()
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <Modal title={stage ? `Edit stage: ${stage.name}` : `New stage in ${pipeline.name}`} onClose={onClose} width={520}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Name" span2><input className="input" required autoFocus value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Type">
            <select className="select" value={form.kind} onChange={(e) => set({ kind: e.target.value as Stage['kind'], probability: e.target.value === 'won' ? 100 : e.target.value === 'lost' ? 0 : form.probability, forecast_category: e.target.value === 'won' ? 'closed' : e.target.value === 'lost' ? 'omitted' : form.forecast_category })}>
              <option value="open">Open</option><option value="won">Closed won</option><option value="lost">Closed lost</option>
            </select>
          </Field>
          <Field label="Win probability %"><input className="input" type="number" min={0} max={100} value={form.probability} disabled={form.kind !== 'open'} onChange={(e) => set({ probability: Number(e.target.value) })} /></Field>
          <Field label="Forecast category">
            <select className="select" value={form.forecast_category} onChange={(e) => set({ forecast_category: e.target.value as Stage['forecast_category'] })}>
              {FORECAST.map((f) => <option key={f} value={f}>{f.replace('_', ' ')}</option>)}
            </select>
          </Field>
          <Field label="Rot after (days idle)"><input className="input" type="number" min={1} placeholder="off" value={form.rot_after_days} disabled={form.kind !== 'open'} onChange={(e) => set({ rot_after_days: e.target.value })} /></Field>
          <Field label="Colour"><input className="input" type="color" value={form.color} onChange={(e) => set({ color: e.target.value })} style={{ height: 36, padding: 2 }} /></Field>
        </div>
        {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div>
      </form>
    </Modal>
  )
}

function PipelineCard({ p, isAdmin }: { p: Pipeline; isAdmin: boolean }) {
  const { refresh, pipelines } = useRefData()
  const toast = useToast()
  const [editing, setEditing] = useState<Stage | 'new' | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(p.name)
  const [dragId, setDragId] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>, msg = 'Saved') => {
    try {
      await fn()
      toast(msg)
      await refresh()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return
    const ids = p.stages.map((s) => s.id)
    const from = ids.indexOf(fromId)
    const to = ids.indexOf(toId)
    ids.splice(from, 1)
    ids.splice(to, 0, fromId)
    run(() => api.post(`/api/pipelines/${p.id}/stages/reorder`, { stage_ids: ids }), 'Reordered')
  }
  return (
    <div className="card">
      <div className="card-h">
        {renaming ? (
          <form className="row grow" onSubmit={(e) => { e.preventDefault(); run(() => api.patch(`/api/pipelines/${p.id}`, { name })).then(() => setRenaming(false)) }}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <button className="btn sm primary">Save</button><button type="button" className="btn sm" onClick={() => setRenaming(false)}>Cancel</button>
          </form>
        ) : (
          <h2 className="grow">{p.name} {p.is_default && <span className="badge brand">default</span>}</h2>
        )}
        {isAdmin && !renaming && (
          <>
            {!p.is_default && <button className="btn sm" onClick={() => run(() => api.patch(`/api/pipelines/${p.id}`, { is_default: true }))}>Make default</button>}
            <button className="btn sm" onClick={() => setRenaming(true)}>Rename</button>
            <button className="btn sm primary" onClick={() => setEditing('new')}>+ Stage</button>
            {!p.is_default && pipelines.length > 1 && <ConfirmButton label="Delete" onConfirm={() => run(() => api.delete(`/api/pipelines/${p.id}`), 'Deleted')} />}
          </>
        )}
      </div>
      <div className="card-b">
        <div className="stage-row muted small" style={{ borderBottom: '1px solid var(--border)' }}><span /><span>Stage</span><span>Type</span><span>Probability</span><span>Forecast</span><span>Rots after</span><span /><span /></div>
        {p.stages.map((s) => (
          <div
            key={s.id}
            className="stage-row"
            draggable={isAdmin}
            onDragStart={() => setDragId(s.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragId) reorder(dragId, s.id); setDragId(null) }}
          >
            <span className="handle" title="Drag to reorder">{isAdmin ? '⋮⋮' : ''}</span>
            <span><span className="color-dot" style={{ background: s.color }} />{s.name}</span>
            <span><span className={`badge ${s.kind === 'won' ? 'good' : s.kind === 'lost' ? 'danger' : ''}`}>{s.kind}</span></span>
            <span>{s.probability}%</span>
            <span className="muted">{s.forecast_category.replace('_', ' ')}</span>
            <span className="muted">{s.rot_after_days ? `${s.rot_after_days}d` : '—'}</span>
            <span>{isAdmin && <button className="btn sm ghost" onClick={() => setEditing(s)}>Edit</button>}</span>
            <span>{isAdmin && <ConfirmButton className="btn sm ghost" label="✕" confirmLabel="Sure?" onConfirm={() => run(() => api.delete(`/api/pipelines/${p.id}/stages/${s.id}`), 'Stage deleted')} />}</span>
          </div>
        ))}
      </div>
      {editing && <StageEditor pipeline={p} stage={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ProductsCard({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast()
  const products = useQuery(() => api.get<{ items: Product[] }>('/api/products?all=true'), [])
  const [form, setForm] = useState({ name: '', pricing_type: 'one_time' as Product['pricing_type'], unit_price: '' })
  const run = async (fn: () => Promise<unknown>, msg = 'Saved') => {
    try {
      await fn()
      toast(msg)
      await products.refresh()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  return (
    <div className="card">
      <div className="card-h"><h2>Products</h2><span className="muted small right">add to deals to price them; deal amount becomes the sum of lines</span></div>
      <table className="table">
        <thead><tr><th>Product</th><th>Pricing</th><th className="num">Default price</th><th>Status</th>{isAdmin && <th />}</tr></thead>
        <tbody>
          {(products.data?.items ?? []).map((p) => (
            <tr key={p.id}>
              <td><strong>{p.name}</strong>{p.description && <div className="muted small">{p.description}</div>}</td>
              <td>{isAdmin ? (
                <select className="select sm" value={p.pricing_type} onChange={(e) => run(() => api.patch(`/api/products/${p.id}`, { pricing_type: e.target.value }))}>
                  {(Object.keys(PRICING_LABEL) as Product['pricing_type'][]).map((k) => <option key={k} value={k}>{PRICING_LABEL[k]}</option>)}
                </select>
              ) : PRICING_LABEL[p.pricing_type]}</td>
              <td className="num">{isAdmin ? <input className="input sm" type="number" step="0.01" min={0} defaultValue={p.unit_price} style={{ width: 110 }} onBlur={(e) => Number(e.target.value) !== p.unit_price && run(() => api.patch(`/api/products/${p.id}`, { unit_price: Number(e.target.value) }))} /> : p.unit_price}{p.pricing_type === 'percent' && <span className="muted small"> %</span>}</td>
              <td>{p.is_active ? <span className="badge good">active</span> : <span className="badge">inactive</span>}</td>
              {isAdmin && <td className="row"><button className="btn ghost sm" onClick={() => run(() => api.patch(`/api/products/${p.id}`, { is_active: !p.is_active }))}>{p.is_active ? 'Deactivate' : 'Activate'}</button><ConfirmButton className="btn ghost sm" label="✕" confirmLabel="Delete?" onConfirm={() => run(() => api.delete(`/api/products/${p.id}`), 'Deleted')} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
      {isAdmin && (
        <form className="row wrap" style={{ padding: 12, borderTop: '1px solid var(--border)' }} onSubmit={(e) => { e.preventDefault(); if (form.name.trim()) run(() => api.post('/api/products', { name: form.name.trim(), pricing_type: form.pricing_type, unit_price: Number(form.unit_price) || 0 }), 'Product added').then(() => setForm({ name: '', pricing_type: 'one_time', unit_price: '' })) }}>
          <input className="input sm" placeholder="New product name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: 220 }} />
          <select className="select sm" value={form.pricing_type} onChange={(e) => setForm({ ...form, pricing_type: e.target.value as Product['pricing_type'] })} style={{ width: 'auto' }}>
            {(Object.keys(PRICING_LABEL) as Product['pricing_type'][]).map((k) => <option key={k} value={k}>{PRICING_LABEL[k]}</option>)}
          </select>
          <input className="input sm" type="number" step="0.01" min={0} placeholder="Default price" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} style={{ width: 120 }} />
          <button className="btn sm primary">Add product</button>
        </form>
      )}
    </div>
  )
}

export function SettingsPage() {
  const { user } = useAuth()
  const { pipelines, users, lostReasons, refresh } = useRefData()
  const toast = useToast()
  const isAdmin = user?.role === 'admin'
  const [newPipeline, setNewPipeline] = useState('')
  const [newReason, setNewReason] = useState('')
  const run = async (fn: () => Promise<unknown>, msg = 'Saved') => {
    try {
      await fn()
      toast(msg)
      await refresh()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  return (
    <>
      <div className="topbar"><h1>Settings</h1>{!isAdmin && <span className="badge warn">read-only · ask an admin to change these</span>}</div>
      <div className="content grid" style={{ gap: 16 }}>
        <div>
          <div className="row" style={{ marginBottom: 10 }}>
            <h2>Pipelines &amp; stages</h2>
            {isAdmin && (
              <form className="row right" onSubmit={(e) => { e.preventDefault(); if (newPipeline.trim()) run(() => api.post('/api/pipelines', { name: newPipeline.trim() }), 'Pipeline created').then(() => setNewPipeline('')) }}>
                <input className="input sm" placeholder="New pipeline name" value={newPipeline} onChange={(e) => setNewPipeline(e.target.value)} />
                <button className="btn sm primary">Add pipeline</button>
              </form>
            )}
          </div>
          <p className="muted small" style={{ marginBottom: 10 }}>Probability feeds the weighted pipeline. Forecast category groups open deals in reports (Salesforce-style). “Rots after” flags deals that sit idle in a stage with no logged activity (Pipedrive-style).</p>
          <div className="grid">{pipelines.map((p) => <PipelineCard key={p.id} p={p} isAdmin={isAdmin} />)}</div>
        </div>

        <div className="grid c2">
          <GoogleCard />
          <SlackCard />
        </div>

        <ProductsCard isAdmin={isAdmin} />

        <div className="grid c2">
          <div className="card">
            <div className="card-h"><h2>Lost reasons</h2></div>
            <div className="card-b">
              {lostReasons.map((r) => (
                <div key={r.id} className="row" style={{ padding: '4px 0' }}>
                  <span className="grow">{r.label}</span>
                  {isAdmin && <ConfirmButton className="btn sm ghost" label="✕" confirmLabel="Remove?" onConfirm={() => run(() => api.delete(`/api/lost-reasons/${r.id}`), 'Removed')} />}
                </div>
              ))}
              {isAdmin && (
                <form className="row" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); if (newReason.trim()) run(() => api.post('/api/lost-reasons', { label: newReason.trim() }), 'Added').then(() => setNewReason('')) }}>
                  <input className="input sm" placeholder="Add a reason" value={newReason} onChange={(e) => setNewReason(e.target.value)} />
                  <button className="btn sm">Add</button>
                </form>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-h"><h2>Users</h2><span className="muted small right">anyone with an ecolens.io Google account is added on first sign-in</span></div>
            <table className="table">
              <thead><tr><th>User</th><th>Role</th><th>Last sign-in</th><th>Status</th>{isAdmin && <th />}</tr></thead>
              <tbody>
                {users.map((u: User) => (
                  <tr key={u.id}>
                    <td><span className="row"><Avatar name={u.name} src={u.picture_url} /><span><div>{u.name}</div><div className="muted small">{u.email}</div></span></span></td>
                    <td>{isAdmin && u.id !== user?.id ? (
                      <select className="select sm" value={u.role} onChange={(e) => run(() => api.patch(`/api/users/${u.id}`, { role: e.target.value }))}><option value="member">member</option><option value="admin">admin</option></select>
                    ) : <span className="badge">{u.role}</span>}</td>
                    <td className="muted small">{u.last_login_at ? fmtDateTime(u.last_login_at) : 'never'}</td>
                    <td>{u.is_active ? <span className="badge good">active</span> : <span className="badge danger">deactivated</span>}</td>
                    {isAdmin && <td>{u.id !== user?.id && <ConfirmButton className="btn sm ghost" label={u.is_active ? 'Deactivate' : 'Reactivate'} onConfirm={() => run(() => api.patch(`/api/users/${u.id}`, { is_active: !u.is_active }))} />}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card pad">
          <h2 style={{ marginBottom: 6 }}>Data export</h2>
          <p className="muted small" style={{ marginBottom: 10 }}>Everything is exportable as CSV, including the full audit trail and stage history (for time-in-stage analysis in a spreadsheet).</p>
          <div className="row wrap">
            {['deals', 'contacts', 'companies', 'activities', 'stage_history', 'audit_log'].map((e) => <a key={e} className="btn sm" href={`/api/export/${e}.csv`} download>⤓ {e.replace('_', ' ')}</a>)}
          </div>
        </div>
      </div>
    </>
  )
}
