import { useState } from 'react'
import type { Change } from './compare'
import type { Semantic, Source } from './report'
import { Icon } from './icons'
import { markdown } from './markdown'

const pageSize = 30

function Values({ change }: { change: Change }) {
  if (change.before === undefined && change.after === undefined) return null
  return <div className="values">
    {change.before !== undefined && <div className="value old">
      <span className="sr-only">Before: </span><span aria-hidden="true">−</span><pre>{change.before}</pre>
    </div>}
    {change.after !== undefined && <div className={`value ${change.key === 'environment' ? 'neutral' : 'new'}`}>
      <span className="sr-only">After: </span><span aria-hidden="true">{change.key === 'environment' ? ' ' : '+'}</span><pre>{change.after}</pre>
    </div>}
  </div>
}

function groupByName(changes: Change[]) {
  const groups = new Map<string, Change[]>()
  for (const change of changes) {
    const id = `${change.scope}:${change.name}`
    const group = groups.get(id)
    if (group) group.push(change)
    else groups.set(id, [change])
  }
  return [...groups.entries()]
}

export function ChangeList({ report }: { report?: Semantic }) {
  const [warningsOnly, setWarningsOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(pageSize)
  if (!report) return null

  const warnings = report.changes.filter(change => change.warning)
  const filterWarnings = warningsOnly && warnings.length > 0
  const query = search.trim().toLowerCase()
  const available = (filterWarnings ? warnings : report.changes)
    .filter(change => `${change.scope} ${change.name} ${change.title}`.toLowerCase().includes(query))
  const groups = groupByName(available.slice(0, limit))
  return <>
    {report.notes.map(note => <p className="note" key={note}>{note}</p>)}
    {report.changes.length === 0 ? <div className="empty-state">
      <Icon name="check" />
      <div><strong>No changes in the compared settings</strong><p>Use Source diff to check comments, formatting and other text edits.</p></div>
    </div> : <>
      <div className="filter-row">
        <div className="filters" role="group" aria-label="Filter changes">
          <button className="button filter" aria-pressed={!filterWarnings} onClick={() => {
            setWarningsOnly(false)
            setLimit(pageSize)
          }}>All changes <span>{report.changes.length}</span></button>
          {warnings.length > 0 && <button className="button filter" aria-pressed={filterWarnings} onClick={() => {
            setWarningsOnly(true)
            setLimit(pageSize)
          }}><Icon name="warning" /> Warnings <span>{warnings.length}</span></button>}
        </div>
        <div className="report-actions">
          {(report.changes.length > 5 || search) && <input type="search" value={search} aria-label="Search changes" placeholder="Find a service or setting"
            onChange={event => { setSearch(event.target.value); setLimit(pageSize) }} />}
          <ExportButtons report={report} />
        </div>
      </div>
      {groups.map(([id, changes]) => <section className="change-group" key={id}>
        <h3><span>{changes[0].scope}</span> <code>{changes[0].name}</code></h3>
        {changes.map(change => <article className="change" key={change.key}>
          <h4>{change.title}</h4>
          {change.warning && <p className="warning"><Icon name="warning" /> <span>{change.warning}</span></p>}
          <Values change={change} />
        </article>)}
      </section>)}
      {available.length === 0 && <p className="empty-state">No matching changes.</p>}
      {available.length > limit && <button className="button more" onClick={() => setLimit(limit + pageSize)}>
        Show {Math.min(available.length - limit, pageSize)} more
      </button>}
    </>}
  </>
}

function ExportButtons({ report }: { report: Semantic }) {
  const [status, setStatus] = useState('')
  const text = () => markdown(report.changes, report.notes)
  const download = () => {
    const url = URL.createObjectURL(new Blob([text()], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'composediff.md'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
    setStatus('Report downloaded. Check for secrets before sharing.')
  }
  return <div className="export" role="group" aria-label="Export all changes">
    <button className="button" type="button" onClick={async () => {
      try {
        await navigator.clipboard.writeText(text())
        setStatus('Markdown copied. Check for secrets before sharing.')
      } catch {
        setStatus('Could not copy. Use Download.')
      }
    }}><Icon name="copy" /> Copy Markdown</button>
    <button className="button" type="button" onClick={download}><Icon name="download" /> Download</button>
    <span className="export-status" role="status">{status}</span>
  </div>
}

function rowsOf(hunk: Source['hunks'][number]) {
  let before = hunk.oldStart
  let after = hunk.newStart
  return hunk.lines.map(line => {
    const sign = line[0]
    return {
      sign, text: line.slice(1),
      before: sign === '+' || sign === '\\' ? '' : before++,
      after: sign === '-' || sign === '\\' ? '' : after++,
    }
  })
}

export function SourceDiff({ report }: { report: Source }) {
  const [limit, setLimit] = useState(400)
  if (report.error) return <p className="empty-state">{report.error}</p>
  if (report.hunks.length === 0) return <p className="empty-state">Both files have the same text.</p>
  const count = report.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0)
  let remaining = limit
  return <>
    <p className="note">Source diff shows original text, including secrets.</p>
    <div className="source-diff" role="region" aria-label="Source diff lines" tabIndex={0}>
      {report.hunks.map((hunk, index) => {
        if (remaining <= 0) return null
        const rows = rowsOf({ ...hunk, lines: hunk.lines.slice(0, remaining) })
        remaining -= rows.length
        return <div key={index}>
          <div className="hunk-heading">@@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</div>
          {rows.map((row, i) => <div key={i} className={`source-row ${row.sign === '+' ? 'new' : row.sign === '-' ? 'old' : ''}`}>
            <span className="line-number" aria-hidden="true">{row.before}</span><span className="line-number" aria-hidden="true">{row.after}</span>
            <span aria-hidden="true">{row.sign}</span>
            {row.sign === '+' && <span className="sr-only">Added: </span>}
            {row.sign === '-' && <span className="sr-only">Removed: </span>}
            <code>{row.text}</code>
          </div>)}
        </div>
      })}
    </div>
    {count > limit && <button className="button more" onClick={() => setLimit(limit + 400)}>
      Show {Math.min(count - limit, 400)} more lines
    </button>}
  </>
}
