const paths = {
  github: 'M9 19c-4.5 1.4-4.5-2.5-6.5-3m13 6v-3.9a3.4 3.4 0 0 0-.9-2.6c3-.3 6.2-1.5 6.2-6.7a5.2 5.2 0 0 0-1.4-3.6 4.8 4.8 0 0 0-.1-3.6S18.2 1.2 15.5 3a13.5 13.5 0 0 0-7 0C5.8 1.2 4.7 1.6 4.7 1.6a4.8 4.8 0 0 0-.1 3.6 5.2 5.2 0 0 0-1.4 3.6c0 5.1 3.2 6.4 6.2 6.7a3.4 3.4 0 0 0-.9 2.6V22',
  swap: 'M3 8h17m-4-4 4 4-4 4m5 4H4m4 4-4-4 4-4',
  file: 'M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10Zm0 0v7h7',
  lock: 'M7 11V7a5 5 0 0 1 10 0v4m-12 0h14v10H5z',
  warning: 'M12 8v5m0 3v.1M10.3 3.9 2.5 18a1.7 1.7 0 0 0 1.5 2.5h16a1.7 1.7 0 0 0 1.5-2.5L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z',
  copy: 'M8 8h12v12H8zM16 5V4H4v12h1',
  download: 'M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4',
  check: 'm4 12 5 5L20 6',
} as const

export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d={paths[name]} />
  </svg>
}
