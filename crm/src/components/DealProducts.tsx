import { useState } from 'react'
import { api } from '../api'
import { money } from '../format'
import { useQuery } from '../hooks'
import { PRICING_LABEL } from '../../shared/pricing'
import { ConfirmButton, useToast } from './ui'
import type { DealProduct, Product } from '../../shared/types'

export function DealProducts({ dealId, currency, onChanged }: { dealId: string; currency: string; onChanged: () => void }) {
  const toast = useToast()
  const lines = useQuery(() => api.get<{ items: DealProduct[] }>(`/api/deals/${dealId}/products`), [dealId])
  const products = useQuery(() => api.get<{ items: Product[] }>('/api/products'), [])
  const [adding, setAdding] = useState<string>('')
  const [draft, setDraft] = useState<Record<string, Partial<DealProduct>>>({})
  const run = async (fn: () => Promise<{ items: DealProduct[] }>, msg?: string) => {
    try {
      const r = await fn()
      lines.setData(r)
      if (msg) toast(msg)
      onChanged()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const add = async () => {
    if (!adding) return
    await run(() => api.post(`/api/deals/${dealId}/products`, { product_id: adding }), 'Product added')
    setAdding('')
  }
  const save = async (l: DealProduct) => {
    const d = draft[l.id]
    if (!d) return
    await run(() => api.patch(`/api/deals/${dealId}/products/${l.id}`, d), 'Saved')
    setDraft((x) => { const n = { ...x }; delete n[l.id]; return n })
  }
  const items = lines.data?.items ?? []
  const total = items.reduce((s, l) => s + (l.line_total ?? 0), 0)
  const num = (l: DealProduct, k: 'quantity' | 'unit_price' | 'term_months' | 'basis_amount', step = '0.01', width = 90) => (
    <input className="input sm" type="number" step={step} min={0} style={{ width }} value={String(draft[l.id]?.[k] ?? l[k])} onChange={(e) => setDraft((x) => ({ ...x, [l.id]: { ...x[l.id], [k]: Number(e.target.value) } }))} onBlur={() => save(l)} />
  )
  return (
    <div className="card">
      <div className="card-h"><h2>Products</h2><span className="muted small right">{items.length ? 'deal amount = sum of lines' : 'add products to price the deal'}</span></div>
      <div className="card-b" style={{ padding: items.length ? 0 : 16 }}>
        {items.length > 0 && (
          <table className="table">
            <thead><tr><th>Product</th><th>Pricing</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Months / basis</th><th className="num">Line total</th><th /></tr></thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.id}>
                  <td><strong>{l.product_name}</strong></td>
                  <td className="muted small">{PRICING_LABEL[l.pricing_type]}</td>
                  <td className="num">{l.pricing_type === 'percent' ? '—' : num(l, 'quantity', '1', 64)}</td>
                  <td className="num">{num(l, 'unit_price')}{l.pricing_type === 'percent' && <span className="muted small"> %</span>}</td>
                  <td className="num">{l.pricing_type === 'monthly' ? num(l, 'term_months', '1', 64) : l.pricing_type === 'percent' ? num(l, 'basis_amount', '0.01', 120) : '—'}</td>
                  <td className="num"><strong>{money(l.line_total, currency)}</strong></td>
                  <td><ConfirmButton className="btn ghost sm" label="✕" confirmLabel="Remove?" onConfirm={() => run(() => api.delete(`/api/deals/${dealId}/products/${l.id}`), 'Removed')} /></td>
                </tr>
              ))}
              <tr><td colSpan={5} className="num"><strong>Total</strong></td><td className="num"><strong>{money(total, currency)}</strong></td><td /></tr>
            </tbody>
          </table>
        )}
        <div className="row" style={{ padding: items.length ? '10px 12px' : 0 }}>
          <select className="select sm" value={adding} onChange={(e) => setAdding(e.target.value)} style={{ width: 'auto' }}>
            <option value="">Add a product…</option>
            {(products.data?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} ({PRICING_LABEL[p.pricing_type]}{p.unit_price ? ` · ${p.pricing_type === 'percent' ? `${p.unit_price}%` : money(p.unit_price, currency)}` : ''})</option>)}
          </select>
          <button className="btn sm primary" disabled={!adding} onClick={add}>Add</button>
        </div>
      </div>
    </div>
  )
}
