import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from './Editor'
import { Explain } from './ExplainWorkspace'
import { ChangeList, SourceDiff } from './Results'
import { Icon } from './icons'
import { empty, example, type Input, type Pair } from './demo'
import type { View } from './report'
import { useReport } from './useReport'
import './style.css'

const repository = 'https://github.com/Cyneric/composediff'

function App() {
  const [mode, setMode] = useState<'compare' | 'explain'>('compare')
  const [visitedExplain, setVisitedExplain] = useState(false)
  const help = useRef<HTMLDialogElement>(null)
  const explaining = mode === 'explain'
  return <>
    <a className="skip" href={explaining ? '#startup' : '#comparison'}>Skip to {explaining ? 'timeline' : 'comparison'}</a>
    <header className="masthead">
      <div className="shell masthead-inner">
        <div className="brand-group">
          <div className="brand"><img src={`${import.meta.env.BASE_URL}mark.svg`} alt="" width="32" height="32" /> ComposeDiff</div>
          <div className="views" role="group" aria-label="Workspace mode">
            <button className="button" aria-pressed={!explaining} onClick={() => setMode('compare')}>Compare</button>
            <button className="button" aria-pressed={explaining} onClick={() => {
              setMode('explain')
              setVisitedExplain(true)
            }}>Explain</button>
          </div>
        </div>
        <nav aria-label="Project">
          <button className="button subtle" onClick={() => help.current?.showModal()}>How it works</button>
          <a className="button" href={repository} target="_blank" rel="noreferrer"><Icon name="github" /> GitHub</a>
        </nav>
      </div>
    </header>
    <main className="shell">
      <Compare active={!explaining} />
      {visitedExplain && <Explain active={explaining} />}
    </main>
    <dialog ref={help} aria-labelledby="help-title">
      <h2 id="help-title">How ComposeDiff works</h2>
      <p><strong>Compare.</strong> Open or paste the original file on the left and the proposed version on the right. Changes skip comments and key order and flag changes such as a port losing its loopback binding.</p>
      <p><strong>Source diff</strong> shows the file text, including passwords and tokens. Changes and Markdown show counts for edits to service environment variables and hide top-level config and secret definition values. Check the whole report before sharing.</p>
      <p><strong>Explain.</strong> Open one file to see startup dependencies and service settings. Select a line number to jump to that setting in the editor.</p>
      <p>For overrides, variables, <code>include</code> or <code>extends</code>, run <code>docker compose config</code> locally. Paste the resolved file to inspect the effective configuration.</p>
      <form method="dialog"><button className="button primary">Close</button></form>
    </dialog>
  </>
}

function Compare({ active: visible }: { active: boolean }) {
  const [files, setFiles] = useState<Pair>(example)
  const [view, setView] = useState<View>('changes')
  const [replace, setReplace] = useState<'example' | 'empty'>('empty')
  const [revisions, setRevisions] = useState([0, 0])
  const confirm = useRef<HTMLDialogElement>(null)
  const [before, after] = files
  const { active, semantic } = useReport(view, before.text, after.text, visible)
  const report = active?.result
  const errors = semantic?.view === 'changes' ? semantic.errors : []
  const blank = files.map(file => !file.text.trim())
  const ready = !blank.some(Boolean)
  const sample = files.every((file, index) => file === example[index])
  const matched = report?.view === 'changes' && !errors.some(Boolean) && ready

  function update(index: 0 | 1, input: Input, opened?: boolean) {
    setFiles(current => index === 0 ? [input, current[1]] : [current[0], input])
    if (opened) setRevisions(current => current.map((value, side) => value + Number(side === index)))
  }

  function replaceFiles(kind: 'example' | 'empty') {
    setFiles(kind === 'example' ? example : empty)
    setView('changes')
    setRevisions(current => current.map(value => value + 1))
  }

  function requestReplace(kind: 'example' | 'empty') {
    if (sample || blank.every(Boolean)) {
      replaceFiles(kind)
    } else {
      setReplace(kind)
      confirm.current?.showModal()
    }
  }

  const status = !ready ? 'Open or paste YAML in both editors to compare.' :
    active?.error ?? (!report ? 'Comparing files…' : report.view === 'changes' && errors.some(Boolean) ?
      'Fix the YAML errors or switch to Source diff.' : '')

  return <div hidden={!visible}>
      <div className="intro">
        <div>
          <h1>Compare Compose files</h1>
          <p>See what changes in your Docker Compose configuration before you deploy.</p>
        </div>
        <div className="actions" role="group" aria-label="Manage files">
          <button className="button subtle" onClick={() => requestReplace('empty')} disabled={blank.every(Boolean)}>Clear</button>
          <button className="button" onClick={() => requestReplace('example')} disabled={sample}>Load example</button>
          <button className="button" onClick={() => {
            setFiles([after, before])
            setRevisions(current => current.map(value => value + 1))
          }} disabled={blank.every(Boolean)}><Icon name="swap" /> Swap</button>
        </div>
      </div>
      <div className="workspace">
        <Editor key={`before-${revisions[0]}`} side="Before" input={before} onChange={(input, opened) => update(0, input, opened)} error={errors[0]} />
        <Editor key={`after-${revisions[1]}`} side="After" input={after} onChange={(input, opened) => update(1, input, opened)} error={errors[1]} />
      </div>
      <p className="privacy"><Icon name="lock" /> Files stay in this tab. No uploads or autosave.</p>
      <section id="comparison" aria-labelledby="comparison-title" tabIndex={-1}>
        <div className="report-heading">
          <h2 id="comparison-title">Comparison</h2>
          <div className="views" role="group" aria-label="Comparison view">
            <button className="button" aria-pressed={view === 'changes'} onClick={() => setView('changes')}>Changes</button>
            <button className="button" aria-pressed={view === 'source'} onClick={() => setView('source')}>Source diff</button>
          </div>
        </div>
        {status && <p className="empty-state" role="status">{status}</p>}
        <ChangeList key={revisions.join(':')} report={matched ? report : undefined} />
        {ready && report?.view === 'source' && <SourceDiff report={report} />}
      </section>
    <dialog ref={confirm} aria-labelledby="confirm-title">
      <h2 id="confirm-title">{replace === 'example' ? 'Load the example?' : 'Clear both editors?'}</h2>
      <p>This replaces the current text in both editors.</p>
      <form method="dialog">
        <button className="button" autoFocus>Cancel</button>
        <button className="button primary" onClick={() => replaceFiles(replace)}>
          {replace === 'example' ? 'Load example' : 'Clear both'}
        </button>
      </form>
    </dialog>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
