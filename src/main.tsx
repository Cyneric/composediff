import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { compare, parseCompose } from './compare'
import * as demo from './demo'
import './style.css'

function parseInput(source: string) {
  if (!source.trim()) return { error: 'Paste a Compose file to compare.' }
  try { return { services: parseCompose(source) } }
  catch (error) { return { error: error instanceof Error ? error.message : 'Could not read this file.' } }
}

function Editor({ name, text, edit, error }: {
  name: string; text: string; edit: (s: string) => void; error?: string
}) {
  return <div className="editor">
    <label htmlFor={name}>{name}<span>compose.yaml</span></label>
    <textarea id={name} value={text} onChange={e => edit(e.target.value)}
      aria-invalid={!!error} aria-describedby={error ? `${name}-error` : undefined}
      placeholder="Paste your compose.yaml here" spellCheck={false} autoCapitalize="off" autoComplete="off" wrap="off" />
    {error && <p className="error" id={`${name}-error`}>{error}</p>}
  </div>
}

function App() {
  const [before, setBefore] = useState(demo.before)
  const [after, setAfter] = useState(demo.after)
  const old = useMemo(() => parseInput(before), [before])
  const next = useMemo(() => parseInput(after), [after])
  const changes = old.services && next.services ? compare(old.services, next.services) : null
  return <main>
    <header><div className="brand"><img src="./mark.svg" alt="" />ComposeDiff</div>
      <a href="https://github.com/Cyneric/composediff">GitHub</a></header>
    <h1>Compare Compose files</h1>
    <p className="intro">Paste two versions to see which services, ports, mounts and images change.</p>
    <section className="editors" aria-label="Compose files">
      <Editor name="Before" text={before} edit={setBefore} error={old.error}/>
      <Editor name="After" text={after} edit={setAfter} error={next.error}/>
    </section>
    <div className="toolbar"><span>Both files stay in this tab.</span>
      <button disabled={before === demo.before && after === demo.after} onClick={() => {
        setBefore(demo.before); setAfter(demo.after)
      }}>Restore example</button></div>
    <section className="report" aria-labelledby="results">
      <h2 id="results" aria-live="polite">{changes === null ? 'Comparison unavailable' : changes.length === 0
        ? 'No changes in the compared fields' : `${changes.length} ${changes.length === 1 ? 'change' : 'changes'}`}</h2>
      {changes === null && <p>Check the message below each input.</p>}
      {changes?.map(change => <article key={`${change.service}:${change.title}`}>
        <div className="service">{change.service}</div>
        <div><h3>{change.title}</h3>
        {change.attention && <p>With Docker’s default settings, other hosts may now reach this port.</p>}
        <div className="diff">
          {change.before && <pre><span aria-label="Before">−</span>{change.before}</pre>}
          {change.after && <pre><span aria-label="After">+</span>{change.after}</pre>}
        </div></div>
      </article>)}
    </section>
  </main>
}

createRoot(document.getElementById('root')!).render(<App />)
