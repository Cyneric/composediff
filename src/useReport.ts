import { useEffect, useRef, useState } from 'react'
import type { Request, Result } from './report'

type Response = { result?: Result; error?: string }
type Job = { before: string; after: string; response: Response }

export function useReport(view: Request['view'], before: string, after = '', enabled = true) {
  const worker = useRef<Worker | null>(null)
  const lastId = useRef(0)
  const [jobs, setJobs] = useState<Partial<Record<Request['view'], Job>>>({})
  const matching = (job?: Job) => job?.before === before && job.after === after ? job.response : undefined
  const latest = matching(jobs[view])
  useEffect(() => () => {
    worker.current?.terminate()
    worker.current = null
  }, [])
  useEffect(() => {
    if (!enabled || latest || (!before.trim() && !after.trim()) || (view === 'source' && (!before.trim() || !after.trim()))) return
    const id = ++lastId.current
    let deadline: number | undefined
    const complete = (response: Response) => setJobs(jobs => ({ ...jobs, [view]: { before, after, response } }))
    const discardWorker = () => {
      worker.current?.terminate()
      worker.current = null
    }
    const timer = window.setTimeout(() => {
      try {
        worker.current ??= new Worker(new URL('./report.worker.ts', import.meta.url), { type: 'module' })
        worker.current.onmessage = ({ data }: MessageEvent<Response & { id: number }>) => {
          if (data.id !== id) return
          window.clearTimeout(deadline)
          deadline = undefined
          complete(data)
        }
        worker.current.onerror = () => {
          window.clearTimeout(deadline)
          discardWorker()
          complete({ error: 'Could not read the files. Reload the page to try again.' })
        }
        deadline = window.setTimeout(() => {
          discardWorker()
          complete({ error: 'Reading the files took too long. Try a smaller file.' })
        }, 4_000)
        worker.current.postMessage({ id, view, before, after })
      } catch {
        discardWorker()
        complete({ error: 'Could not read the files. Reload the page to try again.' })
      }
    }, 140)
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(deadline)
      if (deadline !== undefined) discardWorker()
      if (worker.current) {
        worker.current.onmessage = null
        worker.current.onerror = null
      }
    }
  }, [view, before, after, latest, enabled])
  return { active: latest, semantic: matching(jobs.changes)?.result }
}
