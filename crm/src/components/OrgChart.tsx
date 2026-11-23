import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { Avatar, useToast } from './ui'
import { INFLUENCE_LABEL, type Contact, type ContactInfluence } from '../../shared/types'

interface Node { c: Contact; children: Node[] }

/** Build the forest: roots are contacts with no manager (or a manager outside this list). */
export function buildTree(contacts: Contact[]): Node[] {
  const byId = new Map(contacts.map((c) => [c.id, { c, children: [] as Node[] }]))
  const roots: Node[] = []
  for (const n of byId.values()) {
    const parent = n.c.reports_to_id ? byId.get(n.c.reports_to_id) : undefined
    if (parent) parent.children.push(n)
    else roots.push(n)
  }
  const sortNodes = (ns: Node[]) => {
    ns.sort((a, b) => b.children.length - a.children.length || `${a.c.last_name} ${a.c.first_name}`.localeCompare(`${b.c.last_name} ${b.c.first_name}`))
    ns.forEach((n) => sortNodes(n.children))
  }
  sortNodes(roots)
  return roots
}

const INFLUENCE_CLASS: Record<ContactInfluence, string> = { decision_maker: 'inf-dm', champion: 'inf-champ', influencer: 'inf-inf', blocker: 'inf-block', user: 'inf-user' }

function NodeCard({ n, all, editing, onChanged }: { n: Node; all: Contact[]; editing: boolean; onChanged: () => void }) {
  const toast = useToast()
  const c = n.c
  const patch = async (body: Partial<Contact>) => {
    try {
      await api.patch(`/api/contacts/${c.id}`, body)
      onChanged()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  return (
    <li>
      <div className={`org-node ${c.influence ? INFLUENCE_CLASS[c.influence] : ''}`}>
        <Link to={`/contacts/${c.id}`} className="row" style={{ gap: 8, color: 'inherit' }}>
          <Avatar name={`${c.first_name} ${c.last_name}`} />
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="org-name truncate">{c.first_name} {c.last_name}</span>
            <span className="org-title truncate">{c.title ?? <span className="muted">no title</span>}{c.department ? ` · ${c.department}` : ''}</span>
          </span>
        </Link>
        {c.influence && <span className="org-inf">{INFLUENCE_LABEL[c.influence]}</span>}
        {editing && (
          <div className="org-edit">
            <select className="select sm" value={c.reports_to_id ?? ''} onChange={(e) => patch({ reports_to_id: e.target.value || null })} title="Reports to">
              <option value="">Reports to: nobody (top)</option>
              {all.filter((o) => o.id !== c.id).map((o) => <option key={o.id} value={o.id}>Reports to: {o.first_name} {o.last_name}</option>)}
            </select>
            <select className="select sm" value={c.influence ?? ''} onChange={(e) => patch({ influence: (e.target.value || null) as ContactInfluence | null })} title="Role in the buying decision">
              <option value="">Role: —</option>
              {(Object.keys(INFLUENCE_LABEL) as ContactInfluence[]).map((k) => <option key={k} value={k}>Role: {INFLUENCE_LABEL[k]}</option>)}
            </select>
          </div>
        )}
      </div>
      {n.children.length > 0 && <ul>{n.children.map((ch) => <NodeCard key={ch.c.id} n={ch} all={all} editing={editing} onChanged={onChanged} />)}</ul>}
    </li>
  )
}

/** Organization chart for one company's contacts. Reporting lines and roles are edited in place. */
export function OrgChart({ contacts, onChanged, onAdd }: { contacts: Contact[]; onChanged: () => void; onAdd: () => void }) {
  const [editing, setEditing] = useState(false)
  const roots = useMemo(() => buildTree(contacts), [contacts])
  const placed = contacts.filter((c) => c.reports_to_id).length
  return (
    <div className="card">
      <div className="card-h">
        <h2>Organization</h2>
        <span className="muted small right row" style={{ gap: 8 }}>
          {contacts.length} {contacts.length === 1 ? 'person' : 'people'}{contacts.length > 1 && ` · ${placed} placed`}
          <button className={`btn sm ${editing ? 'primary' : ''}`} onClick={() => setEditing((v) => !v)}>{editing ? 'Done' : 'Edit chart'}</button>
          <button className="btn sm" onClick={onAdd}>+ Person</button>
        </span>
      </div>
      <div className="card-b" style={{ overflowX: 'auto' }}>
        {!contacts.length && <div className="empty small">No contacts yet. Add people, then use Edit chart to set who reports to whom.</div>}
        {contacts.length > 0 && (
          <>
            <ul className="org-tree">{roots.map((n) => <NodeCard key={n.c.id} n={n} all={contacts} editing={editing} onChanged={onChanged} />)}</ul>
            {editing && <div className="small muted" style={{ marginTop: 8 }}>Pick each person's manager and their role in the buying decision. Changes save immediately.</div>}
            {!editing && contacts.length > 1 && placed === 0 && <div className="small muted" style={{ marginTop: 8 }}>Everyone is at the top level. Use Edit chart to set reporting lines.</div>}
          </>
        )}
      </div>
    </div>
  )
}
