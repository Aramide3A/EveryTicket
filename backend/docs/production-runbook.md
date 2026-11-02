# Production runbook

## Architecture

The VPS runs only the NestJS API and BullMQ worker through the supplied systemd units. PostgreSQL, Redis, SMTP, Paystack, and Cloudflare R2 are managed external services. Do not install Docker or run PostgreSQL/Redis on the VPS. Keep API and worker environment files in `/etc/everythingticket/` with owner `root:everythingticket` and mode `0640`.

`GET /health/live` proves that the API process can answer. `GET /health/ready` proves PostgreSQL and encrypted Redis are reachable; configure the load balancer to remove an instance when readiness is not 200.

## Deploy and rollback

1. Build and run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` in CI.
2. Take and verify a managed PostgreSQL backup before any migration.
3. Release the built application to a versioned directory under `/opt/everythingticket/releases/` and atomically update the `/opt/everythingticket/backend` symlink.
4. Apply reviewed Prisma migrations once using the release environment. Never use `migrate reset` in staging or production.
5. Run `systemctl daemon-reload`, then `systemctl restart everythingticket-api everythingticket-worker`.
6. Check `/health/ready`, a signed-in API call, worker queue processing, and journal errors before marking the release live.

Rollback means switching the symlink to the previous compatible release and restarting both units. A migration that is not backward compatible needs an explicitly rehearsed forward-only remediation; do not restore a database merely to roll application code back.

## Backup and restore

The PostgreSQL provider must have encrypted automated backups, point-in-time recovery where available, a named restore owner, and documented retention. Before each release, take an on-demand backup. At least quarterly, restore a production-like backup into an isolated database, run Prisma migration status, verify paid-order/ticket/refund/payout counts, and record the elapsed recovery time. R2 objects are not a substitute for PostgreSQL backups; retain their bucket lifecycle/versioning policy separately.

## Monitoring and alerts

Monitor API latency/error rate, `/health/ready`, VPS CPU/RAM/disk, database availability/connections, Redis availability, BullMQ failed-job count and queue lag, Paystack webhook verification/mismatch events, pending or `PAID_NEEDS_RESOLUTION` orders, failed notification jobs, ticket-document failures, and invalid scan volume. Worker failures are emitted as JSON to journald without credentials, raw QR values, session cookies, or card data. Alert on sustained readiness failure, repeated webhook mismatch, queue lag above five minutes, or any unexpected growth in failed jobs.

## Security controls

Terminate HTTPS at Cloudflare, permit inbound traffic only through the configured proxy/firewall, keep system packages patched, and restrict PostgreSQL/Redis network access to the VPS. Use `rediss://` for Redis. Configure `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, and working SMTP credentials before starting the API: production customer and organizer access requires email verification, and historical guest orders are not claimed until verification succeeds. R2 event media is public only through `R2_PUBLIC_MEDIA_URL`; ticket PDFs are private and delivered only by five-minute S3 presigned URLs after account ownership checks. Rotate secrets by updating both environment files and restarting API and worker.
