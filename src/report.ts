import { structuredPatch } from 'diff'
import { compare, parseCompose, YamlError, type Change } from './compare.ts'
import { MAX_INPUT } from './limits.ts'

export type View = 'changes' | 'source'
export type Request = { id: number; view: View; before: string; after: string }
export type Diagnostic = { message: string; location?: { line: number; column: number } }
export type Semantic = { view: 'changes'; errors: [Diagnostic?, Diagnostic?]; changes: Change[]; notes: string[] }
export type Source = { view: 'source'; hunks: ReturnType<typeof structuredPatch>['hunks']; error?: string }
export type Result = Semantic | Source

function parse(text: string) {
  if (!text.trim()) return {}
  try {
    return { document: parseCompose(text) }
  } catch (error) {
    const diagnostic: Diagnostic = { message: error instanceof RangeError ? 'This YAML has too many levels of nesting.' :
      error instanceof Error ? error.message : 'Could not read this YAML.' }
    if (error instanceof YamlError) diagnostic.location = { line: error.line, column: error.column }
    return { error: diagnostic }
  }
}

export function buildReport({ view, before, after }: Request): Result {
  if (view === 'source') {
    if (Math.max(before.length, after.length) > MAX_INPUT) {
      return { view, hunks: [], error: 'Use files with at most 500,000 characters.' }
    }
    const patch = structuredPatch('before', 'after', before, after, undefined, undefined, { context: 3, timeout: 600 })
    return patch ? { view, hunks: patch.hunks } : { view, hunks: [], error: 'The source diff took too long. Compare smaller files or use Changes.' }
  }
  const a = parse(before), b = parse(after)
  return { view, errors: [a.error, b.error],
    changes: a.document && b.document ? compare(a.document, b.document) : [],
    notes: [...new Set([...(a.document?.notes ?? []), ...(b.document?.notes ?? [])])],
  }
}
