import { isIP } from 'node:net'

export const DEFAULT_TRUSTED_PROXY_CIDRS = ['127.0.0.1/32', '::1/128'] as const

interface ParsedCidr {
  version: 4 | 6
  network: bigint
  prefix: number
}

const IPV4_BITS = 32
const IPV6_BITS = 128

function ipv4ToBigInt(ip: string): bigint {
  return ip.split('.').reduce((value, part) => (value << 8n) | BigInt(Number(part)), 0n)
}

function ipv4FromBigInt(value: bigint): string {
  return [24n, 16n, 8n, 0n]
    .map((shift) => String((value >> shift) & 0xffn))
    .join('.')
}

function ipv6FromBigInt(value: bigint): string {
  const groups = value.toString(16).padStart(32, '0').match(/.{4}/g)!
  return new URL(`http://[${groups.join(':')}]/`).hostname.slice(1, -1)
}

function ipv6ToBigInt(ip: string): bigint {
  let expanded = ip.split('%')[0]

  // IPv4 can be embedded in the final two IPv6 groups.
  if (expanded.includes('.')) {
    const lastColon = expanded.lastIndexOf(':')
    const embedded = expanded.slice(lastColon + 1)
    const octets = embedded.split('.').map(Number)
    expanded =
      expanded.slice(0, lastColon + 1) +
      `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`
  }

  const [left, right = ''] = expanded.split('::')
  const leftParts = left ? left.split(':') : []
  const rightParts = right ? right.split(':') : []
  const missing = 8 - leftParts.length - rightParts.length
  const parts = [...leftParts, ...Array.from({ length: missing }, () => '0'), ...rightParts]

  return parts.reduce((value, part) => (value << 16n) | BigInt(parseInt(part, 16)), 0n)
}

/** Canonical form makes equivalent IPv6 spellings share one rate-limit bucket. */
function canonicalIp(value: string): string | null {
  const ip = value.trim()
  const version = isIP(ip)

  if (version === 4) return ip
  if (version !== 6) return null

  const withoutZone = ip.split('%')[0]
  const numeric = ipv6ToBigInt(withoutZone)

  // Node commonly reports an IPv4 peer as ::ffff:a.b.c.d. Keep that peer in
  // the same bucket as its plain IPv4 form.
  if (numeric >> 32n === 0xffffn) return ipv4FromBigInt(numeric & 0xffffffffn)

  return ipv6FromBigInt(numeric)
}

function prefixBits(version: 4 | 6): number {
  return version === 4 ? IPV4_BITS : IPV6_BITS
}

function maskIp(value: bigint, prefix: number, bits: number): bigint {
  if (prefix === 0) return 0n
  const shift = BigInt(bits - prefix)
  return (value >> shift) << shift
}

function parseCidr(value: string): ParsedCidr | null {
  const slash = value.indexOf('/')
  if (slash !== value.lastIndexOf('/')) return null

  const address = canonicalIp(slash === -1 ? value : value.slice(0, slash))
  if (!address) return null
  const version = isIP(address) as 4 | 6
  const bits = prefixBits(version)
  const rawPrefix = slash === -1 ? String(bits) : value.slice(slash + 1)
  if (!/^\d+$/.test(rawPrefix)) return null

  const prefix = Number(rawPrefix)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return null
  const numeric = version === 4 ? ipv4ToBigInt(address) : ipv6ToBigInt(address)
  return { version, network: maskIp(numeric, prefix, bits), prefix }
}

/**
 * Parse the operator-managed proxy boundary once during env validation.
 * An explicit empty string is valid and means direct-only deployments.
 */
export function parseTrustedProxyCidrs(raw: string): string[] | null {
  if (!raw.trim()) return []

  const parsed: string[] = []
  for (const entry of raw.split(',')) {
    const cidr = parseCidr(entry.trim())
    if (!cidr) return null
    const address =
      cidr.version === 4 ? ipv4FromBigInt(cidr.network) : ipv6FromBigInt(cidr.network)
    parsed.push(`${address}/${cidr.prefix}`)
  }
  return parsed
}

function isTrustedProxy(ip: string, trustedProxyCidrs: readonly string[]): boolean {
  const version = isIP(ip)
  if (version !== 4 && version !== 6) return false
  const numeric = version === 4 ? ipv4ToBigInt(ip) : ipv6ToBigInt(ip)
  const bits = prefixBits(version)

  return trustedProxyCidrs.some((raw) => {
    const cidr = parseCidr(raw)
    if (!cidr || cidr.version !== version) return false
    return maskIp(numeric, cidr.prefix, bits) === cidr.network
  })
}

function singleForwardedIp(raw: string): string | null {
  return canonicalIp(raw)
}

function forwardedChain(raw: string, trustedProxyCidrs: readonly string[]): string | null {
  const entries = raw.split(',').map((entry) => entry.trim())
  if (entries.length === 0 || entries.some((entry) => !entry)) return null

  const hops = entries.map(canonicalIp)
  if (hops.some((hop) => !hop)) return null

  // The nearest proxy appends the address it observed on the right. Walk back
  // through known proxies so a client-supplied left side cannot choose a bucket.
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i]!
    if (!isTrustedProxy(hop, trustedProxyCidrs)) return hop
  }
  return hops[0]!
}

/**
 * Resolve the rate-limit identity without trusting a header merely because it
 * exists. Forwarded addresses count only when the socket peer is a configured
 * proxy. Missing peer metadata is fail-closed and shares one unattributed bucket.
 */
export function clientIp(
  headers: Headers,
  remoteAddress: string | null | undefined,
  trustedProxyCidrs: readonly string[] = DEFAULT_TRUSTED_PROXY_CIDRS,
): string {
  const peer = canonicalIp(remoteAddress ?? '')
  if (!peer) return 'unattributed'
  if (!isTrustedProxy(peer, trustedProxyCidrs)) return peer

  // A malformed higher-priority header is ambiguous. Fall back to the known
  // proxy peer instead of combining values from an attacker-controlled chain.
  const cloudflare = headers.get('cf-connecting-ip')
  if (cloudflare !== null) return singleForwardedIp(cloudflare) ?? peer

  const realIp = headers.get('x-real-ip')
  if (realIp !== null) return singleForwardedIp(realIp) ?? peer

  const forwarded = headers.get('x-forwarded-for')
  if (forwarded !== null) return forwardedChain(forwarded, trustedProxyCidrs) ?? peer

  return peer
}
