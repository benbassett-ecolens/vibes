import { useMemo, useState } from 'react'
import { useApp } from '../store'
import { useUI } from '../ui'
import { EmptyState } from './common'

export function Contacts() {
  const { data, actions } = useApp()
  const { openDeal, search, ownerFilter } = useUI()
  const [name, setName] = useState('')
  const [org, setOrg] = useState('')

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.contacts
      .filter((c) => {
        if (ownerFilter) {
          const deal = data.deals.find((d) => d.id === c.dealId)
          if (!deal || deal.ownerId !== ownerFilter) return false
        }
        return !q || `${c.name} ${c.title} ${c.organization} ${c.email}`.toLowerCase().includes(q)
      })
      .sort((a, b) => a.organization.localeCompare(b.organization) || a.name.localeCompare(b.name))
  }, [data.contacts, data.deals, search, ownerFilter])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const deal = data.deals.find((d) => d.title.toLowerCase() === org.trim().toLowerCase())
    actions.addContact({
      name: name.trim(),
      title: '',
      organization: org.trim(),
      dealId: deal?.id ?? '',
      email: '',
      phone: '',
      note: '',
    })
    setName('')
    setOrg('')
  }

  return (
    <div className="panel">
      <form className="activity-composer" onSubmit={submit}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contact name" />
        <input
          value={org}
          onChange={(e) => setOrg(e.target.value)}
          placeholder="Organization (matches a deal by name)"
          list="deal-names"
        />
        <datalist id="deal-names">
          {data.deals.map((d) => (
            <option key={d.id} value={d.title} />
          ))}
        </datalist>
        <button className="primary" type="submit" disabled={!name.trim()}>
          Add contact
        </button>
      </form>
      {rows.length === 0 ? (
        <EmptyState>No contacts match.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="deals-table contacts-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Title</th>
                <th>Organization</th>
                <th>Deal</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <input className="ghost-input strong" value={c.name} onChange={(e) => actions.updateContact(c.id, { name: e.target.value })} />
                  </td>
                  <td>
                    <input className="ghost-input" value={c.title} placeholder="—" onChange={(e) => actions.updateContact(c.id, { title: e.target.value })} />
                  </td>
                  <td>
                    <input className="ghost-input" value={c.organization} onChange={(e) => actions.updateContact(c.id, { organization: e.target.value })} />
                  </td>
                  <td>
                    <select
                      className="ghost-select"
                      value={c.dealId}
                      onChange={(e) => actions.updateContact(c.id, { dealId: e.target.value })}
                    >
                      <option value="">—</option>
                      {data.deals.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.title}
                        </option>
                      ))}
                    </select>
                    {c.dealId && (
                      <button className="link-btn small" onClick={() => openDeal(c.dealId)}>
                        open
                      </button>
                    )}
                  </td>
                  <td>
                    <input className="ghost-input" value={c.email} placeholder="—" onChange={(e) => actions.updateContact(c.id, { email: e.target.value })} />
                  </td>
                  <td>
                    <input className="ghost-input" value={c.phone} placeholder="—" onChange={(e) => actions.updateContact(c.id, { phone: e.target.value })} />
                  </td>
                  <td>
                    <input className="ghost-input muted" value={c.note} placeholder="—" onChange={(e) => actions.updateContact(c.id, { note: e.target.value })} />
                  </td>
                  <td>
                    <button className="icon-btn subtle" onClick={() => actions.removeContact(c.id)} aria-label="Remove contact">
                      🗑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
