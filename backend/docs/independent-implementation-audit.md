# Independent implementation audit

**Audited:** 28 October 2026  
**Guide:** `EverythingTicket_Backend_Development_Specification (1).md`  
**Scope:** NestJS API controllers, service workflows, Prisma schema/migrations, worker, deployment files, and automated tests.

## Changes made during this audit

1. Checkout now rejects an event at or after its `startAt`, even if a ticket type has no `salesEndAt`. This prevents sales of already-started events. The regression test is in `test/checkout-quote.spec.ts`.
2. `POST /orders/:orderReference/payments` now requires an active customer session and checks that the order belongs to that customer before it creates a Paystack payment attempt. This prevents a caller who knows an order reference from creating a payment authorization URL for another customer.
3. The versioned `/api/v1` API, account profile/order/ticket/download routes, quote/status/reconciliation routes, checkout payment hand-off, public catalogue filters/availability, request limits, multi-role profiles, and OpenAPI grouping/body contracts are implemented.
4. `PATCH /organizer/guest-lists/:guestListId/guests` is now supported alongside the existing guest-ID route. The collection-style contract takes `guestId` in the body and rejects a guest that is not in the specified, organizer-owned list.
5. `POST /organizer/events/:eventId/media/complete` is now supported alongside the existing media-ID-in-path route. Its body supplies `mediaId`, preserving organizer and event ownership validation.

## Workflow review

| Workflow | Source assessment | Test evidence | Audit result |
|---|---|---|---|
| Identity and account status | Better Auth uses the Prisma adapter; active profile/status checks are applied by protected controllers; account blocking deletes sessions. | HTTP unauthenticated contracts and administration integration tests passed against an isolated PostgreSQL database. | Local implementation verification passed; staging verification remains pending. |
| Event management and public catalogue | Owner-scoped draft/publish/ticket-type lifecycle, catalogue filtering, and availability calculations are present. | Event lifecycle and HTTP contract suites passed against an isolated PostgreSQL database. | Local implementation verification passed; staging verification remains pending. |
| Checkout and inventory | Server-side prices, fee snapshotting, row locks, PostgreSQL holds, free-order issuance, and late-payment resolution are present. | Quote, order creation, inventory, and payment lifecycle suites passed against an isolated PostgreSQL database. | Local implementation verification passed; staging verification remains pending. |
| Paystack payment | Raw body HMAC validation, server verification, amount/currency comparison, ownership-scoped initialization/reconciliation, idempotent finalization, and reconciliation worker are present. | Signature, webhook, gateway, lifecycle, and HTTP suites passed against an isolated PostgreSQL database. | Local implementation verification passed; staging verification remains pending. |
| Customer tickets and PDF delivery | Profile-scoped paid-order/ticket access, private R2 signed links, durable document jobs, resend outbox records, and required account routes are present. | Customer access, R2, and ticket-document suites passed against an isolated PostgreSQL database. | Local implementation verification passed; staging verification remains pending. |
| RSVP and gate admission | Opaque RSVP links, category restriction, guest-list-scoped edits, credential revocation, owner-scoped preview/confirm, and unique check-ins are present. | RSVP/admission, authenticated HTTP, credential, and worker suites passed against an isolated PostgreSQL database. | Local implementation verification passed; staging verification remains pending. |
| Organizer/admin money operations | Owner-scoped dashboards/exports/refunds/payouts and admin decision/audit paths are present. | Organizer and administration suites passed against an isolated PostgreSQL database. | Local implementation verification passed; staging verification remains pending. |
| Worker and operations | BullMQ schedules reconciliation, notification delivery, PDF generation, and expired-media cleanup; systemd units and readiness routes exist. | Worker/config/scheduler/R2/SMTP suites exist. | Code is present; staging services and recovery procedures still require external acceptance evidence. |

## Contract remediation

- `/api/v1` is now the canonical prefix while legacy routes remain temporarily compatible. The API document is available at `/api/v1/docs` and `/api/v1/docs-json`.
- `/account/me`, account order detail, ticket list, and account ticket-download routes are implemented and ownership-scoped.
- Quote, order-status, and order-reference reconciliation endpoints are implemented. Paid `POST /orders` responses now include the Paystack payment hand-off; the legacy payment-reference route is also ownership-scoped.
- Catalogue supports geographic state, upcoming/featured/popular sort, active-organizer filtering, and availability calculated from active tickets plus unexpired holds.
- Authentication, checkout, RSVP, and payment reconciliation requests have configurable fixed-window limits. `RATE_LIMIT_MAX_REQUESTS` and `RATE_LIMIT_WINDOW_MS` are documented in `.env.example`.
- `ApplicationProfile` now has a `roles` array, with a migration that backfills it from the legacy primary `role`. Authorization accepts any assigned role while preserving legacy behavior during rollout.
- OpenAPI now declares the versioned server, session scheme, workflow tags, protected-operation session requirements, operation summaries, and checkout request-body schemas. Public RSVP discovery and response routes remain explicitly unauthenticated.
- The RSVP guide's collection-style `PATCH /organizer/guest-lists/:id/guests` route is covered by an HTTP authorization regression test and preserves the older guest-ID route for compatibility.
- The guide's media completion route is covered by an HTTP authorization regression test and preserves the existing media-ID-in-path route for compatibility.

### Remaining acceptance work

- Production/staging verification is still required for PostgreSQL, Redis, Paystack, SMTP, R2, backup restore, mobile QR scanning, and load testing. The local staging checklist is correctly present but uncompleted.

## Verification performed

- `npm run typecheck`, `npm run lint`, and `npm run build` — passed after remediation.
- Focused checkout, payment-initialization, reconciliation, account-contract, RSVP, organizer-media, multi-role, and versioned-OpenAPI tests — passed (8 suites / 33 tests in the current contract subset). The versioned OpenAPI suite now inventories every implementation-guide workflow route and HTTP verb, including all administrator decisions and organizer mutations.
- The RSVP rate-limit regression is environment-independent: it now verifies only the limiter's contract (the third request is `429`) and no longer assumes whether a database is configured for the first two invalid requests.
- The complete suite passed against the new isolated `everyticket_contract_audit_20261029` PostgreSQL database with a test-only `BETTER_AUTH_SECRET`: 41 suites / 133 tests passed. The persistence assertion now derives the expected database name from `DATABASE_URL`, preserving isolation from a developer-machine-specific database name.

## Release decision

Do not represent the backend as staging-accepted until the full suite passes against an isolated PostgreSQL database and the documented staging evidence is collected.
