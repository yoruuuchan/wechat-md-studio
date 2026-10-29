import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRUSTED_PROXY_CIDRS,
  clientIp,
  parseTrustedProxyCidrs,
} from './client-ip'

describe('parseTrustedProxyCidrs', () => {
  it('canonicalizes exact addresses and CIDR networks', () => {
    expect(
      parseTrustedProxyCidrs('127.0.0.1, 2001:0db8::0/32, ::ffff:192.0.2.4/32'),
    ).toEqual(['127.0.0.1/32', '2001:db8::/32', '192.0.2.4/32'])
  })

  it('treats an explicit empty value as direct-only', () => {
    expect(parseTrustedProxyCidrs('')).toEqual([])
    expect(parseTrustedProxyCidrs('   ')).toEqual([])
  })

  it.each([
    'not-an-ip',
    '10.0.0.0/33',
    '2001:db8::/129',
    '10.0.0.0/nope',
    '10.0.0.0,,127.0.0.1',
    '10.0.0.0/8/16',
  ])('rejects malformed proxy boundary %s', (raw) => {
    expect(parseTrustedProxyCidrs(raw)).toBeNull()
  })
})

describe('clientIp', () => {
  it('uses CF-Connecting-IP only when the socket peer is trusted', () => {
    const headers = new Headers({
      'cf-connecting-ip': '203.0.113.9',
      'x-forwarded-for': '198.51.100.1, 10.0.0.1',
    })
    expect(clientIp(headers, '127.0.0.1')).toBe('203.0.113.9')
  })

  it('ignores forged forwarding headers sent directly by an untrusted peer', () => {
    const headers = new Headers({
      'cf-connecting-ip': '203.0.113.9',
      'x-real-ip': '203.0.113.10',
      'x-forwarded-for': '203.0.113.11, 10.0.0.1',
    })
    expect(clientIp(headers, '198.51.100.20')).toBe('198.51.100.20')
  })

  it('uses the direct peer when a trusted proxy sends no forwarded address', () => {
    expect(clientIp(new Headers(), '127.0.0.1')).toBe('127.0.0.1')
  })

  it('walks a multi-hop forwarding chain from the nearest proxy', () => {
    const trusted = parseTrustedProxyCidrs('127.0.0.0/8,10.0.0.0/8')!
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.99, 198.51.100.7, 10.0.0.2, 10.0.0.3',
    })
    expect(clientIp(headers, '127.0.0.1', trusted)).toBe('198.51.100.7')
  })

  it('returns the leftmost address when every forwarding hop is trusted', () => {
    const trusted = parseTrustedProxyCidrs('127.0.0.0/8,10.0.0.0/8')!
    const headers = new Headers({ 'x-forwarded-for': '10.0.0.8, 10.0.0.2, 10.0.0.3' })
    expect(clientIp(headers, '127.0.0.1', trusted)).toBe('10.0.0.8')
  })

  it.each([
    { 'cf-connecting-ip': '', 'x-real-ip': '203.0.113.9' },
    { 'cf-connecting-ip': 'not-an-ip', 'x-forwarded-for': '203.0.113.9' },
    { 'x-real-ip': ' ' },
    { 'x-forwarded-for': '203.0.113.9,,10.0.0.1' },
    { 'x-forwarded-for': '203.0.113.9, nope' },
  ])('fails closed on an empty or malformed trusted header %#', (entries) => {
    expect(clientIp(new Headers(entries), '127.0.0.1')).toBe('127.0.0.1')
  })

  it('canonicalizes IPv4, IPv6 and IPv4-mapped IPv6 identities', () => {
    expect(clientIp(new Headers({ 'cf-connecting-ip': '203.0.113.9' }), '127.0.0.1')).toBe(
      '203.0.113.9',
    )
    expect(
      clientIp(new Headers({ 'cf-connecting-ip': '2001:0db8:0:0::1' }), '::1'),
    ).toBe('2001:db8::1')
    expect(
      clientIp(new Headers({ 'cf-connecting-ip': '::ffff:c000:0201' }), '::ffff:127.0.0.1'),
    ).toBe('192.0.2.1')
  })

  it('supports an IPv6 trusted proxy boundary', () => {
    const trusted = parseTrustedProxyCidrs('::1/128')!
    expect(
      clientIp(new Headers({ 'cf-connecting-ip': '2001:db8::7' }), '0:0:0:0:0:0:0:1', trusted),
    ).toBe('2001:db8::7')
  })

  it('uses one unattributed bucket when the runtime has no peer metadata', () => {
    const headers = new Headers({ 'cf-connecting-ip': '203.0.113.9' })
    expect(clientIp(headers, undefined)).toBe('unattributed')
    expect(clientIp(headers, null)).toBe('unattributed')
  })

  it('keeps the documented loopback default aligned with the tunnel deployment', () => {
    expect([...DEFAULT_TRUSTED_PROXY_CIDRS]).toEqual(['127.0.0.1/32', '::1/128'])
  })
})
