import test from 'node:test'
import assert from 'node:assert/strict'
import { compare, parseCompose } from '../src/compare.ts'
import { example } from '../src/demo.ts'

const service = config => parseCompose(JSON.stringify({ services: { db: config } }))

test('demo flags removal of the explicit loopback address', () => {
  const [before, after] = example.map(input => parseCompose(input.text))
  const changes = compare(before, after)
  assert.equal(changes.length, 2)
  assert.match(changes[0].warning, /other hosts/)
  assert.equal(changes[0].name, 'postgres')
})

test('equivalent long syntax and reordered bindings do not create changes', () => {
  const a = service({ ports: ['[::1]:8000:80', '8080:80'], volumes: ['pg:/data:ro'] })
  const b = service({ ports: ['8080:80', { host_ip: '::1', target: 80, published: '8000' }],
    volumes: [{ type: 'volume', target: '/data', source: 'pg', read_only: true }] })
  assert.deepEqual(compare(a, b), [])
})

test('reports changed mount access, image digest, and removed services', () => {
  const a = service({ image: 'postgres@sha256:a', volumes: ['C:\\pg:/data:ro'] })
  const b = service({ image: 'postgres@sha256:b', volumes: ['C:\\pg:/data'] })
  assert.deepEqual(compare(a, b).map(x => x.title), ['Mount /data changed', 'Image reference changed'])
  assert.equal(compare(a, parseCompose('services: {}'))[0].title, 'Service removed')
})

test('matches mount options across syntax and preserves changes to host path creation', () => {
  const short = service({ volumes: ['./db:/data:ro,Z,rslave', 'data:/backup:nocopy'] })
  const long = {
    type: 'bind', source: './db', target: '/data', read_only: true,
    bind: { create_host_path: true, selinux: 'Z', propagation: 'rslave' },
  }
  const volume = { type: 'volume', source: 'data', target: '/backup', volume: { nocopy: true } }
  assert.deepEqual(compare(short, service({ volumes: [long, volume] })), [])
  const changes = compare(short, service({ volumes: [
    { ...long, bind: { ...long.bind, create_host_path: false } }, volume,
  ] }))
  assert.deepEqual(changes.map(change => change.title), ['Mount /data changed'])
})

test('incomplete and unresolved documents cannot produce an empty diff', () => {
  for (const file of ['services: [', 'services: null', 'services: {db: {ports: 80}}', 'include: [db.yml]\nservices: {}']) {
    assert.throws(() => parseCompose(file))
  }
})

test('compares environment values without including them in the report', () => {
  assert.deepEqual(compare(service({ environment: ['FOO=old', 'EMPTY='] }), service({ environment: { EMPTY: '', FOO: 'old' } })), [])
  const [change] = compare(service({ environment: ['FOO=old'] }), service({ environment: { FOO: 'new', ADDED: 'private' } }))
  assert.equal(change.title, 'Environment variables updated')
  assert.equal(change.after, '1 added, 1 changed. Names and values hidden.')
})

test('compares scalar environment variables, labels and sysctls as strings', () => {
  const a = service({ environment: { ENABLED: true }, labels: { enabled: false },
    sysctls: { 'net.ipv4.ip_forward': 1 }, storage_opt: { size: 1 } })
  const b = service({ environment: ['ENABLED=true'], labels: ['enabled=false'],
    sysctls: ['net.ipv4.ip_forward=1'], storage_opt: { size: '1' } })
  assert.deepEqual(compare(a, b), [])
})

test('compares project resources without printing secret or config contents', () => {
  const a = parseCompose('services: {}\nsecrets: {token: {file: ./token}}')
  const b = parseCompose('services: {}\nsecrets: {token: {file: ./next}}\nnetworks: {backend: {internal: true}}')
  const changes = compare(a, b)
  assert.deepEqual(changes.map(change => [change.scope, change.title]), [
    ['Project', 'networks.backend added'], ['Project', 'secrets.token changed'],
  ])
  assert.equal(changes[1].after, 'Definition hidden')
})

test('compares project resource names that also exist on Object.prototype', () => {
  const a = parseCompose('services: {}\nvolumes: {constructor: {}}')
  const b = parseCompose('services: {}\nvolumes: {toString: {}}')
  assert.deepEqual(compare(a, b).map(change => change.title), [
    'volumes.constructor removed', 'volumes.toString added',
  ])
})

test('ignores extension fields, comments, map order and common equivalent syntax', () => {
  const a = service({ depends_on: ['db2'], networks: ['backend'], labels: ['yes=1'], profiles: ['tools', 'dev'], 'x-note': 1 })
  const b = service({ profiles: ['dev', 'tools'], depends_on: { db2: { required: true } },
    labels: { yes: 1 }, networks: { backend: null } })
  assert.deepEqual(compare(a, b), [])
})

test('warns when one binding widens even if the service has several bindings', () => {
  const a = service({ ports: ['127.0.0.1:8000:80', '8080:80'] })
  const b = service({ ports: ['0.0.0.0:8000:80', '8080:80'] })
  assert.ok(compare(a, b)[0].warning)
  assert.equal(compare(b, a)[0].warning, undefined)
})

test('preserves unresolved interpolation without making a port exposure claim', () => {
  const a = service({ ports: ['127.0.0.1:${PORT:-80}:80'] })
  const b = service({ ports: ['${PORT:-80}:80'] })
  assert.ok(a.notes.length)
  assert.equal(compare(a, b).some(change => change.warning), false)
})

test('flags privileged mode and host networking', () => {
  const changes = compare(service({}), service({ privileged: true, network_mode: 'host' }))
  assert.equal(changes.filter(change => change.warning).length, 2)
  const [added] = compare(parseCompose('services: {}'), service({ privileged: true, network_mode: 'host' }))
  assert.match(added.warning, /Privileged mode/)
  assert.match(added.warning, /host network namespace/)
})

test('reports YAML syntax locations and rejects circular or excessive input', () => {
  assert.throws(() => parseCompose('services:\n  db: ['), /Line 2, column/)
  assert.throws(() => parseCompose('services: &root {db: {x-value: *root}}'), /circular|alias/i)
  assert.throws(() => parseCompose(' '.repeat(500_001)), /500,000/)
})
