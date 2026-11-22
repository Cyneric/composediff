import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from './Editor'
import { ChangeList, SourceDiff } from './Results'
import { Icon } from './icons'
import { empty, example, type Input, type Pair } from './demo'
import type { View } from './report'
import { useReport } from './useReport'
import './style.css'

const repository = 'https://github.com/Cyneric/composediff'

function App() {
  const [files, setFiles] = useState<Pair>(example)
  const [view, setView] = useState<View>('changes')
  const [replace, setReplace] = useState<'example' | 'empty'>('empty')
  const [revision, setRevision] = useState(0)
  const help = useRef<HTMLDialogElement>(null)
  const confirm = useRef<HTMLDialogElement>(null)
  const [before, after] = files
  const { active, semantic } = useReport(view, before.text, after.text)
  const report = active?.result
  const errors = semantic?.view === 'changes' ? semantic.errors : []
  const blank = files.map(file => !file.text.trim())
  const ready = !blank.some(Boolean)
  const sample = files.every((file, index) => file === example[index])
  const matched = report?.view === 'changes' && !errors.some(Boolean) && ready

  function update(index: 0 | 1, input: Input) {
    setFiles(current => index === 0 ? [input, current[1]] : [current[0], input])
  }

  function replaceFiles(kind: 'example' | 'empty') {
    setFiles(kind === 'example' ? example : empty)
    setView('changes')
    setRevision(current => current + 1)
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

  return <>
    <a className="skip" href="#comparison">Skip to comparison</a>
    <header className="masthead">
      <div className="shell masthead-inner">
        <div className="brand"><img src={`${import.meta.env.BASE_URL}mark.svg`} alt="" width="32" height="32" /> ComposeDiff</div>
        <nav aria-label="Project">
          <button className="button subtle" onClick={() => help.current?.showModal()}>How it works</button>
          <a className="button" href={repository} target="_blank" rel="noreferrer"><Icon name="github" /> GitHub</a>
        </nav>
      </div>
    </header>
    <main className="shell">
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
            setRevision(current => current + 1)
          }} disabled={blank.every(Boolean)}><Icon name="swap" /> Swap</button>
        </div>
      </div>
      <div className="workspace">
        <Editor key={`before-${revision}`} side="Before" input={before} onChange={input => update(0, input)} error={errors[0]} />
        <Editor key={`after-${revision}`} side="After" input={after} onChange={input => update(1, input)} error={errors[1]} />
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
        {matched && <ChangeList report={report} />}
        {ready && report?.view === 'source' && <SourceDiff report={report} />}
      </section>
    </main>
    <dialog ref={help} aria-labelledby="help-title">
      <h2 id="help-title">How ComposeDiff compares files</h2>
      <p>Open or paste the original file on the left and the proposed version on the right. Changes update as you edit.</p>
      <p><strong>Changes</strong> compares settings and skips comments, key order and common equivalent syntax. Warnings flag a few changes worth checking, such as a port losing its loopback binding.</p>
      <p><strong>Source diff</strong> shows the original text, including passwords and tokens. Changes and Markdown hide environment variable names and values, plus top-level config and secret definitions. Other fields can still contain sensitive values.</p>
      <p>For overrides, variables, <code>include</code> or <code>extends</code>, run <code>docker compose config</code> locally for each version. Paste the resolved files to compare the effective configuration.</p>
      <form method="dialog"><button className="button primary">Close</button></form>
    </dialog>
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
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
