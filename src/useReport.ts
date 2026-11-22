import { useEffect, useRef, useState } from 'react'
import type { Result, View } from './report'

type Response = { result?: Result; error?: string }
type Job = { before: string; after: string; response: Response }

export function useReport(view: View, before: string, after: string) {
  const worker = useRef<Worker | null>(null)
  const lastId = useRef(0)
  const [jobs, setJobs] = useState<Partial<Record<View, Job>>>({})
  const matching = (job?: Job) => job?.before === before && job.after === after ? job.response : undefined
  const latest = matching(jobs[view])
  useEffect(() => () => {
    worker.current?.terminate()
    worker.current = null
  }, [])
  useEffect(() => {
    if (latest || (!before.trim() && !after.trim()) || (view === 'source' && (!before.trim() || !after.trim()))) return
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
          complete({ error: 'Could not start the comparison. Reload the page to try again.' })
        }
        deadline = window.setTimeout(() => {
          discardWorker()
          complete({ error: 'The comparison took too long. Try smaller files.' })
        }, 4_000)
        worker.current.postMessage({ id, view, before, after })
      } catch {
        discardWorker()
        complete({ error: 'Could not start the comparison. Reload the page to try again.' })
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
  }, [view, before, after, latest])
  return { active: latest, semantic: matching(jobs.changes)?.result }
}
