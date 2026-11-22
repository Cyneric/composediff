import { deepEqual, equal, match, doesNotMatch } from 'node:assert/strict'
import { test } from 'node:test'
import { explainExample } from '../src/demo.ts'
import { explainCompose } from '../src/explain.ts'
import { buildReport } from '../src/report.ts'

const order = result => result.levels.map(level => level.map(service => service.name))

test('shows parallel services, dependency conditions, resources and YAML locations', () => {
  const result = explainCompose(explainExample.text)
  deepEqual(order(result), [['cache', 'db'], ['web']])
  deepEqual(result.resources.map(item => item.label), ['Default network', 'Volume db-data'])
  const [web] = result.levels[1]
  const wait = web.dependencies.find(item => item.text.includes('healthcheck'))
  equal(wait.text, 'Waits for db to pass its healthcheck.')
  equal(web.dependencies.find(item => item.text.includes('cache')).text, 'Waits for cache to start.')
  const lines = explainExample.text.split('\n')
  equal(lines[wait.location.line - 1].trim(), 'db:')
  const port = web.details.find(item => item.label === 'Port')
  match(port.text, /80\/tcp using host port 8080 on 127\.0\.0\.1/)
  match(lines[port.location.line - 1], /127\.0\.0\.1:8080:80/)
})

test('groups service references and distinguishes optional and completed dependencies', () => {
  const result = explainCompose(`services:
  init: { image: alpine }
  proxy:
    image: nginx
    network_mode: service:init
  app:
    image: alpine
    depends_on:
      init: { condition: service_completed_successfully }
      telemetry: { required: false }
    pid: service:proxy
  old:
    image: alpine
    links: ["proxy:upstream"]
    volumes_from: ["container:existing:ro"]
`)
  deepEqual(order(result), [['init'], ['proxy'], ['app', 'old']])
  const [app] = result.levels[2]
  match(app.dependencies[0].text, /exit successfully/)
  match(app.dependencies[1].text, /optional and not defined/)
  equal(result.unordered.length, 0)
})

test('keeps cycles, downstream services and missing requirements out of ordered groups', () => {
  const result = explainCompose(`services:
  a: { depends_on: [b] }
  b: { depends_on: [a] }
  downstream: { depends_on: [a] }
  missing: { depends_on: [ghost] }
  independent: { image: alpine }
`)
  deepEqual(order(result), [['independent']])
  deepEqual(result.unordered.map(step => step.name), ['a', 'b', 'downstream', 'missing'])
})

test('marks unresolved inputs without printing environment, command or secret values', () => {
  const result = explainCompose(`include: [base.yaml]
services:
  app:
    extends: { file: base.yaml, service: app }
    image: alpine
    ports: ["\${BINDING}"]
    profiles: [debug]
    environment: { TOKEN: private-value }
    command: "echo private-command"
    secrets: [token]
secrets:
  token: { file: private-path }
`)
  equal(result.notes.length, 3)
  const [app] = result.levels[0]
  match(app.details.find(item => item.label === 'Port').text, /Resolve variables/)
  match(app.details.find(item => item.label === 'Profiles').text, /debug/)
  doesNotMatch(JSON.stringify(result), /private-value|private-command|private-path/)
})

test('includes syntax error locations and rejects null service mappings', () => {
  const result = buildReport({ id: 1, view: 'explain', before: 'services:\n  app: [', after: '' })
  equal(result.error.location.line, 2)
  const malformed = buildReport({ id: 2, view: 'explain', before: 'include: base.yml\nservices: null', after: '' })
  match(malformed.error.message, /services mapping/)
})

test('ignores interpolation in comments and escaped dollar signs', () => {
  const result = explainCompose('services: {app: {image: alpine, command: "echo $$LITERAL"}} # $COMMENT')
  equal(result.notes.length, 0)
})
