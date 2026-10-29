import { describe, expect, it } from 'vitest'
import { bestCompanyForDomain, domainLabel, scoreDomainAgainstName } from './match'

describe('domain ↔ company matching', () => {
  it('extracts labels', () => {
    expect(domainLabel('rockton.com')).toBe('rockton')
    expect(domainLabel('mail.phocas.co.uk')).toBe('phocas')
    expect(domainLabel('sub.dept.example.org')).toBe('example')
  })
  it('scores common shapes', () => {
    expect(scoreDomainAgainstName('rockton.com', 'Rockton Software')?.score).toBe(0.95) // 'software' suffix ignored
    expect(scoreDomainAgainstName('rocktonsoftware.com', 'Rockton Software')?.score).toBe(0.95)
    expect(scoreDomainAgainstName('fazeshift.com', 'Fazeshift')?.score).toBe(0.95)
    expect(scoreDomainAgainstName('psi.de', 'PSI Software')?.score).toBe(0.95)
    expect(scoreDomainAgainstName('summit.com', 'Summit Outdoor Co')?.score).toBe(0.85)
    expect(scoreDomainAgainstName('anchorgrp.com', 'Anchor Group')?.score).toBe(0.8)
    expect(scoreDomainAgainstName('idynamics.com', 'iDynamics')?.score).toBe(0.95)
    expect(scoreDomainAgainstName('acme.com', 'Acme Inc.', 'acme.com')?.score).toBe(1)
  })
  it('rejects free mail and unrelated names', () => {
    expect(scoreDomainAgainstName('gmail.com', 'Gmail Consulting')).toBeNull()
    expect(scoreDomainAgainstName('northwind.com', 'Cargas')).toBeNull()
    expect(scoreDomainAgainstName('ab.io', 'Alpha Beta')).toBeNull()
  })
  it('ranks candidates', () => {
    const cs = [{ id: '1', name: 'Cargas' }, { id: '2', name: 'Rockton Software' }, { id: '3', name: 'Rockton Holdings', domain: 'rockton.com' }]
    const r = bestCompanyForDomain('rockton.com', cs)
    expect(r.map((x) => x.company.id)).toEqual(['3', '2'])
  })
})
