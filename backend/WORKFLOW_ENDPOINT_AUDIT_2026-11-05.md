# Workflow and endpoint audit — 2026-11-05

## Environment

All checks used the local environment configuration without recording any values.
Database work used new isolated audit databases, so no application database rows were
read or changed. External services were tested with their configured endpoints.

## Endpoint contract

The OpenAPI inventory test passes and asserts every implemented controller route and
HTTP method is documented. This includes authentication/account, organizer, event,
checkout, payment, customer, guest, RSVP/admission, administration, media, refund,
payout and check-in endpoints.

## End-to-end user journey

`test/organizer-to-buyer-journey.e2e-spec.ts` was added and passes against the
isolated database with the full environment loaded. It verifies this continuous HTTP
journey:

The journey test creates durable records, so the normal suite skips it. Run it only
with a disposable database by setting `RUN_ISOLATED_JOURNEY=1` and `DATABASE_URL` to
that database for the focused test command.

1. Organizer registration and login.
2. Event creation, ticket-type creation and publishing.
3. Public event discovery.
4. Customer registration and login.
5. Quote, free-ticket checkout, then authenticated order-history and ticket access.

## Configured external-service results

| Service | Live result |
| --- | --- |
| R2 | Passed: a real signed URL upload completed, metadata was verified, and the audit object was deleted. |
| Redis/BullMQ | Passed: a real job was enqueued and processed by a uniquely named audit queue and worker, then removed. |
| SMTP | Passed on retest (2026-11-06): the configured server authenticated successfully and a labelled audit message was delivered through the application outbox and marked `SENT`. |

The Redis check deliberately used a unique audit queue. The production worker queue
name is shared and starting it would schedule recurring payment, email and document
work, which is not necessary to prove Redis connectivity and queue processing.

## Complete suite result

With the full local environment loaded, the complete suite ran 43 suites / 179 checks:

- 39 suites / 175 checks passed.
- 4 checks failed due to shared-database test-fixture contamination, not reproduced
  workflow failures:
  - notification-delivery and ticket-document-delivery each processed a leftover job
    in addition to their own fixture;
  - inventory-reservation tried to create an overlapping effective platform-fee rule;
  - authenticated organizer refund-inputs returned 500 in the shared run, but the
    same full suite passes independently on a pristine database (8/8 checks).

The RSVP credential-reissue flow passes with the complete local configuration. The
earlier failure was caused by running the test process without `ADMISSION_TOKEN_SECRET`;
it is not an application defect.

## Gaps to address

1. **Test isolation needs repair.** Tests must clean up durable jobs and use
   non-overlapping fee-rule windows (or run each integration suite against its own
   fresh database). Otherwise a full regression result depends on suite order.
2. **Paid Paystack authorization remains unexercised.** Internal checkout, payment
   lifecycle and webhook behavior pass, but a card/redirect authorization needs a
   deliberate Paystack test-mode transaction.

## Operational note

The complete run emitted a non-failing Prisma/pg warning about calling `client.query()`
while a query was already executing. Track it if concurrency handling changes.
