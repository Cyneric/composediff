import { buildReport, type Request } from './report'

self.onmessage = ({ data }: MessageEvent<Request>) => {
  try {
    self.postMessage({ id: data.id, result: buildReport(data) })
  } catch {
    self.postMessage({ id: data.id, error: 'Could not compare these files. Try smaller inputs.' })
  }
}
