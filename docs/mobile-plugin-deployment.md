# Hosted OAuth and private ChatGPT plugin runbook

This runbook deploys one private CV Builder workspace per person and connects it directly to
ChatGPT web, Desktop, iOS, Android, or any standards-compatible remote MCP client. The client talks
to the hosted `/mcp` endpoint over HTTPS; no Mac, local environment variable, or Remote mode is in
the runtime path. OpenAI's current [plugin product documentation](https://learn.chatgpt.com/docs/plugins)
states that plugins available to an account can be used in Chat or Work on mobile.

The implementation follows OpenAI's current [plugin authentication](https://developers.openai.com/plugins/build/auth),
[packaging](https://developers.openai.com/plugins/build/plugins), and
[connection testing](https://developers.openai.com/plugins/deploy/connect-chatgpt) guidance. Auth0
is the recommended identity provider because its maintained
[Auth for MCP](https://auth0.com/ai/docs/mcp/intro/overview) product supports discovery, third-party
MCP clients, PKCE, resource-bound tokens, and scoped API authorization.

## Security and isolation model

Use two Coolify resources created from the same repository:

| Owner | Public URL / OAuth audience | Allowed OAuth subject | PostgreSQL volume |
| --- | --- | --- | --- |
| Maxim | `https://cv-builder.maximkich.com/mcp` | Maxim's exact Auth0 `user_id` / JWT `sub` | Maxim resource only |
| Valeria | `https://cv-builder.shevchenko-tymchuk.com/mcp` | Valeria's exact Auth0 `user_id` / JWT `sub` | Valeria resource only |

Do not attach the resources to the same PostgreSQL service or volume. Give each resource a unique
random `POSTGRES_PASSWORD` and `CV_BUILDER_API_TOKEN`. The static token remains available to the web
login and legacy/local agents, but ChatGPT and Hermes use OAuth. The database URL and password are
server-only Coolify variables and no MCP tool can read them.

Every OAuth request is checked for a valid RS256 signature, exact issuer, exact audience, expiry,
not-before time, allowed subject, local revocation state, and tool scope. Audience plus subject
checks mean a Maxim token is rejected by Valeria's deployment even if both use one Auth0 tenant.

## 1. Back up before deployment

1. Confirm Coolify shows both PostgreSQL services healthy and that automated backups have a recent
   successful restore point.
2. Take an on-demand PostgreSQL custom-format dump for each resource. Run this from the relevant
   Coolify host/project and keep the output outside the repository:

   ```sh
   docker compose -f compose.coolify.yaml exec -T postgres \
     pg_dump -U cv_builder -d cv_builder -Fc > cv-builder-before-oauth.dump
   ```

3. Record the deployed image/commit and current Coolify variable names, but never copy secret
   values into an issue, chat, or repository.
4. Verify the dump with `pg_restore --list cv-builder-before-oauth.dump` and periodically test a
   restore into a disposable PostgreSQL database.

This release does not alter the `cvs` table or rename the Compose volume. Deployment must reuse the
existing resource and volume rather than creating replacement PostgreSQL storage.

## 2. Configure Auth0

One Auth0 tenant can serve both owners, although separate tenants are an optional stronger
administrative boundary.

1. In Auth0 tenant advanced settings, enable **Resource Parameter Compatibility Profile** and
   **Include Issuer in Authorization Responses**. These make Auth0 accept MCP's `resource`
   parameter and return the authorization-response `iss` required for mix-up protection.
2. Make the chosen database/social login connection a domain-level connection so approved
   third-party MCP clients can use it.
3. Create two Auth0 APIs (resource servers), using the exact HTTPS audiences in the table above.
   Use RS256 and the `rfc9068_profile` token dialect. Set both access-token lifetime fields to 300
   seconds. On Auth0 Free, leave RBAC disabled: the requested scopes remain in the token and CV
   Builder enforces them on every request. Paid tenants may instead use RBAC with
   `rfc9068_profile_authz`, provided the owner is assigned all required API permissions.
4. Add these permissions to both APIs:

   | Scope | Allows |
   | --- | --- |
   | `cvs:read` | List CVs and read complete CV content |
   | `cvs:write` | Create and update CVs |
   | `cvs:export` | Export Markdown or PDF |
   | `cvs:delete` | Permanently delete a CV |

5. Import ChatGPT from `https://chatgpt.com/oauth/client.json`, keep it third-party, and give it a
   user-delegated per-app client grant containing exactly the four scopes above for each API. Do
   not grant ChatGPT client-credentials or machine access. This explicit client grant is required
   even when RBAC is disabled.
6. Create each owner as a separate Auth0 user and look up the immutable `user_id` (for example,
   `auth0|abc...`). This exact value is
   the deployment's `CV_BUILDER_OAUTH_ALLOWED_SUBJECTS`; do not use an email address.
7. Enable refresh-token rotation and reuse detection for third-party clients. Do not create or put
   an OAuth client secret in this repository or in ChatGPT.
8. In Auth0 Auth for MCP, allow Client ID Metadata Documents (preferred) or DCR. Approve/register:

   - ChatGPT: `https://chatgpt.com/oauth/client.json`
   - Hermes: `https://nousresearch.github.io/hermes-agent/docs/oauth/client-metadata.json`

   With issuer identification enabled, allow ChatGPT's stable redirect URI
   `https://chatgpt.com/connector_platform_oauth_redirect`. If the ChatGPT plugin management page
   displays a different callback-specific URI, allow that exact URI instead.

Before deployment, confirm Auth0 discovery publishes the exact issuer, authorization/token
endpoints, S256 PKCE, supported client-registration method, and token-endpoint authentication
method:

```sh
curl -fsS https://YOUR_AUTH0_DOMAIN/.well-known/oauth-authorization-server | jq '{
  issuer,
  authorization_endpoint,
  token_endpoint,
  jwks_uri,
  code_challenge_methods_supported,
  client_id_metadata_document_supported,
  registration_endpoint,
  token_endpoint_auth_methods_supported,
  authorization_response_iss_parameter_supported
}'
```

Do not continue if issuer strings differ by a trailing slash, S256 is absent, or neither CIMD nor
DCR is available.

## 3. Configure the two Coolify resources

Use `compose.coolify.yaml` and set the following separately for each resource. Values shown here are
examples, not shared values.

```env
CV_BUILDER_PUBLIC_URL=https://cv-builder.maximkich.com
CV_BUILDER_API_TOKEN=<64 hex characters generated for this deployment>
POSTGRES_PASSWORD=<a different random password for this deployment>

CV_BUILDER_OAUTH_ISSUER=https://YOUR_AUTH0_DOMAIN/
CV_BUILDER_OAUTH_AUDIENCE=https://cv-builder.maximkich.com/mcp
CV_BUILDER_OAUTH_JWKS_URL=https://YOUR_AUTH0_DOMAIN/.well-known/jwks.json
CV_BUILDER_OAUTH_ALLOWED_SUBJECTS=auth0|MAXIM_USER_ID
CV_BUILDER_OAUTH_ALGORITHMS=RS256
CV_BUILDER_OAUTH_MAX_TOKEN_LIFETIME_SECONDS=300
```

For Valeria, replace both URLs, the allowed subject, API token, and PostgreSQL password. Keep these
empty unless operating an incident or the provider explicitly supports RFC 7662 introspection:

```env
CV_BUILDER_OAUTH_REVOKED_TOKEN_IDS=
CV_BUILDER_OAUTH_REVOKED_BEFORE=
CV_BUILDER_OAUTH_INTROSPECTION_URL=
CV_BUILDER_OAUTH_INTROSPECTION_CLIENT_ID=
CV_BUILDER_OAUTH_INTROSPECTION_CLIENT_SECRET=
```

Deploy the app service without deleting or recreating the PostgreSQL volume. Confirm:

```sh
curl -fsS https://OWNER_DOMAIN/api/v1/health | jq
curl -fsS https://OWNER_DOMAIN/.well-known/oauth-protected-resource/mcp | jq
curl -fsS https://OWNER_DOMAIN/mcp -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' -D - -o /dev/null
```

Health must report PostgreSQL and OAuth plus static bearer auth. Protected-resource metadata must
contain that owner's `/mcp` audience, the Auth0 issuer, and four scopes. The unauthenticated MCP
request must return `401` and a `WWW-Authenticate` header containing `resource_metadata`.

## 4. Install in ChatGPT

Perform this once in each owner's ChatGPT account on the web. Availability depends on the account
or workspace policy; an admin may need to allow developer/private plugins.

1. Open ChatGPT **Settings → Security and login** and enable **Developer mode**.
2. Open **ChatGPT Plugins**, select **+**, and create a connection.
3. Use a private user-facing name such as `Maxim's CV Builder` and enter only that owner's MCP URL:
   `https://cv-builder.maximkich.com/mcp` or
   `https://cv-builder.shevchenko-tymchuk.com/mcp`.
4. Review the discovered six tools and four OAuth scopes. Start sign-in, authenticate as the
   matching Auth0 user, and consent. Never paste the static API token or database password.
5. Copy the `plugin_asdk_app...` technical ID from the connection page URL. In a private checkout,
   configure the source package:

   ```sh
   node plugins/cv-builder-private/scripts/configure-app.mjs \
     --app-id plugin_asdk_app_REPLACE_WITH_OWNER_ID \
     --base-url https://OWNER_DOMAIN \
     --owner OWNER_NAME
   ```

6. Install the configured private package from the owner's local source if that workspace uses a
   plugin marketplace. For the account-synced mobile path, the registered hosted MCP connection is
   the important object; it is not dependent on the checkout after registration.
7. Start a new chat on web and run prompts 1–6 from
   `plugins/cv-builder-private/test-prompts.md`.
8. Open the same account on Desktop, iOS, and Android, enable the same private plugin/connection in
   a new chat, and rerun the set. A mobile request must still work when every Mac is shut down.

Do not register Maxim's URL in Valeria's account or vice versa. If an owner has both connections,
remove the wrong one rather than relying on display names.

## 5. Connect Hermes

Hermes connects directly to the hosted MCP endpoint and uses its own OAuth browser flow:

```sh
hermes mcp add --url https://OWNER_DOMAIN/mcp --auth oauth cv-builder
hermes mcp test cv-builder
```

Hermes stores and refreshes its OAuth tokens separately from configuration. No static token is
needed. For a read-only Hermes connection, restrict its included tools to `list_cvs` and `get_cv`.
On a headless host, follow Hermes's documented loopback-port forwarding flow for the one-time
browser authorization.

## 6. Verification matrix

Automated CI/local tests cover discovery, signature/issuer/audience/expiry/subject/revocation
checks, REST scopes, MCP initialization, per-tool scope metadata, insufficient-scope challenges,
and all six tools including PDF export. Human acceptance uses the package's prompt set:

| Surface | Owner | Read | Write approval | PDF | Delete approval | Mac off | Result/date |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ChatGPT web | Maxim | ☐ | ☐ | ☐ | ☐ | n/a | |
| ChatGPT Desktop | Maxim | ☐ | ☐ | ☐ | ☐ | n/a | |
| ChatGPT iOS | Maxim | ☐ | ☐ | ☐ | ☐ | ☐ | |
| ChatGPT Android | Maxim | ☐ | ☐ | ☐ | ☐ | ☐ | |
| ChatGPT web | Valeria | ☐ | ☐ | ☐ | ☐ | n/a | |
| ChatGPT iOS/Android | Valeria | ☐ | ☐ | ☐ | ☐ | ☐ | |
| Hermes | each owner | ☐ | ☐ | ☐ | ☐ | n/a | |

Also test negative isolation: a Maxim token against Valeria's `/api/v1/cvs` and vice versa must
return `401 invalid_token`. Never use production CVs for destructive acceptance; create a named
temporary CV and delete only that record.

## 7. Logout, revocation, rotation, and recovery

- **Normal logout:** disconnect the CV Builder plugin in ChatGPT/Hermes and revoke its refresh grant
  in Auth0. The next call must sign in again.
- **Immediate access-token revocation:** Auth0 JWT access tokens remain valid until their short
  expiry unless checked online. For one compromised token, append its JWT `jti` to
  `CV_BUILDER_OAUTH_REVOKED_TOKEN_IDS`. To invalidate every token issued up to now, set
  `CV_BUILDER_OAUTH_REVOKED_BEFORE` to the current Unix timestamp and redeploy. Keep the cutoff
  until all older tokens have expired.
- **Online revocation:** if the selected provider/plan exposes RFC 7662, set all three
  `CV_BUILDER_OAUTH_INTROSPECTION_*` variables. CV Builder then requires `active: true` on every
  OAuth request. Never pass the introspection secret to ChatGPT.
- **Allowed-user recovery:** correct `CV_BUILDER_OAUTH_ALLOWED_SUBJECTS` to the owner's immutable
  Auth0 user ID and redeploy. Do not add the other owner's subject as a workaround.
- **Static token rotation:** generate a new `CV_BUILDER_API_TOKEN`, update authorized local agents,
  redeploy, and delete old environment copies. Existing browser sessions become invalid.
- **Signing-key rotation:** rotate through Auth0. The server obtains current public keys from JWKS;
  keep Auth0's overlap period long enough for in-flight short-lived tokens.
- **Database password rotation:** take a backup, rotate the PostgreSQL role password and matching
  `DATABASE_URL`/Compose variable in one maintenance window, then verify health. Never expose the
  value in logs or prompts.
- **Lost ChatGPT connection:** remove it, clear its Auth0 refresh grant, create a new connection,
  and rerun `configure-app.mjs` with the new technical ID.

## 8. Troubleshooting

- No sign-in UI: verify the RFC 9728 endpoint, `WWW-Authenticate` response, and each tool's
  `_meta.securitySchemes` entry. Refresh the plugin metadata in ChatGPT after deployment.
- `invalid_client`: approve ChatGPT/Hermes CIMD or enable DCR, and allow the exact redirect URI
  shown by the client.
- `invalid_token`: compare issuer including trailing slash, `/mcp` audience, clock, JWT algorithm,
  allowed subject, revocation cutoff, and Auth0 JWKS URL.
- `insufficient_scope`: assign the permission to the correct Auth0 role/API, reconnect so a new
  access token is minted, and retry.
- Desktop works but mobile does not: confirm mobile uses the same ChatGPT account and the registered
  hosted connection, not a local `.mcp.json` server or Secure MCP Tunnel.
- Existing CVs appear missing: stop. Check that Coolify reused the original PostgreSQL volume and
  resource. Do not initialize a replacement database and do not create duplicate tracker/deployment
  resources to mask the issue.

## 9. Rollback without data loss

1. Stop write testing and take another PostgreSQL dump.
2. Roll the app image back to the recorded pre-OAuth commit. Do not remove the PostgreSQL service,
   named volume, or existing `DATABASE_URL`.
3. Keep the existing `CV_BUILDER_API_TOKEN`; old desktop/local MCP access then continues exactly as
   before. OAuth variables may remain unused or be removed after rollback.
4. Verify `/api/v1/health`, list CVs through the browser/static token, and compare record counts and
   a sample revision with the pre-deployment check.
5. Only restore the dump if data was actually lost/corrupted. Restore first into a disposable
   database and compare it before replacing production.
6. Revoke the Auth0 refresh grants and remove/disable the private ChatGPT connections until a fixed
   release is deployed.
