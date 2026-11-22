import { isMap, isNode, isScalar, isSeq, LineCounter, parseDocument } from 'yaml'
import { MAX_INPUT } from './limits.ts'

export type Value = null | string | number | boolean | Value[] | Mapping
export type Mapping = { [key: string]: Value }
export type Location = { line: number; column: number }

export class YamlError extends Error {
  readonly line: number
  readonly column: number

  constructor(message: string, line: number, column: number) {
    super(`Line ${line}, column ${column}: ${message}`)
    this.line = line
    this.column = column
  }
}

export function mapping(value: unknown): value is Mapping {
  return Object.prototype.toString.call(value) === '[object Object]'
}

export function normalize(input: unknown): Value {
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

export function readComposeYaml(source: string) {
  if (source.length > MAX_INPUT) throw Error('Use files with at most 500,000 characters.')
  const lineCounter = new LineCounter()
  const doc = parseDocument(source, { merge: true, prettyErrors: false, lineCounter })
  const problem = doc.errors[0] ?? doc.warnings[0]
  if (problem) {
    const { line, col } = lineCounter.linePos(problem.pos[0])
    throw new YamlError(problem.message, line, col)
  }
  const data = normalize(doc.toJS({ maxAliasCount: 50 }))
  if (!mapping(data)) throw Error('Expected a Compose mapping.')

  const keys = new WeakMap<object, Map<string, { key: unknown; value: unknown }>>()
  function locate(path: (string | number)[]): Location | undefined {
    let node: unknown = doc.contents
    let offset: number | undefined
    for (const part of path) {
      if (isSeq(node) && typeof part === 'number') {
        node = node.items[part]
        if (isNode(node)) offset = node.range?.[0] ?? offset
      } else if (isMap(node) && typeof part === 'string') {
        let entries = keys.get(node)
        if (!entries) {
          entries = new Map()
          for (const item of node.items) if (isScalar(item.key)) entries.set(String(item.key.value), item)
          keys.set(node, entries)
        }
        const item = entries.get(part)
        if (!item) break
        if (isNode(item.key)) offset = item.key.range?.[0] ?? offset
        node = item.value
      } else break
    }
    if (offset === undefined) return
    const { line, col } = lineCounter.linePos(offset)
    return { line, column: col }
  }
  return { data, locate }
}
