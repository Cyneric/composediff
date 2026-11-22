import { useLayoutEffect, useRef, useState } from 'react'
import { Compartment, EditorState, Prec, Transaction } from '@codemirror/state'
import { EditorView, highlightActiveLine, keymap, lineNumbers, placeholder } from '@codemirror/view'
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { yaml } from '@codemirror/lang-yaml'
import { tags } from '@lezer/highlight'
import { MAX_INPUT } from './limits'
import type { Input } from './demo'
import { Icon } from './icons'

const highlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--yaml-key)' },
  { tag: tags.string, color: 'var(--yaml-string)' },
  { tag: [tags.bool, tags.number, tags.null], color: 'var(--yellow)' },
  { tag: tags.comment, color: 'var(--quiet)', fontStyle: 'italic' },
  { tag: [tags.punctuation, tags.separator], color: 'var(--muted)' },
  { tag: [tags.atom, tags.keyword], color: 'var(--accent)' },
]))
const sizeError = 'Use at most 500,000 characters per file.'

function attrs(side: string, error?: string) {
  return EditorView.contentAttributes.of({
    'aria-labelledby': `${side}-title`,
    'aria-describedby': `${side}-hint${error ? ` ${side}-error` : ''}`,
    ...(error ? { 'aria-invalid': 'true' } : {}),
    spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off',
  })
}

export function Editor({ side, input, onChange, error }: {
  side: 'Before' | 'After'; input: Input; onChange: (input: Input) => void; error?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const view = useRef<EditorView>(null)
  const state = useRef({ input, onChange })
  const attributes = useRef(new Compartment())
  const [fileError, setFileError] = useState('')
  const [dragging, setDragging] = useState(false)
  const message = fileError || error

  useLayoutEffect(() => {
    state.current = { input, onChange }
  }, [input, onChange])

  useLayoutEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      doc: state.current.input.text,
      extensions: [
        EditorView.theme({}, { dark: true }),
        lineNumbers(), highlightActiveLine(), history(), yaml(), highlighting,
        placeholder('Paste YAML or open a file'),
        attributes.current.of(attrs(side)),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorState.tabSize.of(2),
        EditorState.changeFilter.of(transaction => {
          if (transaction.newDoc.length <= MAX_INPUT) return true
          setFileError(sizeError)
          return false
        }),
        Prec.high(EditorView.domEventHandlers({
          drop(event) {
            if (!event.dataTransfer?.files.length) return false
            const files = event.dataTransfer.files
            event.preventDefault()
            setDragging(false)
            void openFiles(files)
            return true
          },
        })),
        EditorView.updateListener.of(update => {
          if (!update.docChanged || update.transactions.every(tr => tr.annotation(Transaction.userEvent) === 'replaceInput')) return
          setFileError('')
          state.current.onChange({ ...state.current.input, text: update.state.doc.toString() })
        }),
      ],
    })
    view.current = editor
    return () => { editor.destroy(); view.current = null }
  }, [side])

  useLayoutEffect(() => {
    const editor = view.current
    if (!editor || editor.state.doc.toString() === input.text) return
    setFileError('')
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: input.text },
      selection: { anchor: 0 },
      scrollIntoView: true,
      annotations: [Transaction.userEvent.of('replaceInput'), Transaction.addToHistory.of(false)],
    })
  }, [input])

  useLayoutEffect(() => {
    view.current?.dispatch({ effects: attributes.current.reconfigure(attrs(side, message)) })
  }, [side, message])

  async function openFiles(files: FileList) {
    if (files.length !== 1) { setFileError('Open one file per editor.'); return }
    const file = files[0]
    if (file.size > MAX_INPUT * 4) { setFileError(sizeError); return }
    const previous = state.current.input
    let text: string
    try {
      const bytes = await file.arrayBuffer()
      if (state.current.input !== previous) return
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n')
    } catch {
      setFileError('Could not read this file as UTF-8 text.')
      return
    }
    if (text.length > MAX_INPUT) { setFileError(sizeError); return }
    if (text.includes('\0')) { setFileError('Open a UTF-8 text file.'); return }
    setFileError('')
    state.current.onChange({ text, filename: file.name })
  }

  return <section className={`editor${dragging ? ' dragging' : ''}`}
    aria-labelledby={`${side}-title`}
    onDragOver={event => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setDragging(true)
    }}
    onDragLeave={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
    }}
    onDrop={event => {
      if (!event.dataTransfer.files.length) return
      event.preventDefault()
      setDragging(false)
      void openFiles(event.dataTransfer.files)
    }}>
    <div className="editor-heading">
      <div className="file-label">
        <h2 id={`${side}-title`}>{side}</h2>
        <span className="filename" title={input.filename}>{input.filename}</span>
      </div>
      <button className="button subtle" type="button" aria-label={`Open ${side.toLowerCase()} file`}
        onClick={() => fileInput.current?.click()}><Icon name="file" /> Open file</button>
      <input ref={fileInput} type="file" accept=".yml,.yaml,.json,.txt,text/plain" hidden
        onChange={event => {
          if (event.currentTarget.files?.length) void openFiles(event.currentTarget.files)
          event.currentTarget.value = ''
        }} />
    </div>
    <div ref={host} />
    <div className="editor-foot" id={`${side}-hint`}>
      <span>{dragging ? 'Drop to open file' : 'Paste, edit or drop a file'}</span>
      <span>YAML</span>
    </div>
    {message && <p className="error" id={`${side}-error`} role="status">{message}</p>}
  </section>
}
