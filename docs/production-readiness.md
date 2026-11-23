# Production Readiness Notes

## Legacy Marque authorization surface

The initial schema introduced company-centric tables and helpers that predate the hybrid workspace model:

- `public.companies`, `public.company_memberships`, and `company_id` columns on projects, tasks, conversations, approvals, and audit tables.
- `public.record_audit_event`, `public.sanitize_audit_event_details`, and related sanitizer helpers.
- Company-scoped RLS policies later dropped by `20261118000300_single_company_authorization.sql` and `20261119000000_personal_conversation_ownership.sql`.

These objects are dormant compatibility history, not the active authorization path. Active authorization goes through workspace membership RPCs and the durable approval/automation/integration RPCs. Do not expose the legacy tables or grant legacy audit RPCs to new roles. A future cleanup migration should be additive and reviewed separately; historical migrations must not be edited or deleted.

## Workspace deletion and restrictive foreign keys

Several active child tables reference workspaces with `on delete restrict`:

- `public.projects`, `public.tasks`, and `public.approvals` from `20261122000000_hybrid_workspace_foundation.sql`.
- `public.approval_requests` and `public.approval_audit_events` from `20261123000300_durable_approval_authorization.sql`.

Personal and business workspaces also reference `auth.users` with restrictive foreign keys in the durable approval migration. A direct `delete from public.workspaces` therefore fails while child rows exist. This is intentional: approval and audit history must not be silently destroyed.

There is currently no workspace-deletion RPC. Until one is designed, workspace removal is a manual, service-role operation with a documented retention decision:

1. Inventory child rows for the workspace.
2. Decide whether approval/audit history is retained, anonymized, or archived.
3. Remove dependent non-audit rows in a transaction.
4. Delete the workspace only after all restrictive references are resolved.
5. Record the operator action in an append-only audit store.

Do not relax the restrictive foreign keys merely to make deletion succeed.

## Historical destructive migrations

`20261119000200_personal_conversation_ownership.sql` deletes rows from approvals, tasks, and projects and drops `company_id` columns. `20261118000300_single_company_authorization.sql` and later migrations drop legacy RLS policies. These migrations are historical facts and must remain unchanged.

Procedure for applying migrations to an existing database:

1. Take a restorable backup before touching the database.
2. Apply migrations in filename order on a staging clone first.
3. Confirm the `supabase_migrations.schema_migrations` history matches the repository before applying anything new.
4. Run the migration-test suite and the opt-in PostgreSQL authorization suite against staging.
5. Apply one migration at a time to production and verify after each step.
6. Never edit, re-number, delete, or re-run historical migrations. Add a new forward migration instead.

## OAuth and integration security

`docs/integrations.md` is the source of truth for integration behavior. Short version:

- Workspace connections belong to the individual member who connected them, not to the workspace as shared property.
- Credentials use AES-256-GCM with authenticated additional data and support one previous key during rotation.
- Provider callbacks use a canonical origin allowlist and require HTTPS in production.
- Disconnect attempts Google token revocation before local deletion and audits the outcome.

## Rate limiting

Process-local counters are no longer the production path. `src/lib/rateLimit.ts` supports an injectable store, and the default store calls `public.consume_rate_limit` through the publishable Supabase key. If the store is unavailable, protected endpoints fail closed with HTTP 503.

Current server-side policies cover chat, authentication callbacks, integration connect/callback/disconnect/list, approval decisions, automation endpoints, and the scheduled run-due endpoint. Client-side login/register forms and edge middleware still require hosting-layer/WAF protection because no durable request reaches application code before those boundaries.

## Database verification

Default tests use fakes and must not be treated as proof of RLS behavior. `tests/supabaseRls.test.ts` is the real PostgreSQL authorization suite. It is skipped unless all of these are set:

- `SUPABASE_TEST_URL`
- `SUPABASE_TEST_ANON_KEY`
- `SUPABASE_TEST_SERVICE_ROLE_KEY`

Run it only against a disposable test database with the migrations applied. It creates temporary users and a workspace, verifies owner isolation and the shared rate-limit RPC, then deletes its own fixtures.
