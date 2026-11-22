import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReport } from '../src/report.ts'
import { markdown } from '../src/markdown.ts'

const report = (view, before, after) => buildReport({ id: 0, view, before, after })

test('reports invalid YAML on the affected side and still allows a source diff', () => {
  const before = 'services: {}\n', after = 'services: [\n'
  assert.equal(report('changes', before, after).errors[0], undefined)
  const error = report('changes', before, after).errors[1]
  assert.match(error.message, /Line/)
  assert.equal(error.location.line, 2)
  assert.deepEqual(report('source', before, after).hunks[0].lines, ['-services: {}', '+services: ['])
})

test('source diff includes comment-only edits', () => {
  const before = 'services: {}\n', after = '# note\nservices: {}\n'
  assert.deepEqual(report('changes', before, after).changes, [])
  assert.deepEqual(report('source', before, after).hunks[0].lines, ['+# note', ' services: {}'])
})

test('Markdown escapes headings and keeps values inside code fences', () => {
  const result = markdown([{ scope: 'Service', name: '#db', title: 'command changed', key: 'command',
    action: 'changed', after: 'printf "````"' }], [])
  assert.ok(result.includes('\\#db'))
  assert.ok(result.includes('\n`````text\nprintf "````"\n`````\n'))
})
