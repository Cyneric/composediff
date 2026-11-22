import type { Change } from './compare'

export function markdown(changes: Change[], notes: string[]) {
  const inline = (text: string) => text.replace(/\r?\n/g, ' ').replace(/[\\`*_{}\[\]()<>#+!|~]/g, '\\$&')
  const block = (label: string, value: string | undefined) => {
    if (value === undefined) return []
    let length = 2
    for (const run of value.matchAll(/`+/g)) length = Math.max(length, run[0].length)
    const fence = '`'.repeat(length + 1)
    return [`${label}:`, '', `${fence}text`, value, fence, '']
  }
  return [
    '## ComposeDiff', '',
    `${changes.length} ${changes.length === 1 ? 'change' : 'changes'}.`, '',
    ...notes.flatMap(note => [`> ${inline(note)}`, '']),
    ...changes.flatMap(change => [
      `### ${change.scope} ${inline(change.name)}: ${inline(change.title)}`,
      '', ...(change.warning ? [`> ${inline(change.warning)}`, ''] : []),
      ...block('Before', change.before), ...block('After', change.after),
    ]),
  ].join('\n')
}
