import { LineCounter, parseDocument, stringify } from 'yaml'
import { MAX_INPUT } from './limits.ts'

type Value = null | string | number | boolean | Value[] | { [key: string]: Value }
type Mapping = { [key: string]: Value }
type Port = { key: string; host: string; published: string; value: string }
type Service = {
  fields: Mapping
  ports: Map<string, Port[]>
  mounts: Map<string, Value>
}
type Compose = { services: Map<string, Service>; project: Mapping; notes: string[] }
export type Change = {
  scope: 'Service' | 'Project'
  name: string
  key: string
  title: string
  action: 'added' | 'removed' | 'changed'
  before?: string
  after?: string
  warning?: string
}

function mapping(value: unknown): value is Mapping {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function normalize(input: unknown): Value {
  let remaining = 60_000
  const ancestors = new Set<object>()
  function visit(value: unknown, depth: number): Value {
    if (--remaining < 0 || depth > 100) throw Error('This YAML has too many values or levels of nesting.')
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (!Array.isArray(value) && !mapping(value)) throw Error('Expected plain YAML values with finite numbers.')
    if (ancestors.has(value)) throw Error('This YAML contains a circular alias.')
    ancestors.add(value)
    const result = Array.isArray(value)
      ? value.map(item => visit(item, depth + 1))
      : Object.fromEntries(Object.keys(value).sort().map(key => [key, visit(value[key], depth + 1)]))
    ancestors.delete(value)
    return result
  }
  return visit(input, 0)
}

function list(value: Value | undefined, path: string) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw Error(`${path} must be a list.`)
  return value
}

function text(value: Value | undefined, path: string): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  throw Error(`Expected a string or number in ${path}.`)
}

function display(value: Value): string {
  return typeof value === 'string' && value.length > 0 && !/^\s|\s$|\n/.test(value)
    ? value : stringify(value, { lineWidth: 0 }).trimEnd()
}

function port(item: Value, path: string): Port {
  let host = '', published = '', protocol = 'tcp', target: string
  let options: Mapping = {}
  if (mapping(item)) {
    const { host_ip, published: rawPublished, target: rawTarget, protocol: rawProtocol, mode, ...rest } = item
    host = host_ip == null ? '' : text(host_ip, path)
    published = rawPublished == null ? '' : text(rawPublished, path)
    target = text(rawTarget, path)
    protocol = rawProtocol == null ? 'tcp' : text(rawProtocol, path)
    options = mode == null || mode === 'ingress' ? rest : { ...rest, mode }
  } else {
    const raw = text(item, path)
    const match = raw.match(/^(?:(?:(\[[^\]]+\]|[^:/]+):)?(\d+(?:-\d+)?|):)?(\d+(?:-\d+)?)(?:\/(tcp|udp|sctp))?$/)
    if (!match) {
      if (raw.includes('$')) return { key: raw, host, published, value: raw }
      throw Error(`Could not read the port in ${path}. Try quoting it or using long syntax.`)
    }
    host = match[1] ?? ''
    published = match[2] ?? ''
    target = match[3]
    protocol = match[4] ?? 'tcp'
  }
  host = host.replace(/^\[(.*)\]$/, '$1').toLowerCase()
  const address = host.includes(':') ? `[${host}]` : host
  const key = `${target}/${protocol}`
  const binding = `${address ? `${address}:` : ''}${published || address ? `${published}:` : ''}${key}`
  return { key, host, published, value: Object.keys(options).length ? `${binding}\n${display(options)}` : binding }
}

function mount(item: Value, path: string): [string, Value] {
  if (mapping(item) && typeof item.target === 'string') {
    const { target, source, type = 'volume', read_only = false, ...rest } = item
    if (type === 'bind' && mapping(rest.bind)) {
      const { create_host_path = false, ...options } = rest.bind
      delete rest.bind
      if (create_host_path !== false) options.create_host_path = create_host_path
      if (Object.keys(options).length) rest.bind = options
    }
    if (type === 'volume' && mapping(rest.volume)) {
      const { nocopy = false, ...options } = rest.volume
      delete rest.volume
      if (nocopy !== false) options.nocopy = nocopy
      if (Object.keys(options).length) rest.volume = options
    }
    return [target, normalize({ type, ...(source == null ? {} : { source }), target, read_only, ...rest })]
  }
  if (typeof item !== 'string') throw Error(`Expected a mount string or mapping with a target in ${path}.`)
  const fields: string[] = []
  const part = /(?:[a-zA-Z]:[\\/])?(?:\$\{[^}]*\}|[^:])*/y
  let offset = 0
  do {
    part.lastIndex = offset
    const value = part.exec(item)?.[0] ?? ''
    fields.push(value)
    offset += value.length + 1
  } while (offset <= item.length && fields.length < 4)
  if (fields.some(field => !field) || fields.length > 3) throw Error(`Could not read the mount in ${path}.`)
  const [source, target, mode] = fields.length === 1 ? ['', fields[0], 'rw'] : fields
  const type = /^(?:[./~\\]|[a-zA-Z]:[\\/])/.test(source) ? 'bind' : 'volume'
  let readOnly = false
  const bind: Mapping = { create_host_path: true }
  const volume: Mapping = {}
  const options: string[] = []
  for (const option of (mode ?? 'rw').split(',')) {
    if (option === 'ro' || option === 'rw') readOnly = option === 'ro'
    else if (type === 'volume' && option === 'nocopy') volume.nocopy = true
    else if (type === 'bind' && /^(r?private|r?shared|r?slave)$/.test(option)) bind.propagation = option
    else if (type === 'bind' && (option === 'z' || option === 'Z')) bind.selinux = option
    else options.push(option)
  }
  const value: Value = {
    type, ...(source ? { source } : {}), target, read_only: readOnly,
    ...(type === 'bind' ? { bind } : {}),
    ...(Object.keys(volume).length ? { volume } : {}),
    ...(options.length ? { options: options.sort() } : {}),
  }
  return [target, normalize(value)]
}

function keyed(value: Value, path: string, separator: string): Mapping {
  if (mapping(value)) return value
  return Object.fromEntries(list(value, path).map((item): [string, Value] => {
    const entry = text(item, path)
    const index = entry.indexOf(separator)
    return index < 0 ? [entry, null] : [entry.slice(0, index), entry.slice(index + 1)]
  }).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
}

function normalizeService(service: Mapping, name: string): Service {
  const { ports, volumes, ...fields } = service
  if ('extends' in fields) throw Error(`Resolve extends in ${name} with docker compose config.`)
  for (const field of ['environment', 'labels', 'sysctls', 'storage_opt']) {
    if (fields[field] === undefined) continue
    const entries = keyed(fields[field], `${name}.${field}`, '=')
    fields[field] = normalize(field === 'environment' || field === 'labels'
      ? Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, value === null ? null : text(value, `${name}.${field}`)]))
      : entries)
  }
  for (const field of ['networks', 'depends_on']) {
    if (!Array.isArray(fields[field])) continue
    fields[field] = normalize(Object.fromEntries(fields[field].map(item => [
      text(item, `${name}.${field}`), field === 'depends_on' ? { condition: 'service_started' } : {},
    ])))
  }
  for (const field of ['networks', 'depends_on']) {
    if (!mapping(fields[field])) continue
    fields[field] = normalize(Object.fromEntries(Object.entries(fields[field]).map(([key, config]) => {
      if (field === 'networks') return [key, config ?? {}]
      if (!mapping(config)) throw Error(`Expected dependency options in ${name}.${field}.${key}.`)
      const { restart = false, required = true, condition = 'service_started', ...rest } = config
      return [key, { condition, ...(restart !== false ? { restart } : {}), ...(required !== true ? { required } : {}), ...rest }]
    })))
  }
  for (const field of ['profiles', 'cap_add', 'cap_drop', 'expose']) {
    if (fields[field] !== undefined) fields[field] = [...new Set(list(fields[field], `${name}.${field}`).map(item => text(item, `${name}.${field}`)))].sort()
  }
  const bindings = new Map<string, Port[]>()
  for (const item of list(ports, `${name}.ports`)) {
    const entry = port(item, `${name}.ports`)
    const group = bindings.get(entry.key)
    if (group) group.push(entry)
    else bindings.set(entry.key, [entry])
  }
  const mounts = new Map<string, Value>()
  for (const item of list(volumes, `${name}.volumes`)) {
    const [target, entry] = mount(item, `${name}.volumes`)
    if (mounts.has(target)) throw Error(`${name}.volumes has more than one mount for ${target}.`)
    mounts.set(target, entry)
  }
  return { fields, ports: bindings, mounts }
}

export function parseCompose(source: string): Compose {
  if (source.length > MAX_INPUT) throw Error('Use files with at most 500,000 characters.')
  const lineCounter = new LineCounter()
  const doc = parseDocument(source, { merge: true, prettyErrors: false, lineCounter })
  const problem = doc.errors[0] ?? doc.warnings[0]
  if (problem) {
    const { line, col } = lineCounter.linePos(problem.pos[0])
    throw Error(`Line ${line}, column ${col}: ${problem.message}`)
  }
  const data: unknown = doc.toJS({ maxAliasCount: 50 })
  if (!mapping(data) || !mapping(data.services)) throw Error('Expected a top-level services mapping.')
  if ('include' in data) throw Error('Resolve include with docker compose config.')
  const clean = normalize(data)
  if (!mapping(clean) || !mapping(clean.services)) throw Error('Expected a top-level services mapping.')
  const { services, version, ...project } = clean
  const notes: string[] = []
  if (/\$(?:\{|\w)/.test(source)) notes.push('Variables are compared as written. Resolve them with docker compose config to compare their values.')
  const entries = new Map<string, Service>()
  for (const [name, service] of Object.entries(services)) {
    if (!mapping(service)) throw Error(`Expected a mapping for service ${name}.`)
    entries.set(name, normalizeService(service, name))
  }
  return { services: entries, project, notes }
}

function union<T>(a: Iterable<T>, b: Iterable<T>) {
  return [...new Set([...a, ...b])].sort()
}

function properties(value: Mapping) {
  return new Map(Object.entries(value).filter(([key]) => !key.startsWith('x-')))
}

function equal(a: Value | undefined, b: Value | undefined) {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

function action(a: unknown, b: unknown): Change['action'] {
  return a === undefined ? 'added' : b === undefined ? 'removed' : 'changed'
}

const loopback = /^(?:127\.\d+\.\d+\.\d+|::1|0:0:0:0:0:0:0:1)$/
const wildcard = new Set(['', '0.0.0.0', '::', '0:0:0:0:0:0:0:0'])
const portWarning = 'Docker may now accept connections to this port from other hosts. Check the host binding and firewall rules.'
const privilegedWarning = 'Privileged mode gives this service expanded access to the host.'
const hostNetworkWarning = 'Where Docker supports host networking, this service shares the host network namespace.'

function widens(a: Port[], b: Port[]) {
  const local = new Set(a.filter(port => loopback.test(port.host)).map(port => port.published))
  const open = new Set(a.filter(port => wildcard.has(port.host)).map(port => port.published))
  return b.some(port => /^\d+(?:-\d+)?$/.test(port.published) &&
    local.has(port.published) && !open.has(port.published) && wildcard.has(port.host))
}

function serviceSummary(service: Service) {
  const image = service.fields.image
  const build = service.fields.build !== undefined
  return [typeof image === 'string' ? image : '', build ? 'Build configured' : '',
    service.ports.size ? `${service.ports.size} container port groups` : '',
    service.mounts.size ? `${service.mounts.size} mounts` : ''].filter(Boolean).join('\n') || undefined
}

export function compare(before: Compose, after: Compose): Change[] {
  const out: Change[] = []
  for (const name of union(before.services.keys(), after.services.keys())) {
    const a = before.services.get(name)
    const b = after.services.get(name)
    const scope = 'Service'
    if (!a || !b) {
      const verb = action(a, b)
      const warnings = [
        b?.fields.privileged === true && privilegedWarning,
        b?.fields.network_mode === 'host' && hostNetworkWarning,
      ].filter(Boolean)
      out.push({ scope, name, key: 'service', action: verb, title: `Service ${verb}`,
        before: a && serviceSummary(a), after: b && serviceSummary(b),
        warning: warnings.join(' ') || undefined })
      continue
    }
    for (const key of union(a.ports.keys(), b.ports.keys())) {
      const left = a.ports.get(key) ?? [], right = b.ports.get(key) ?? []
      const old = left.map(port => port.value).sort().join('\n') || undefined
      const next = right.map(port => port.value).sort().join('\n') || undefined
      if (old === next) continue
      const verb = action(old, next)
      const wider = widens(left, right)
      out.push({ scope, name, key: `port:${key}`, action: verb, before: old, after: next,
        title: wider ? `Port ${key} is no longer limited to loopback` : `Port ${key} ${verb}`,
        warning: wider ? portWarning : undefined })
    }
    for (const key of union(a.mounts.keys(), b.mounts.keys())) {
      const old = a.mounts.get(key), next = b.mounts.get(key)
      if (equal(old, next)) continue
      const verb = action(old, next)
      out.push({ scope, name, key: `mount:${key}`, action: verb, title: `Mount ${key} ${verb}`,
        before: old === undefined ? undefined : display(old), after: next === undefined ? undefined : display(next) })
    }
    const left = properties(a.fields), right = properties(b.fields)
    for (const field of union(left.keys(), right.keys())) {
      const old = left.get(field), next = right.get(field)
      if (equal(old, next)) continue
      if (field === 'environment') {
        const a = mapping(old) ? new Map(Object.entries(old)) : new Map<string, Value>()
        const b = mapping(next) ? new Map(Object.entries(next)) : new Map<string, Value>()
        const counts = { added: 0, removed: 0, changed: 0 }
        for (const key of union(a.keys(), b.keys())) {
          if (!equal(a.get(key), b.get(key))) counts[action(a.get(key), b.get(key))]++
        }
        const summary = Object.entries(counts).filter(([, count]) => count).map(([verb, count]) => `${count} ${verb}`).join(', ')
        if (summary) out.push({ scope, name, key: field, action: action(old, next), title: 'Environment variables updated', after: `${summary}. Names and values hidden.` })
        continue
      }
      const verb = action(old, next)
      const warning = field === 'privileged' && next === true ? privilegedWarning
        : field === 'network_mode' && next === 'host' ? hostNetworkWarning : undefined
      out.push({ scope, name, key: field, action: verb, title: field === 'image' ? `Image reference ${verb}` : `${field} ${verb}`,
        before: old === undefined ? undefined : display(old), after: next === undefined ? undefined : display(next), warning })
    }
  }
  const left = properties(before.project), right = properties(after.project)
  for (const section of union(left.keys(), right.keys())) {
    const a = left.get(section), b = right.get(section)
    if (equal(a, b)) continue
    const sections = new Set(['networks', 'volumes', 'configs', 'secrets'])
    const entries = sections.has(section) && (a === undefined || mapping(a)) && (b === undefined || mapping(b))
      ? union(Object.keys(a ?? {}), Object.keys(b ?? {})).map(key => ({ key, title: `${section}.${key}`, a: a?.[key], b: b?.[key] }))
      : [{ key: section, title: section, a, b }]
    for (const { key, title, a, b } of entries) {
      if (equal(a, b)) continue
      const verb = action(a, b)
      const conceal = section === 'secrets' || section === 'configs'
      out.push({ scope: 'Project', name: section, key, action: verb, title: `${title} ${verb}`,
        before: a === undefined ? undefined : conceal ? 'Definition hidden' : display(a),
        after: b === undefined ? undefined : conceal ? 'Definition hidden' : display(b) })
    }
  }
  return out
}
