# Backend state machines

This is a map of the lifecycle rules currently enforced by the backend. The
application uses database enums and guarded service operations rather than a
state-machine library, so the machines below are **implicit**: their states are
stored records, and their transitions are the guarded writes in the listed
services.

The diagrams describe implemented paths, not desired product behavior. A
transition not shown should be treated as unsupported until code and tests add
it.

## Conventions

- A terminal state has no implemented outgoing transition.
- A guard is a condition which must hold before a transition is permitted.
- A side effect happens atomically with the transition unless noted otherwise.
- `ACTIVE` organizer profiles are required for organizer-originated actions.

## Event lifecycle

```text
create
  -> DRAFT --publish (future start/end)--> PUBLISHED
       ^                                  |  ^
       |--unpublish-----------------------|  | restore (admin)
                                          SUSPENDED

PUBLISHED --cancel (organizer)--> CANCELLED
```

| Transition | Guard | Side effects |
| --- | --- | --- |
| create -> `DRAFT` | Active organizer; valid event fields | Organizer audit record |
| `DRAFT` -> `PUBLISHED` | Event begins and ends in the future | `publishedAt`; organizer audit record |
| `PUBLISHED` -> `DRAFT` | Owning organizer | Clears `publishedAt`; organizer audit record |
| `PUBLISHED` -> `SUSPENDED` | Administrator and a reason | Suspension metadata; admin audit record |
| `SUSPENDED` -> `PUBLISHED` | Administrator | Clears suspension metadata; admin audit record |
| `PUBLISHED` -> `CANCELLED` | Owning organizer | Cancels pending orders, removes their reservations, revokes issued tickets and guest credentials, records cancellation metadata and audit record |

`DRAFT` is the only editable event state. Ticket types may also be created,
edited, or removed only while the event is a draft. A draft can be deleted only
when it has no operational or financial records. The current implementation has
no restore path from `CANCELLED` and no organizer path from `SUSPENDED`.

Sources: `src/events/event-catalogue.ts`, `src/events/event-lifecycle.ts`, and
`src/admin/administration.ts`.

## Checkout, inventory, and orders

```text
                         free order
create ------------------------------> PAID
  |
  | paid order + inventory reservation
  v
PENDING_PAYMENT --verified gateway payment + valid reservation--> PAID
  |                    |
  |                    `--payment after / without valid hold--> PAID_NEEDS_RESOLUTION
  |
  +--event cancellation--> CANCELLED
```

The `OrderStatus` enum also contains `EXPIRED` and `FAILED`. No transition that
writes either status is currently present in the mapped services. A failed
gateway verification leaves a pending order retryable unless it is an integrity
mismatch (which moves it to `PAID_NEEDS_RESOLUTION`). Reservation expiry is
checked when fulfillment occurs, but currently produces `PAID_NEEDS_RESOLUTION`
when money has arrived rather than an `EXPIRED` order.

| Transition | Guard | Side effects |
| --- | --- | --- |
| create -> `PENDING_PAYMENT` | Published, checkout-eligible event; active ticket types; sale window, quantity and capacity valid; active fee rule | Snapshot pricing and fee rule; create inventory holds; create a guest capability when no Customer session owns the order |
| create -> `PAID` | Same validation; customer total is zero | Create active tickets, ticket-document jobs and confirmation notification in the same transaction |
| `PENDING_PAYMENT` -> `PAID` | Gateway reference, amount and currency verify; inventory holds still exactly match the lines | Mark payment attempt `VERIFIED_SUCCESS`; issue tickets; queue PDFs and confirmation; release holds; set `paidAt` |
| `PENDING_PAYMENT` -> `PAID_NEEDS_RESOLUTION` | Verified money arrived, but the hold has expired/is missing, or reference/amount/currency does not match | Retain verified-payment evidence, release holds when relevant, prevent another payment |
| `PENDING_PAYMENT` -> `CANCELLED` | Event cancellation | Release holds as part of cancellation |

An order may be accessed by its owning Customer session or, for a guest order,
the matching private capability. The raw guest capability is returned only at
creation time and only its digest is stored. It is never a query parameter.

Sources: `src/checkout/checkout-order.ts`, `src/checkout/inventory-reservation.ts`,
`src/payments/payment-lifecycle.ts`, `src/payments/finalize-paid-order.ts`, and
`src/events/event-lifecycle.ts`.

## Payment attempts

```text
create -> INITIALIZED --gateway success--> VERIFIED_SUCCESS
INITIALIZED --gateway failed--> VERIFIED_FAILED
INITIALIZED --integrity mismatch--> VERIFIED_FAILED + order needs resolution
```

`INITIALIZED` means the backend has created an attempt. A failure to initialise
the external gateway records `failureDetail` but leaves that attempt in
`INITIALIZED`; the order remains `PENDING_PAYMENT` so the purchaser can start a
new attempt. Reconciliation processes initialized attempts for pending orders.
The order, not a single attempt, is the source of truth for fulfillment.

## Ticket and admission lifecycle

```text
ticket issued -> ACTIVE --event cancellation or processed refund--> REVOKED

credential: ACTIVE --check-in--> consumed (check-in record; credential remains ACTIVE)
```

Tickets are created only by free checkout or successful payment finalization.
Check-in is a separate append-only admission record: the scanner validates the
credential, event, ticket state and prior usage before it creates that record.
It does not mutate `TicketStatus` to represent a scan. Revocation means the
ticket can no longer admit its holder.

Guest admissions use parallel data: an accepted RSVP creates a guest with an
`ACTIVE` credential; a declined RSVP starts with a `REVOKED` credential. An
organizer can revoke or reissue an accepted guest credential.

Sources: `src/payments/finalize-paid-order.ts`, `src/admission/rsvp-admission.ts`,
and `src/admission/*`.

## RSVP invitation and guest admission

```text
RSVP response: PENDING -> ACCEPTED -> guest credential ACTIVE
                         \
                          -> DECLINED -> guest credential REVOKED

guest credential: ACTIVE -> REVOKED
                 REVOKED -> ACTIVE  (reissue; accepted guests only)
```

New RSVP links and guest lists are usable only while enabled, unrevoked and
unexpired. Acceptance additionally requires list and link capacity. Submission
is idempotent by idempotency key. An accepted response queues an RSVP
confirmation notification.

## Event media

```text
upload intent -> PENDING --verified object completion--> READY
                   |
                   `--expiry cleanup--> removed
```

Only `READY` media can appear publicly, be reordered, or become the cover.
There is no persisted media failure state; incomplete uploads remain pending
until expiry cleanup.

Source: `src/media/event-media-operations.ts`.

## Refund requests

```text
REQUESTED --organizer cancel--> CANCELLED
     |  \\
     |   `--admin reject--> REJECTED
     `--admin approve--> APPROVED --start gateway refund--> PROCESSING
                                                       |       |
                                                       |       `--gateway failure/mismatch--> FAILED
                                                       `--confirmed--> PROCESSED
```

Refunds are tied to selected tickets in a paid order. `REQUESTED` is the only
organizer-editable state. Approval reserves the approved value; processing is
claimed atomically so a gateway request cannot be started twice. A processed
refund revokes the selected tickets and sends decision notifications. `FAILED`
has no automatic retry transition in the current implementation.

Sources: `src/organizer/organizer-operations.ts` and
`src/admin/administration.ts`.

## Payout requests

```text
REQUESTED --organizer cancel--> CANCELLED
     |  \\
     |   `--admin reject--> REJECTED
     `--admin approve--> APPROVED --record transfer--> PAID
```

A payout request can be created only after the event ends and only when
positive payout-eligible funds remain after paid payouts and active refund and
payout reservations. `REQUESTED` and `APPROVED` amounts reserve those funds.
The backend records the settlement transfer rather than initiating it.

Sources: `src/organizer/organizer-operations.ts` and
`src/admin/administration.ts`.

## Asynchronous delivery jobs

### Notification jobs

```text
PENDING -> SENDING -> SENT
   ^          |
   |          `--failure--> PENDING (retry) or FAILED (max attempts)
   `--stale sending recovery--
```

### Ticket-document jobs

```text
PENDING -> PROCESSING -> READY
   ^            |
   |            `--failure--> PENDING (exponential backoff) or FAILED (max attempts)
   `--stale processing recovery--
```

Both workers atomically claim work to avoid duplicate processing. Stale claims
are returned to pending after five minutes. Completion clears failure metadata;
terminal failure keeps it for operations review.

Sources: `src/worker/notification-delivery.ts` and
`src/worker/ticket-document-delivery.ts`.

## Identity and account access

```text
profile status: ACTIVE <-> BLOCKED
roles: CUSTOMER -> CUSTOMER + ORGANIZER
```

Only an administrator may block or restore a non-admin profile; blocking also
invalidates its sessions. An active Customer may be upgraded to Organizer,
which adds the organizer role without removing Customer access. There is no
implemented role downgrade path.

Sources: `src/admin/administration.ts` and `src/identity/organizer-upgrade.ts`.

## Maintenance notes

When adding a lifecycle transition, update all of the following together:

1. The guarded backend write and its transaction-level tests.
2. Public and organizer API serialization/authorization.
3. The frontend labels, actions, polling/retry behavior and accessibility copy.
4. This document and any relevant ADR if the lifecycle contract changes.
