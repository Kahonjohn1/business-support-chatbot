# External Integrations

This project supports a reusable foundation for third-party business integrations. Phase 1 includes Gmail and Google Calendar with read-only Google OAuth scopes.

## What is supported

- Google OAuth 2.0 with PKCE and server-side state.
- AES-256-GCM encrypted access and refresh tokens at rest.
- Personal workspaces and verified business workspaces only.
- Role-aware access: viewers can read connected data; operators and admins can connect, disconnect, and prepare drafts.
- Read-only Gmail and Calendar tools plus approval-gated preparation tools.
- No sending, creating, modifying, or deleting provider data.

## What is not supported

- Legacy Marque shared-company workspaces.
- Workspace invitations or automatic connection sharing beyond the active verified business workspace.
- Email send, calendar event creation, or webhook subscriptions.
- Any permission scope beyond Gmail read-only and Calendar read-only.
- Service accounts or admin-consent workspace-wide grants.

## Required setup

Apply the local migration after review:

```bash
supabase/migrations/20261123000000_integration_connections.sql
```

Set these variables in `.env.local`:

```bash
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/integrations/callback
INTEGRATION_TOKEN_ENCRYPTION_KEY=
INTEGRATION_TOKEN_ENCRYPTION_KEY_PREVIOUS=
INTEGRATION_APP_ORIGINS=http://localhost:3000
```

Generate the encryption key with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Configure a Google OAuth client:

- Use the exact `GOOGLE_OAUTH_REDIRECT_URI` value as an authorized redirect URI.
- Enable the Gmail API and Google Calendar API.
- Configure the OAuth consent screen with `gmail.readonly` and `calendar.readonly`.
- Use separate OAuth clients per deployment environment.

Providers remain disabled in the UI until all required environment variables are present.

## Connection model

- A personal connection is owned by the signed-in user and is only visible to that user.
- A business workspace connection is also owned by the individual member who completed OAuth. The workspace ID supplies membership context but does not make the connection shared property.
- A member can read, refresh, and disconnect only the connection they own. Other members' connections are invisible to reads, refreshes, tool execution, and deletes.
- Connect and disconnect require an operator or admin role. Viewer roles can use read-only integration tools with their own connection.
- Credentials are encrypted as `v2` envelopes with AES-256-GCM and authenticated additional data bound to purpose, provider, owner, and workspace. A credential from one connection cannot be replayed against another.
- During key rotation, set `INTEGRATION_TOKEN_ENCRYPTION_KEY_PREVIOUS` to the old key and `INTEGRATION_TOKEN_ENCRYPTION_KEY` to the new key. Existing credentials are decrypted with either key and re-encrypted under the current key when read or refreshed. Remove the previous key after all connections have been touched.

## OAuth flow

- `POST /api/integrations/{provider}/connect` checks permissions and configuration, creates PKCE and encrypted state, stores it in a per-flow cookie, and returns the Google authorization URL.
- State is bound to provider, user, scope, workspace, and a ten-minute expiry. Concurrent flows do not overwrite each other because each state has its own cookie.
- Redirects are built from a canonical origin allowlist (`INTEGRATION_APP_ORIGINS`, with the configured callback origin included). Production requires HTTPS; the incoming Host header is never trusted on its own.
- `GET /api/integrations/callback` verifies state, exchanges the code server-side, checks granted scopes, encrypts tokens, and stores the connection.
- `POST /api/integrations/{provider}/disconnect` attempts provider-side token revocation, records the outcome in the audit log, and removes the stored connection locally even if revocation fails.

Access tokens are refreshed server-side. If refresh or decryption fails, the connection is marked `reconnect_required` rather than exposing an error to the model.

## AI tools

Read-only tools:

- `search_integration_email`
- `read_integration_email`
- `list_integration_calendar_events`
- `check_integration_calendar_availability`

Approval-gated preparation tools:

- `prepare_integration_email_draft`
- `prepare_integration_calendar_event`

Preparation tools never send email or create events. They produce a local payload only after the user explicitly approves the request. The model cannot approve its own request because approvals are bound to the signed-in user, workspace, provider connection, and original arguments.

## Data exposure

- Encrypted tokens are never returned to the browser or the model.
- Audit details are sanitized and redact keys containing token, secret, auth, password, key, bearer, or cookie.
- Direct client access to integration tables is denied; all database access goes through redacted, scope-checked RPCs.
- The audit table is append-only.

## Verification

Run the normal checks after changes:

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```
