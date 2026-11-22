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

export const explainExample: Input = {
  filename: 'compose.yaml',
  text: `services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
      interval: 5s
      timeout: 3s
      retries: 10
    volumes:
      - db-data:/var/lib/postgresql/data

  cache:
    image: redis:7-alpine

  web:
    image: nginx:alpine
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started
    ports:
      - "127.0.0.1:8080:80"

volumes:
  db-data: {}
`,
}
