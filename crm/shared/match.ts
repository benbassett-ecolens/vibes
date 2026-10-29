/** Pure matching of an email domain to a company name. Used by the linker and tested directly. */

export const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'mail.com', 'comcast.net', 'att.net', 'verizon.net', 'ymail.com', 'hey.com', 'fastmail.com'])

const SUFFIXES = ['inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'group', 'holdings', 'software', 'consulting', 'services', 'solutions', 'technologies', 'technology', 'tech', 'systems', 'labs', 'events', 'the']

export function domainLabel(domain: string): string {
  const parts = domain.toLowerCase().split('.')
  // strip TLD and common second-level TLDs (co.uk, com.au)
  if (parts.length >= 3 && ['co', 'com', 'org', 'net', 'ac', 'gov'].includes(parts[parts.length - 2])) parts.splice(-2, 2)
  else parts.pop()
  return parts[parts.length - 1] ?? ''
}

export function normalizeName(name: string): { words: string[]; compact: string; compactRaw: string; initials: string } {
  const raw = name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  const words = raw.filter((w) => !SUFFIXES.includes(w))
  const base = words.length ? words : raw
  return { words: base, compact: base.join(''), compactRaw: raw.join(''), initials: base.map((w) => w[0]).join('') }
}

export interface MatchResult { score: number; reason: string }

/** 0..1 confidence that `domain` belongs to the company called `name`. */
export function scoreDomainAgainstName(domain: string, name: string, companyDomain?: string | null): MatchResult | null {
  const d = domain.toLowerCase()
  if (!d || FREE_MAIL.has(d)) return null
  if (companyDomain && companyDomain.toLowerCase() === d) return { score: 1, reason: 'company domain' }
  const label = domainLabel(d).replace(/[^a-z0-9]/g, '')
  if (label.length < 3) return null
  const { words, compact, compactRaw, initials } = normalizeName(name)
  if (!compact) return null
  if (label === compact || label === compactRaw) return { score: 0.95, reason: 'name = domain' }
  if (label.length >= 4 && words[0] === label) return { score: 0.85, reason: 'first word = domain' }
  if (label.length >= 5 && (compact.startsWith(label) || label.startsWith(compact))) return { score: 0.8, reason: 'prefix match' }
  if (label.length >= 5 && compact.includes(label)) return { score: 0.7, reason: 'domain in name' }
  if (words.length >= 2 && label.length >= 3 && label === initials) return { score: 0.6, reason: 'initials' }
  if (label.length >= 6 && words.some((w) => w.length >= 5 && label.includes(w))) return { score: 0.55, reason: 'word in domain' }
  return null
}

export function bestCompanyForDomain<T extends { id: string; name: string; domain?: string | null }>(domain: string, companies: T[]): Array<{ company: T } & MatchResult> {
  const out: Array<{ company: T } & MatchResult> = []
  for (const c of companies) {
    const m = scoreDomainAgainstName(domain, c.name, c.domain)
    if (m) out.push({ company: c, ...m })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3)
}
