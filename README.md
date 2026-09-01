## Slop-Disclaimer

It's a vibe coded experiment that helped me personally building my CVs as I want instead of paying 30$ for some lame subscription. You can self host it locally or on VPS and connect your agent to it, both REST or MCP supported.

Use it as you wish. There is no contribution expected. And of course this readme was not meant to be read by humans, let your agent read and explain it for you.

# CV Builder

A self-hosted CV editor, PDF renderer, REST API, and Model Context Protocol (MCP) server. CVs are
stored by the server, so the browser UI and multiple AI agents work on the same documents.

## What is exposed

- Web editor: `/`
- REST API: `/api/v1`
- OpenAPI description: `/api/v1/openapi.json`
- Streamable HTTP MCP: `/mcp`
- Health check: `/api/v1/health`
- MCP tools: `list_cvs`, `get_cv`, `create_cv`, `update_cv`, `delete_cv`, and `export_cv`

PDFs are rendered on the server. `export_cv` returns an MCP PDF resource, while
`GET /api/v1/cvs/{id}/pdf` returns a normal downloadable file.

PDF page count is content-driven rather than fixed by the template. A short CV can render as one
A4 page, while longer content automatically flows to three or more pages. The bundled example's
two-page check is only a visual-layout regression for that specific fixture.

## Run locally

Requirements: Node.js 22 or newer and npm.

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Development uses a durable SQLite database at
`data/cv-builder.sqlite` and starts with an empty workspace. Set a token before exposing the
process to any network:

```sh
CV_BUILDER_API_TOKEN="$(openssl rand -hex 32)" npm run dev
```

The macOS `start.command` and generated Dock launcher still work. The server owns the data now;
browser `localStorage` is not used as a database.

To load the fictional example into a new database, set
`CV_BUILDER_SEED_FILE=examples/sample-cv.md` on the first start.

## Run with Docker

Create local secrets once:

```sh
cp .env.example .env
openssl rand -hex 32
```

Paste the generated value into `CV_BUILDER_API_TOKEN` in `.env`, then start the SQLite version:

```sh
docker compose up -d --build
```

The application is available at `http://localhost:5173`. SQLite is stored in the named
`cv_builder_data` volume and uses WAL mode. Back up that volume or the database file.

For PostgreSQL, also set a different `POSTGRES_PASSWORD` and run:

```sh
docker compose -f compose.yaml -f compose.postgres.yaml up -d --build
```

PostgreSQL is recommended when the service will have multiple replicas, external backups, or
several active users. The schema is initialized automatically.

## Deploy with Coolify

Use `compose.coolify.yaml` as a self-contained CV Builder and PostgreSQL stack. It intentionally
has no Caddy service and no host port mappings: Coolify supplies the private network, reverse
proxy, domain routing, and HTTPS.

1. Create a Coolify resource from this GitHub repository.
2. Select the Docker Compose build pack, use `/` as the base directory, and set the Compose
   location to `/compose.coolify.yaml`.
3. Add these runtime variables in Coolify:

   ```env
   CV_BUILDER_API_TOKEN=<output of: openssl rand -hex 32>
   POSTGRES_PASSWORD=<different output of: openssl rand -hex 32>
   CV_BUILDER_PUBLIC_URL=https://cv.example.com
   ```

4. Assign `https://cv.example.com:8080` to the `cv-builder` service. The `:8080` suffix tells
   Coolify which internal container port to proxy; the public URL still uses normal HTTPS.
5. Deploy, then open `/api/v1/health` and confirm that storage is `postgres` and authentication is
   required.

The Compose stack limits the app to 512 MB RAM and PostgreSQL to 1 GB. Those are safety ceilings,
not expected steady usage. The Node and PostgreSQL images support both AMD64 and ARM64 hosts.

The current authentication model is one private workspace per deployment. For two people with
strictly isolated CVs, deploy this same repository twice with different domains, access tokens,
and stack volumes. Do not reuse either secret. Configure database backups outside the VPS before
treating a deployment as the only copy of a CV.

## Put it on a VPS with HTTPS

Point a DNS A/AAAA record at the VPS, set `CV_BUILDER_DOMAIN` in `.env`, and start the PostgreSQL
and Caddy overlays:

```sh
docker compose \
  -f compose.yaml \
  -f compose.postgres.yaml \
  -f compose.remote.yaml \
  up -d --build
```

Caddy obtains and renews TLS certificates. Only ports 80 and 443 need to be public; the direct app
port is bound to `127.0.0.1`. The agent endpoint is then `https://YOUR_DOMAIN/mcp`.

Keep `.env` off the server's public filesystem, restrict SSH access, and arrange automated
PostgreSQL backups before treating the service as the only copy of a CV.

## Connect agents

Every agent belonging to one workspace uses that deployment's MCP URL and bearer token. REST-only
agents can use the API instead. Agents for another person should use that person's separate
deployment and token.

### Codex and the ChatGPT desktop app

Export the token in the environment that launches Codex/ChatGPT:

```sh
export CV_BUILDER_TOKEN="the-value-from-CV_BUILDER_API_TOKEN"
```

Add this to `~/.codex/config.toml` (or project-local `.codex/config.toml`):

```toml
[mcp_servers.cv_builder]
url = "https://YOUR_DOMAIN/mcp"
bearer_token_env_var = "CV_BUILDER_TOKEN"
```

The ChatGPT desktop app, Codex CLI, and Codex IDE extension on the same host share this MCP
configuration. Restart the client after adding it.

### Hermes, Claude, and other MCP clients

Add a Streamable HTTP MCP server with:

- URL: `https://YOUR_DOMAIN/mcp`
- Header: `Authorization: Bearer YOUR_TOKEN`

If a client does not support bearer-authenticated remote MCP, use the REST API or an MCP proxy
that can add the header. ChatGPT web/Work plugins require OAuth discovery for private user data;
the built-in static token is intended for personal desktop agents and server-side agents, not a
public multi-user plugin marketplace.

## Agent workflow

A reliable CV-preparation run looks like this:

1. Call `list_cvs` and choose a source CV.
2. Call `get_cv` and keep its `revision`.
3. Tailor the structured `resume` fields or generated Markdown for the requested role.
4. Call `create_cv` for a new named variant, or `update_cv` with `expectedRevision`.
5. Call `export_cv` with `format: "pdf"` and return the PDF resource to the user.

Revision checks prevent one agent from silently overwriting another agent's edit.

## REST API example

```sh
export CV_URL="https://YOUR_DOMAIN"
export CV_TOKEN="the-value-from-CV_BUILDER_API_TOKEN"

curl -fsS "$CV_URL/api/v1/cvs" \
  -H "Authorization: Bearer $CV_TOKEN"

curl -fsS "$CV_URL/api/v1/cvs" \
  -H "Authorization: Bearer $CV_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Product Designer — Acme","markdown":"# Candidate Name\n\n## Product Designer\n\n..."}'

curl -fsS "$CV_URL/api/v1/cvs/CV_ID/pdf" \
  -H "Authorization: Bearer $CV_TOKEN" \
  -o tailored-cv.pdf
```

The complete machine-readable operation list is at `/api/v1/openapi.json`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `CV_BUILDER_API_TOKEN` | unset | Protects the UI session, REST API, and MCP endpoint. Required for remote use; minimum 6 characters. A long random token remains strongly recommended. |
| `DATABASE_URL` | `sqlite:./data/cv-builder.sqlite` | SQLite path or PostgreSQL connection URL. |
| `CV_BUILDER_PUBLIC_URL` | local server URL | Canonical HTTPS origin used in MCP download links. |
| `CV_BUILDER_SEED_FILE` | unset | Optional initial Markdown document used only when the database is empty. |
| `HOST` | `127.0.0.1` locally, `0.0.0.0` in production | Listen address. |
| `PORT` / `CV_BUILDER_PORT` | `5173` | Listen port. |
| `CV_BUILDER_ALLOW_QUIT` | enabled in development | Allows the local macOS launcher to stop the process. |

## Source Markdown format

The optional Markdown input keeps the existing hierarchy:

- `#` candidate name
- the first `##` professional title
- contact lines with `mailto:` and `tel:` links
- `## Profile`, `## Employment History`, `## Education`, `## Skills`, and `## Languages`
- `###` for each employment or education entry
- a bold date line followed by `|` and its location for employment entries
- language values in `Language: value/maximum` form

Structured fields remain the source of truth after parsing.

The repository includes `examples/sample-cv.md`, which uses fictional identity and employment
data. Personal source files, local databases, generated PDFs, `.env`, and local Codex hooks are
excluded from Git and the Docker build context.

## Build and verify

```sh
npm test
npm run build
npm run verify:pdf
```

Tests cover parsing, storage, authenticated sessions, CRUD and revision conflicts, server PDF
downloads, a real Streamable HTTP MCP client handshake, PDF geometry, text, links, and content-
driven pagination in both directions.

## License

CV Builder is available under the MIT License. The bundled Arimo document fonts and JetBrains Mono
interface fonts remain under the SIL Open Font License 1.1; their respective copyright and license
texts are included in `public/fonts/ARIMO-OFL.txt` and `public/fonts/JETBRAINS-MONO-OFL.txt`.
