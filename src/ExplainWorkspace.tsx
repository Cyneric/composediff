import { useRef, useState } from 'react'
import { Editor, type EditorHandle } from './Editor'
import { explainExample } from './demo'
import { Icon } from './icons'
import { useReport } from './useReport'
import type { Detail, ServiceStep, Startup } from './explain'
import type { Location } from './yaml'

type Jump = (location: Location) => void

function LineLink({ location, jump }: { location?: Location; jump: Jump }) {
  if (!location) return null
  return <button className="line-link" type="button" aria-label={`Go to YAML line ${location.line}`}
    onClick={() => jump(location)}>Line {location.line}</button>
}

function Facts({ facts, jump }: { facts: Detail[]; jump: Jump }) {
  return <ul className="timeline-facts">{facts.map((fact, index) => <li key={`${fact.label}-${index}`}>
    <div><strong>{fact.label}</strong><p>{fact.text}</p></div>
    <LineLink location={fact.location} jump={jump} />
  </li>)}</ul>
}

function Services({ steps, jump }: { steps: ServiceStep[]; jump: Jump }) {
  return <ul className="timeline-services">{steps.map(step =>
    <li className="timeline-card" key={step.name}>
      <div className="timeline-card-heading">
        <h4><code>{step.name}</code></h4>
        <LineLink location={step.location} jump={jump} />
      </div>
      <p>{step.summary}</p>
      {step.dependencies.length > 0 && <Facts facts={step.dependencies} jump={jump} />}
      {step.details.length > 0 && <details>
        <summary>Service settings <span>{step.details.length}</span></summary>
        <Facts facts={step.details} jump={jump} />
      </details>}
    </li>
  )}</ul>
}

function Timeline({ startup, jump }: { startup: Startup; jump: Jump }) {
  const { resources, levels, unordered, notes } = startup
  const hasServices = levels.length > 0 || unordered.length > 0
  return <>
    {notes.length > 0 && <aside className="timeline-notes" aria-labelledby="timeline-notes-title">
      <h3 id="timeline-notes-title"><Icon name="warning" /> Settings to resolve</h3>
      <ul>{notes.map(({ text, location }, index) => <li key={index}>
        <span>{text}</span><LineLink location={location} jump={jump} />
      </li>)}</ul>
    </aside>}
    {!hasServices && <p className="empty-state">No services are defined in this file.</p>}
    {(hasServices || resources.length > 0) && <ol className="timeline" role="list">
      {resources.length > 0 && <li className="timeline-stage resources">
        <h3>Project resources</h3>
        <div className="timeline-card"><Facts facts={resources} jump={jump} /></div>
      </li>}
      {levels.map((steps, index) => <li className="timeline-stage" key={index}>
        <h3>{index === 0 ? 'Services with no prerequisites' : `Dependency level ${index + 1}`}</h3>
        {steps.length > 1 && <p className="timeline-hint">No fixed order between these services.</p>}
        <Services steps={steps} jump={jump} />
      </li>)}
      {unordered.length > 0 && <li className="timeline-stage unresolved">
        <h3>Startup order unknown</h3>
        <p className="timeline-hint">These services have a missing dependency or depend on a cycle.</p>
        <Services steps={unordered} jump={jump} />
      </li>}
    </ol>}
  </>
}

export function Explain({ active }: { active: boolean }) {
  const [input, setInput] = useState(explainExample)
  const [revision, setRevision] = useState(0)
  const [replacement, setReplacement] = useState(explainExample)
  const confirm = useRef<HTMLDialogElement>(null)
  const editor = useRef<EditorHandle>(null)
  const result = useReport('explain', input.text, '', active).active
  const explanation = result?.result?.view === 'explain' ? result.result : undefined
  const blank = !input.text.trim()
  const sample = input === explainExample
  const status = blank ? 'Open or paste a Compose file to see how it starts.' :
    result?.error ?? (explanation?.error ? 'See the error under the editor.' :
      explanation ? '' : 'Reading the Compose file…')

  function update(file: typeof input, opened = true) {
    setInput(file)
    if (opened) setRevision(current => current + 1)
  }

  function replace(file: typeof input) {
    if (blank || sample) update(file)
    else {
      setReplacement(file)
      confirm.current?.showModal()
    }
  }

  return <div hidden={!active}>
    <div className="intro">
      <div>
        <h1>Explain a Compose file</h1>
        <p>See what Compose sets up and which services have to wait.</p>
      </div>
      <div className="actions" role="group" aria-label="Manage Compose file">
        <button className="button subtle" onClick={() => replace({ ...explainExample, text: '' })} disabled={blank}>Clear</button>
        <button className="button" onClick={() => replace(explainExample)} disabled={sample}>Load example</button>
      </div>
    </div>
    <div className="explain-workspace">
      <div className="explain-editor">
        <Editor key={revision} ref={editor} side="Compose file" input={input} error={explanation?.error}
          onChange={(file, opened) => update(file, Boolean(opened))} />
        <p className="privacy"><Icon name="lock" /> Files stay in this tab. No uploads or autosave.</p>
      </div>
      <section className="explain-result" id="startup" aria-labelledby="startup-title" tabIndex={-1}>
        <div className="report-heading"><h2 id="startup-title">Startup timeline</h2></div>
        <p className="timeline-intro">Groups show dependencies declared in the file. A service can start when its own prerequisites are met. ComposeDiff never runs containers.</p>
        {status && <p className="empty-state" role="status">{status}</p>}
        {explanation?.startup && <Timeline startup={explanation.startup} jump={location => editor.current?.goTo(location)} />}
      </section>
    </div>
    <dialog ref={confirm} aria-labelledby="explain-confirm-title">
      <h2 id="explain-confirm-title">{replacement.text ? 'Load the example?' : 'Clear the editor?'}</h2>
      <p>This replaces the current text in the editor.</p>
      <form method="dialog">
        <button className="button" autoFocus>Cancel</button>
        <button className="button primary" onClick={() => update(replacement)}>
          {replacement.text ? 'Load example' : 'Clear editor'}
        </button>
      </form>
    </dialog>
  </div>
}
