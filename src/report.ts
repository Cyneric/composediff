import { structuredPatch } from 'diff'
import { compare, parseCompose, type Change } from './compare.ts'
import { explainCompose, type Startup } from './explain.ts'
import { MAX_INPUT } from './limits.ts'
import { YamlError, type Location } from './yaml.ts'

export type View = 'changes' | 'source'
export type Request = { id: number; view: View | 'explain'; before: string; after: string }
export type Diagnostic = { message: string; location?: Location }
export type Semantic = { view: 'changes'; errors: [Diagnostic?, Diagnostic?]; changes: Change[]; notes: string[] }
export type Source = { view: 'source'; hunks: ReturnType<typeof structuredPatch>['hunks']; error?: string }
export type Explanation = { view: 'explain'; startup?: Startup; error?: Diagnostic }
export type Result = Semantic | Source | Explanation

function diagnostic(error: unknown): Diagnostic {
  const message = error instanceof RangeError ? 'This YAML has too many levels of nesting.' :
    error instanceof Error ? error.message : 'Could not read this YAML.'
  return error instanceof YamlError ? { message, location: { line: error.line, column: error.column } } : { message }
}

function parse(text: string) {
  if (!text.trim()) return {}
  try {
    return { document: parseCompose(text) }
  } catch (error) {
    return { error: diagnostic(error) }
  }
}

export function buildReport({ view, before, after }: Request): Result {
  if (view === 'explain') {
    try {
      return { view, startup: explainCompose(before) }
    } catch (error) {
      return { view, error: diagnostic(error) }
    }
  }
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
