import { parseDocument } from 'yaml'

type Mapping = Record<string, unknown>
type Entry = { key: string; value: string; host?: string; published?: string }
type Service = { image?: string; ports: Entry[]; volumes: Entry[] }
export type Change = { service: string; title: string; before?: string; after?: string; attention?: boolean }

function mapping(value: unknown): value is Mapping {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) => mapping(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]))
    : v)
}

function port(item: unknown): Entry {
  let host = '', published = '', protocol = 'tcp', target: string
  let options: Mapping = {}
  if (mapping(item) && item.target != null) {
    const { host_ip, published: p, target: t, protocol: proto, mode, ...rest } = item
    host = String(host_ip ?? '').replace(/^\[(.*)\]$/, '$1')
    published = String(p ?? '')
    target = String(t)
    protocol = String(proto ?? 'tcp')
    options = mode && mode !== 'ingress' ? { ...rest, mode } : rest
  } else {
    if (typeof item !== 'number' && typeof item !== 'string') throw Error('Expected a port number or mapping with a target.')
    const match = String(item).match(/^(?:(?:(\[[^\]]+\]|[^:/]+):)?([\d-]*):)?([\d-]+)(?:\/(tcp|udp|sctp))?$/)
    if (!match) throw Error('Unsupported port syntax. Paste the output of docker compose config.')
    host = (match[1] ?? '').replace(/^\[(.*)\]$/, '$1')
    published = match[2] ?? ''
    target = match[3]
    protocol = match[4] ?? 'tcp'
  }
  const ip = host.includes(':') ? `[${host}]` : host
  const value = `${ip ? ip + ':' : ''}${published || host ? published + ':' : ''}${target}/${protocol}`
  return { key: `${target}/${protocol}`, host, published, value: value + (Object.keys(options).length ? ' ' + stable(options) : '') }
}

function mount(item: unknown): Entry {
  if (mapping(item) && typeof item.target === 'string') {
    const { target, source, type, read_only, ...rest } = item
    const options = Object.keys(rest).length ? ' ' + stable(rest) : ''
    return { key: target, value: `${type ?? 'volume'} ${source ?? '(anonymous)'} → ${target} ${read_only ? 'ro' : 'rw'}${options}` }
  }
  if (typeof item !== 'string') throw Error('Expected a volume string or mapping with a target.')
  // A Windows drive letter is part of a path, not a field separator.
  const parts = item.match(/(?:[a-zA-Z]:[\\/][^:]*|[^:]+)/g) ?? []
  if (!parts.length || parts.length > 3) throw Error('Unsupported volume syntax. Paste the output of docker compose config.')
  const source = parts.length === 1 ? '' : parts[0]!
  const target = parts.length === 1 ? parts[0]! : parts[1]!
  const mode = parts[2]
  const type = /^(?:[./~\\]|[a-zA-Z]:[\\/])/.test(source) ? 'bind' : 'volume'
  return { key: target, value: `${type} ${source || '(anonymous)'} → ${target} ${mode ?? 'rw'}` }
}

export function parseCompose(text: string): Map<string, Service> {
  if (text.length > 500_000) throw Error('Use files smaller than 500,000 characters.')
  const doc = parseDocument(text, { merge: true, prettyErrors: false })
  const problem = doc.errors[0] ?? doc.warnings[0]
  if (problem) throw Error(problem.message)
  const data: unknown = doc.toJS({ maxAliasCount: 50 })
  if (!mapping(data) || !mapping(data.services)) throw Error('Expected a services: mapping.')
  if ('include' in data) throw Error('Resolve included files first with docker compose config.')
  const result = new Map<string, Service>()
  for (const [name, svc] of Object.entries(data.services)) {
    if (!mapping(svc)) throw Error(`Expected a mapping for service ${name}.`)
    if ('extends' in svc) throw Error('Resolve extended services first with docker compose config.')
    if (svc.image !== undefined && typeof svc.image !== 'string') throw Error(`Expected an image name in ${name}.`)
    function entries(field: string, list: unknown, convert: (item: unknown) => Entry) {
      if (list === undefined) return []
      if (!Array.isArray(list)) throw Error(`${name}.${field} must be a list.`)
      return list.map(convert)
    }
    result.set(name, { image: svc.image, ports: entries('ports', svc.ports, port), volumes: entries('volumes', svc.volumes, mount) })
  }
  return result
}

function groups(entries: Entry[]) {
  const result = new Map<string, Entry[]>()
  for (const entry of entries) {
    const group = result.get(entry.key)
    if (group) group.push(entry)
    else result.set(entry.key, [entry])
  }
  return result
}

export function compare(old: Map<string, Service>, next: Map<string, Service>): Change[] {
  const out: Change[] = []
  for (const service of [...new Set([...old.keys(), ...next.keys()])].sort()) {
    const a = old.get(service), b = next.get(service)
    if (!a || !b) {
      out.push({ service, title: b ? 'Service added' : 'Service removed', before: a?.image, after: b?.image })
      continue
    }
    for (const field of ['ports', 'volumes'] as const) {
      const left = groups(a[field]), right = groups(b[field])
      for (const key of new Set([...left.keys(), ...right.keys()])) {
        const l = left.get(key) ?? [], r = right.get(key) ?? []
        const before = l.map(x => x.value).sort().join('\n') || undefined
        const after = r.map(x => x.value).sort().join('\n') || undefined
        if (before === after) continue
        const wasLocal = l.length === 1 && /^(?:127\.\d+\.\d+\.\d+|::1)$/.test(l[0].host ?? '')
        const wider = field === 'ports' && wasLocal && r.length === 1 && ['', '0.0.0.0', '::'].includes(r[0].host ?? '') && l[0].published === r[0].published
        const action = !before ? 'added' : !after ? 'removed' : 'changed'
        const title = wider ? `Port ${key} is no longer bound to loopback` : `${field === 'ports' ? 'Port' : 'Mount'} ${key} ${action}`
        out.push({ service, title, before, after, attention: wider })
      }
    }
    if (a.image !== b.image) out.push({ service, title: 'Image reference changed', before: a.image, after: b.image })
  }
  return out
}
