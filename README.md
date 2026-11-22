# ComposeDiff

Paste two Docker Compose files to compare service additions and removals, published ports, volume mounts and image references. The comparison updates as you edit. Both files stay in the browser tab.

The built-in example changes a PostgreSQL port mapping:

```diff
- "127.0.0.1:5432:5432"
+ "5432:5432"
```

The new file drops the explicit loopback address. With Docker's default port binding, other hosts may now reach PostgreSQL.

## Run locally

Use Node.js 22.18 or newer.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Run `npm test` to check the comparison logic or `npm run build` to generate the static site in `dist/`.

## Comparison scope

ComposeDiff compares service definitions by name, port bindings by container port and protocol, and mounts by container path. Reordering entries does not count as a change. Fields such as environment variables, network definitions and build settings are outside the comparison.

For projects that use variables, overrides, `include` or `extends`, run `docker compose config` locally for each version and paste the resolved configurations. ComposeDiff does not read `.env` files or connect to a Docker daemon.
