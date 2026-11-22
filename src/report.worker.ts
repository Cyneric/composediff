import { buildReport, type Request } from './report'

self.onmessage = ({ data }: MessageEvent<Request>) => {
  try {
    self.postMessage({ id: data.id, result: buildReport(data) })
  } catch {
    self.postMessage({ id: data.id, error: 'Could not read the files. Try a smaller file.' })
  }
}
