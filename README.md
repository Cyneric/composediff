# ComposeDiff

Compare two Docker Compose files in your browser. Review changes by service, check warnings before you deploy, and copy a Markdown report into a pull request. ComposeDiff never uploads or saves your files.

The built-in example updates PostgreSQL and changes its port mapping from `127.0.0.1:5432:5432` to `5432:5432`. With Docker's default binding, other hosts may now be able to connect. ComposeDiff flags that change next to the image update.

![ComposeDiff showing two YAML editors and a warning that PostgreSQL is no longer limited to loopback](docs/composediff.png)

## Run locally

Clone the repository and run these commands with Node.js 22.18 or newer:

```sh
npm ci
npm run dev
```

Open the URL printed in your terminal. The example is already loaded. Paste, drop, or open your original file in **Before** and the proposed file in **After**. Each editor accepts UTF-8 text up to 500,000 characters.

## Read the comparison

- **Changes** groups settings by service or project resource. It ignores comments and mapping key order and matches ports by container port and protocol, and mounts by container path. It treats some short and long forms as equivalent. Most other lists keep their original order.
- **Warnings** flag a published port that loses an explicit loopback binding at the same host port, as well as newly enabled privileged mode and host networking. A comparison without warnings does not establish that a configuration is safe.
- **Source diff** shows line edits, including comments and formatting. It works even when the YAML cannot be parsed.
- **Copy Markdown** and **Download** export all compared changes, even when you filter the view. Changes and Markdown show counts for edits to service environment variables and hide top-level config and secret definition values. Other fields may contain sensitive values. Review the report before sharing it.

ComposeDiff compares the files you give it. It does not resolve variables, merge override files, or validate against the full Compose schema. For either version, run [`docker compose config`](https://docs.docker.com/reference/cli/docker/compose/config/) in its project directory with the same options and environment you use at deploy time. Compare the two outputs. They may contain resolved secrets.

## Build and test

```sh
npm test
npm run build
```

Serve `dist/` over HTTP for local use or HTTPS for hosting. The build works at a site root or subpath. Use `npm run preview` to check it locally. Copy Markdown needs a secure context such as HTTPS or localhost.

The browser smoke test serves the built site on a local port. Run it with Python 3.12:

```sh
python -m pip install -r tests/requirements.txt
python -m playwright install chromium
python tests/browser.py
```
