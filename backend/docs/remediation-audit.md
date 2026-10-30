# Remediation audit

**Date:** 28 October 2026  
**Scope:** Critical findings from the backend implementation audit, controller database-lifecycle duplication, and production dependency advisories.

## Resolved critical findings

| Finding | Result | Evidence |
|---|---|---|
| Public catalogue and organizer event lifecycle were incomplete | Resolved | `EventController` provides public category/list/detail routes and owner-protected event create/list/detail/update/publish/unpublish and ticket-type create/update/delete routes. `event-catalogue.e2e-spec.ts` verifies owner-scoped draft changes, ticket lifecycle and publish/unpublish; `event-catalogue-http.e2e-spec.ts` verifies the protected route surface. |
| Checkout did not associate an authenticated buyer with the order | Resolved | `CheckoutController` resolves the active `CUSTOMER` profile before validation and passes its immutable profile ID to `createCheckoutOrder`; the order write persists `customerProfileId`. Unauthenticated creation is covered by `checkout-http.e2e-spec.ts`. |
| Check-in preview did not prove the organizer owned the selected event | Resolved | `previewAdmission` now performs an owner-scoped active-organizer event lookup before revealing a credential preview. `rsvp-admission.e2e-spec.ts` covers cross-organizer and unknown-event rejection. |
| Controllers independently created and disconnected Prisma clients | Resolved | `persistence/database-operation.ts` owns the shared availability check, client lifecycle, and guaranteed disconnect. Its feature-operation factory removes the repeated controller wrappers. Customer, event, admission, organizer, administrator, checkout, payment initialization, and payment processing paths use it. `database-operation.spec.ts` proves cleanup and feature-specific unavailable handling. The health endpoint remains intentionally independent because it directly checks database readiness. |
| High/moderate production dependency advisories | Resolved | Nest runtime/testing packages were aligned to `12.3.2`, Swagger to `12.0.5`, and Multer to `2.5.0`. `npm audit --omit=dev --audit-level=high` reports zero vulnerabilities. |

## Verification performed

- Full local PostgreSQL-backed suite: **40 suites, 122 tests passed**.
- `npm run lint`, `npm run typecheck`, and `npm run build` passed.
- Prisma migration status: **24 migrations found; database schema is up to date**.
- Production dependency audit: **0 vulnerabilities**.

## Remaining non-critical work

These are not accepted as completed merely because the critical remediation is green:

- Public catalogue needs the remaining specification filters/sorts (state, upcoming/featured/popular) and capacity availability presentation.
- API validation is intentionally narrow/manual in the existing codebase; formal DTO/OpenAPI field contracts and request-rate limits still need their own implementation and tests.
- Password-reset privacy and production readiness require deployment-level verification; staging acceptance remains a controlled external deployment activity.
- The full test run emits a `pg` deprecation warning about overlapping `client.query()` calls. It does not fail the suite, but should be resolved before the next `pg` major upgrade.
