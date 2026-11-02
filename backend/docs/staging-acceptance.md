# Staging acceptance checklist

Run this against test-mode Paystack, a staging PostgreSQL database, staging encrypted Redis, staging SMTP, and separate staging R2 buckets before production access is granted.

- Register an organizer through `/api/v1/organizer-registration`, verify the SMTP-delivered email, confirm the resulting session can create an organizer event, and confirm the same email cannot register twice.
- Complete a paid guest checkout, return using the order reference, retry payment initialization once, reconcile the payment, and verify that order status changes without exposing buyer or ticket data.
- Register a customer with the guest checkout email. Confirm no historical order is visible before email verification and that the paid order/tickets appear immediately after verification.

## Evidence record

Complete this record in the release ticket; do not mark staging accepted from a local test run.

| Field | Record |
|---|---|
| Release revision | |
| Staging URL and execution date | |
| Executor and reviewer | |
| PostgreSQL / Redis / R2 regions and TLS verification | |
| Paystack test transaction references | |
| SMTP recipient inbox evidence | |
| Backup restore owner, duration, and evidence location | |
| Exceptions or follow-up owner | |

Attach the response bodies (with secrets and QR credentials redacted), relevant worker journal entries, signed-link expiry evidence, and the backup-restore result to that release ticket.

- Confirm `/health/live` and `/health/ready` return 200 and an unavailable Redis or PostgreSQL dependency makes readiness return 503.
- Create a paid and a free order. Verify exactly one ticket per unit, one durable notification, one private PDF job, and no duplicate issuance after webhook replay or reconciliation.
- Confirm the worker sends the outbox email, writes the PDF to private R2, and the owner receives a five-minute signed PDF link. Force SMTP/R2 failure, then confirm the paid order remains paid and the durable job retries without duplicate tickets.
- Upload an allowed public image as its organizer, complete the R2 verification, and confirm another organizer cannot complete it. Leave an intent unfinished and confirm the scheduled cleanup removes it.
- Scan a generated PDF QR on iPhone Safari and Android Chrome. Verify valid, wrong-event, revoked, refunded, unpaid, and already-used outcomes; verify concurrent confirmations allow only one check-in.
- Verify an administrator block revokes existing sessions and denies protected calls until unblocked. Verify audit entries for fee, event, account, refund, and payout mutations.
- Run a short catalog and checkout-initialization load test against the agreed initial traffic target. Record limits and results instead of inferring capacity from VPS size.
- Rehearse the documented backup restore into an isolated database and record the restoration evidence, owner, and recovery time.
