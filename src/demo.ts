export type Input = { text: string; filename: string }
export type Pair = [Input, Input]

export const example: Pair = [
  { filename: 'compose.before.yaml', text: `services:
  postgres:
    image: postgres:16.4-alpine
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata: {}
` },
  { filename: 'compose.after.yaml', text: `services:
  postgres:
    image: postgres:16.6-alpine
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata: {}
` },
]

export const empty: Pair = [
  { text: '', filename: 'compose.before.yaml' },
  { text: '', filename: 'compose.after.yaml' },
]
