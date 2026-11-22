import test from 'node:test'
import assert from 'node:assert/strict'
import { compare, parseCompose } from '../src/compare.ts'
import * as demo from '../src/demo.ts'

const service = config => parseCompose(JSON.stringify({ services: { db: config } }))

test('demo flags removal of the explicit loopback address', () => {
  const changes = compare(parseCompose(demo.before), parseCompose(demo.after))
  assert.equal(changes.length, 1)
  assert.equal(changes[0].attention, true)
  assert.equal(changes[0].service, 'postgres')
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

test('incomplete and unresolved documents cannot produce an empty diff', () => {
  for (const file of ['services: [', 'services: null', 'services: {db: {ports: 80}}', 'include: [db.yml]\nservices: {}']) {
    assert.throws(() => parseCompose(file))
  }
})
