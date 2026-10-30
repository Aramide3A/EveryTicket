# EverythingTicket Backend Development Specification

**Version:** 1.1  
**Last updated:** 6 October 2026  
**Purpose:** Implementation brief for a developer or coding model  
**Scope:** The agreed event-ticketing MVP, with customer accounts, Paystack payments, RSVP, and browser-based QR check-in  
**Relationship to contract:** This document explains backend behavior. It does not add features, change the price, or change the three-week schedule in the development agreement.

## 1. Product boundary and implementation decisions

EverythingTicket lets an organizer create and publish an event without waiting for admin approval, sell or issue tickets, invite RSVP guests, monitor attendance, request refunds, request a post-event payout, and scan entrants using the website on a phone. Customers can create accounts and view all tickets linked to their accounts. An administrator monitors the platform, configures platform fees, blocks accounts, approves refund requests, and records manual organizer payouts.

Build a **modular NestJS application in TypeScript** with a REST API and a separate background worker process. Use **Prisma ORM** for all database models, queries, transactions, and migrations. Use PostgreSQL as the authoritative database. Use **Better Auth** for customer, organizer, and administrator authentication and session management through its official Prisma adapter. Keep Better Auth's authentication tables and EverythingTicket's business tables in one reviewed Prisma schema and migrate them through Prisma Migrate. Do not duplicate password or session data in separate application models.

PostgreSQL and Redis must be **external managed services**, not containers or processes on the application VPS. Redis may support Better Auth secondary storage, background queues, rate limiting, and short-lived cache, but **never rely on Redis as the only copy of an order, inventory hold, payment result, ticket, refund, payout, or check-in**. The application VPS runs only the API and worker as ordinary system services; **do not use Docker or Docker Compose**. Use Cloudflare R2 for event media and private ticket PDFs. Put the public website behind HTTPS and Cloudflare. Keep PostgreSQL and Redis connections provider-neutral so either service can move without application changes.

Use Nigerian naira (`NGN`) for the MVP. Store all money as **integer kobo**, never floating point. Store timestamps in UTC; return ISO 8601 timestamps and an event time zone for display. Default event time zone may be `Africa/Lagos`, but persist it per event.

### In scope

- Better Auth registration, login, logout, verification/reset flows, sessions, and role/status enforcement for customers, organizers, and administrators.
- Customer account area showing the customer's orders and purchased tickets, with secure ticket/PDF access.
- Public event listing, search, city/state and category filters, upcoming and admin-featured events.
- Organizer event and ticket-type CRUD with direct publishing; no admin approval step before publication.
- Authenticated checkout, optional guest checkout where retained, paid and free tickets, Paystack transaction initialization/verification, unique admission credentials, confirmation email, and secure ticket/PDF access.
- Private RSVP links, organizer-controlled guest categories, guest management, QR credentials, and guest check-in.
- Organizer sales, attendee, and attendance summaries with CSV export.
- Organizer-created refund requests with administrator approval and auditable Paystack completion status.
- Organizer-created post-event payout requests with administrator review and manual payout records; no automatic Paystack split or transfer.
- Admin account blocking/unblocking, event suspension, configurable platform-fee rules, transaction/refund/payout records, basic platform totals, and audit entries.
- Browser scanner support through authenticated validation and atomic check-in endpoints.
- Backups, basic monitoring, structured logs, deployment configuration, and handover instructions.

### Out of scope for this build

Native apps, GPS-based nearby events, advanced ranking, seating maps, dynamic pricing, bundles, ticket resale, automated organizer bank transfers or Paystack split settlements, campaign marketing, SMS/WhatsApp, a blog/CMS, and advanced reporting. A separate admin/staff **event creation on behalf of an organizer** flow and separate check-in staff accounts were not explicitly committed in the agreement. Do not silently add them; use organizer-authenticated scanning for the MVP. Never share the organizer's password as a staff-access mechanism.

## 2. Roles and authorization

| Actor | Backend permissions |
|---|---|
| Public visitor | Read published events, register/login, use an allowed RSVP link, and use a secure guest-order link when guest checkout is enabled. |
| Customer | Manage own account, create orders, view own purchase history and tickets, and download own ticket PDFs. Refunds are routed to and handled by the event organizer, then approved or rejected by the administrator. |
| Organizer | Manage own profile, publish/manage own events and ticket types, view own orders/attendees, manage RSVP lists, check in attendees, create refund requests, and request eligible post-event payouts. |
| Administrator | Block/unblock accounts, suspend/restore events, configure platform fees, search orders/payments, approve/reject refund and payout requests, record external money movement, set featured events, and view platform summaries. |

An organizer cannot read or mutate any other organizer's event, attendee, refund, payout, or guest record. A customer can read only orders/tickets whose `customerUserId` matches the authenticated Better Auth user. Check ownership in the service/database query, not only in a controller guard. Every admin mutation writes an audit entry with actor, target, action, timestamp, and relevant change details. Guest order access, if enabled, uses a long random, revocable token delivered to the purchaser's email; an order reference alone is never sufficient to retrieve personal data or tickets.

Configure Better Auth for email/password registration, login/logout, email verification where required, password reset, and secure cookie sessions. Admin accounts must be provisioned deliberately; public signup cannot request the admin role. Keep application-owned roles and `status` fields server-controlled and never accept them from public signup input. After Better Auth verifies a session, an application authorization guard must load the user's application profile and enforce `ACTIVE/BLOCKED` status plus role/ownership on every protected request. Blocking an account revokes its active sessions and prevents new sessions or protected actions until an administrator unblocks it. Rate-limit login, reset, checkout creation, RSVP submission, and guest order-access requests. Password-reset responses must not reveal whether an email exists.

Better Auth's documented NestJS integration requires special body-parser handling, while the Paystack webhook also requires the exact raw request body for signature verification. Implement and test route-specific raw-body handling so enabling Better Auth does not break normal JSON DTO parsing or Paystack HMAC validation.

## 3. Core data model

Use migrations with named foreign keys, indexes, and uniqueness constraints. Names below describe concepts; the exact table names may follow the project's conventions.

| Entity | Required fields and constraints |
|---|---|
| Better Auth tables | Better Auth-owned user, session, account, and verification data, represented in the same Prisma schema using its official Prisma adapter. Use distinct table names such as `auth_user`, `auth_session`, `auth_account`, and `auth_verification`; migrate them with Prisma Migrate. Do not duplicate password or session data in separate application models. |
| `UserProfile` / `UserRole` | Profile ID, unique `authUserId`, one or more server-controlled roles (`CUSTOMER/ORGANIZER/ADMIN`), status (`ACTIVE/BLOCKED`), optional phone, blockedAt/blockedBy/blockReason, created/updated timestamps. Created transactionally or through a durable signup hook. Default public signup receives `CUSTOMER`; an organizer onboarding flow may add `ORGANIZER`, while `ADMIN` is provisioned only by an existing authorized administrator. Organizer details may be a separate 1:1 profile. |
| `Event` | ID, organizer profile ID, title, unique slug, description, category ID, city/state, venue/address, time zone, start/end times, policies, state, featured flag, images, published/suspended/cancelled timestamps and reasons. No approval/reviewer fields. Index effective sale state, start time, and search/filter fields. |
| `TicketType` | ID, event ID, name, priceKobo, capacity, salesStart/salesEnd, active flag, optional per-order limit. Unique name within an event if desired. Purchased tickets store a price/name snapshot. |
| `PlatformFeeRule` | ID/version, mode (`PERCENTAGE/FIXED`), percentage basis points or fixed amount in kobo, active/effective timestamps, changedBy. Exactly one active rule at checkout time. Historical rules are immutable and remain available for audit. |
| `Order` | ID, unique public reference, event ID, nullable customer profile ID for guest compatibility, buyer name/email/phone snapshot, currency, ticketSubtotalKobo, platformFeeKobo, totalKobo, platform-fee rule/version snapshot, status, holdExpiresAt, optional secret access-token digest, created/paid timestamps. Enforce `totalKobo = ticketSubtotalKobo + platformFeeKobo`. |
| `OrderLine` | Order ID, ticketType ID, quantity, unitPriceKobo snapshot, lineTotalKobo. |
| `InventoryHold` | Order ID, ticketType ID, quantity, expiry, state. Holds and confirmed sold quantities are authoritative in PostgreSQL. |
| `PaymentAttempt` | Order ID, unique Paystack reference, expected total amount/currency, gateway transaction ID if known, status, verifiedAt, failure detail. No Paystack subaccount/split fields. One order can have a controlled retry with a new attempt/reference. |
| `Ticket` | ID, order ID, event ID, ticketType ID, holder name/email, price/name snapshot, status, QR token digest, issued/revoked timestamps. Exactly one ticket per purchased quantity. |
| `GuestList` / `RsvpLink` | Event ID, name, limit, enabled/expiry, link token digest, optional fixed category ID. No sequential public tokens. |
| `GuestCategory` / `Guest` | Event/list/category IDs; guest name/contact, response and status, QR token digest if accepted, created/updated timestamps. Guest cannot choose a restricted category. |
| `CheckIn` | Unique ticket ID **or** unique guest ID, event ID, checkedInAt, actor ID. A database uniqueness constraint enforces one entry per credential. |
| `RefundRequest` | ID, organizer/event/order/payment references, ticketRefundKobo, platformFeeRefundKobo, totalRefundKobo, reason, affected ticket IDs, state, requestedBy/requestedAt, admin reviewer/decision/reason/timestamps, Paystack refund reference/status, processedAt. Organizer requests; administrator approves/rejects and records or initiates the actual Paystack action. |
| `PayoutRequest` | ID, organizer/event, ticketSubtotalKobo, processedRefundKobo, adjustmentsKobo, priorPaidKobo, requestedAmountKobo, calculatedPayableKobo, status, requestedBy/requestedAt, reviewer/decision, bank transfer reference/date, recordedBy. Request is allowed only after the event end time and no bank transfer is initiated automatically. |
| `MediaObject` | R2 key, bucket/visibility, content type, size, owner/event, status. Store keys rather than expiring signed URLs. |
| `NotificationJob` / `AuditLog` | Durable transactional-email intent, attempts/status; immutable administrative and payment-related action history. |

Important constraints: unique Better Auth link per profile; unique order reference; unique Paystack attempt reference; unique gateway transaction ID when present; unique ticket QR digest; unique guest QR digest; unique check-in per ticket or guest; unique outbox/notification key for each email event; no overlapping active platform-fee rules. Index customer ticket-history, organizer event, and dashboard queries. Never delete orders, tickets, payments, refunds, payouts, or check-in history when hiding an event or blocking an account.

## 4. State transitions

### Event

`DRAFT -> PUBLISHED` is an organizer-controlled transition after server validation; it does **not** require admin approval. An administrator may move a published event to `SUSPENDED` and later restore it to `PUBLISHED`. An organizer or authorized administrator may move an event to `CANCELLED` under the cancellation policy. Only `PUBLISHED` events owned by an active organizer account and within a valid sales window accept new orders. After sales begin, sensitive edits to date, venue, cancellation policy, or ticket prices require warnings and audit history; existing order and ticket snapshots never change retroactively.

### Order and payment

An order begins `PENDING_PAYMENT` with expiring inventory holds and an immutable price breakdown: `ticketSubtotalKobo`, `platformFeeKobo`, and `totalKobo`. Successful verified payment of the exact `totalKobo` moves it to `PAID` exactly once and issues tickets. A verified failed/abandoned attempt may be marked `FAILED` or `CANCELLED`; an expired hold becomes `EXPIRED` and cannot later issue tickets automatically. If money arrives after the hold expires and capacity is no longer safely available, set `PAID_NEEDS_RESOLUTION`, alert admin, and arrange fulfillment or an organizer-requested/admin-approved refund. **Do not mark a paid transaction failed solely because the browser closed or a webhook was late.**

An organizer creates a refund request in `REQUESTED`. The administrator moves it to `APPROVED` or `REJECTED`; an approved request then moves through `PROCESSING -> PROCESSED` or `FAILED` based on real Paystack evidence. Never expose platform Paystack credentials to organizers and never mark a refund complete merely because the organizer requested it or the admin clicked approve. A full processed refund revokes affected tickets and blocks check-in. A partial refund must identify the affected ticket IDs and exact amount. Do not automatically restock refunded capacity without an explicit policy and sale-window/event-state checks.

An organizer may create a payout request only after the event's `endAt` time. Its states are `REQUESTED -> APPROVED -> PAID` or `REJECTED`. The payable amount is computed server-side from paid ticket subtotals, less processed organizer-liable refunds, prior payouts, and explicit audited adjustments. The customer-paid platform fee is excluded from organizer payout. Paystack split settlement and automatic bank transfer are prohibited in this MVP. The administrator records `PAID` only after the external transfer succeeds and a transfer reference is available.

### RSVP and admission

Guest response is `PENDING/ACCEPTED/DECLINED`; credential status is `ACTIVE/REVOKED`; check-in is recorded only for an active paid/free ticket or accepted RSVP guest for the selected event. A second scan reports `ALREADY_USED` with the recorded time and never creates another entry.

## 5. Backend modules and behaviors

### 5.1 Public catalog

Return paginated published events with safe public fields. Support text search (name/description), city/state and category filters, upcoming sort, and admin-featured selection. A simple popular sort may use confirmed tickets sold. Exclude draft, suspended, and cancelled events, plus events whose organizer account is blocked from selling. Return ticket availability based on confirmed sales plus unexpired holds, without exposing private buyer data. Use short-lived cache only for public listing; invalidate it on publishing, suspension, account blocking, or relevant event edits.

### 5.2 Organizer event management

Validate title, dates, time zone, category, location, policies, and image references. Allow draft save, ticket-type creation/editing, and immediate organizer publication once required fields pass validation. There is no submit/review/approve workflow. Reject invalid ticket windows, negative amounts, capacity below already sold/held quantity, unauthorized media keys, and changes that would invalidate existing tickets. Preserve original ticket terms on each sold ticket. Return actionable validation errors by field. A blocked organizer cannot create, edit, publish, or sell tickets; an administrator may suspend or restore an event without becoming its owner.

### 5.3 Inventory and checkout

Server computes all prices; ignore client-supplied totals. Calculate `ticketSubtotalKobo` from order-line snapshots. Load the one active platform-fee rule and calculate either a fixed fee or a percentage fee using integer arithmetic and an explicitly documented rounding rule. Set `totalKobo = ticketSubtotalKobo + platformFeeKobo`. Snapshot the fee rule ID, mode, and value on the order so later administrator changes never alter an existing order, refund, receipt, or payout calculation. A percentage rule applies to the ticket subtotal once per order; a fixed rule also applies once per order unless the administrator UI explicitly labels and stores it as per-ticket. Unless the system administrator explicitly enables a fee for free orders, a zero ticket subtotal produces a zero platform fee.

The checkout review response and Paystack confirmation page must show three values before authorization: **Ticket amount**, **Platform fee**, and **Total payable**. The Paystack initialization amount must equal the displayed total. Paystack processing charges are an internal platform cost and are not shown as a third customer line item in this MVP; the configured platform fee may be priced to cover them. The organizer payout calculation must not include the customer-paid platform fee.

Validate event, active organizer status, sale window, per-order limits, and available capacity in one Prisma transaction. Create an order, lines, and expiring holds using Prisma's transaction client with a PostgreSQL conditional-update strategy or parameterized row-lock query where required. Never issue a query through the root Prisma client once the transaction begins; pass the transaction client into every helper that participates in the operation. Holds are authoritative in PostgreSQL; a scheduled job expires them and the availability query ignores expired holds even if cleanup is delayed. Set the hold TTL as a configuration value, initially around 10 minutes, then test it against Paystack payment methods that may remain pending longer. Do not promise guaranteed tickets while a payment is pending beyond the hold.

For a zero-value total, skip Paystack and atomically confirm the order, consume inventory, issue tickets, and write notification intent. A paid order initializes Paystack from the backend with the unique attempt reference, email, `NGN`, and `totalKobo`. Do **not** send a Paystack split, subaccount, transaction charge, or transfer recipient. The platform Paystack account receives the transaction for later post-event payout processing. Return only the authorization URL/access code needed by the browser. Never send the Paystack secret key to the frontend.

### 5.4 Paystack finalization and reconciliation

Expose a public webhook route with the **raw request body** available for `x-paystack-signature` HMAC-SHA512 validation. Reject invalid signatures. For a `charge.success` event, locate the matching attempt and verify the transaction server-to-server. Compare Paystack `data.status`, exact reference, currency, amount in kobo, and any expected order/account fields. The API-level `status` boolean is not the transaction status. One shared idempotent finalization service must handle webhook and callback/reconciliation results. In one database transaction, lock the order, confirm it has not been fulfilled, consume valid holds, set paid state, create tickets and QR secrets, and record durable email intent. Return HTTP 200 promptly after safe durable processing; send email/PDF in a worker.

Paystack documents successful-transaction webhooks; failed, abandoned, or long-pending orders therefore also need a scheduled reconciliation task using the verification API. The browser callback merely triggers a status refresh/reconciliation and may show `PENDING`; it cannot itself mark an order paid. Replayed webhook and callback must not duplicate tickets, decrement inventory twice, or send duplicate email. Unknown references and mismatched amount/currency become security/reconciliation alerts. Preserve enough gateway metadata for support without storing card details.

### 5.5 Ticket issuance and access

Create one ticket per purchased/free unit. Generate a cryptographically random QR secret and store its digest; the QR contains an opaque token or validation URL, not price/payment/attendee claims. Generate a PDF with the event, date, venue, ticket type, holder, human-readable code, and QR; store it in a **private** R2 bucket. Link authenticated purchases to `customerUserId`. The customer account area lists the user's orders and tickets, including event status, ticket status, purchase date, ticket amount, platform fee, total paid, and secure download action. Each account endpoint must query by the authenticated customer ID; never accept a customer ID from the URL or request body as authorization.

The confirmation email may include an attachment and secure order-access link as fallback. Guest orders, if retained, remain accessible only through their secret email link until a separate verified claim flow is implemented. Never attach a guest order to an account solely because the emails match. Do not expose a private R2 object through a public custom domain.

### 5.6 RSVP

Organizer creates a guest list and private high-entropy link, optionally fixed to a category. Guest submissions validate enabled/expiry/limit and capture the configured details. An open shared link cannot let the guest self-assign VIP or other restricted categories. Accepted responses issue a unique guest QR and email confirmation; declined guests do not get an active credential. Organizer may add/edit/remove/revoke guests, search/filter, and export the list. Revocation invalidates QR immediately. Prevent accidental duplicate form submissions with an idempotency key or equivalent behavior; allow legitimate family members to share an email address.

### 5.7 QR scanning and check-in

The frontend's phone camera reads the QR and calls the API. Provide a **preview** endpoint returning a minimal status and name/ticket type for the selected event, then a **confirm check-in** endpoint for the gate operator. The confirm endpoint always revalidates and atomically inserts the check-in record or conditionally changes credential state. Preview is not a reservation and does not guarantee entry. If two phones confirm the same token at once, exactly one succeeds; the other gets `ALREADY_USED` and the original timestamp. Reject unknown, revoked, refunded/unpaid, wrong-event, or expired credentials. Require an authenticated organizer who owns the event. Include a manual human-readable ticket code lookup/confirmation fallback only if agreed as part of final acceptance; do not make an order reference a valid gate credential.

Use a stable result contract such as `VALID`, `CHECKED_IN`, `ALREADY_USED`, `WRONG_EVENT`, `REVOKED`, `UNPAID`, and `INVALID`, with no sensitive detail on unknown tokens. Normal check-in requires an internet connection. Offline multi-device check-in is outside scope.

### 5.8 Dashboards and exports

Organizer summary: confirmed tickets sold, remaining inventory, ticket-subtotal sales, customer-paid platform fees shown separately, refunds recorded, estimated payable balance, sales by ticket type, order list, ticket/guest attendance counts, and trends from persisted timestamps. Before event end, label the balance as **estimated/not yet eligible**. After event end, show the server-calculated amount eligible for a payout request. Distinguish total customer payments, ticket subtotal, platform fees, refunds, and organizer payable balance. Scope all queries to the organizer. CSV exports use safe escaping (including spreadsheet formula injection protection) and only needed attendee fields. Admin sees basic platform totals, platform-fee revenue, refund/payout liabilities, and searchable orders/payment attempts.

### 5.9 Refund and payout records

The organizer creates a refund request for an order, selects the affected tickets, enters the ticket-refund amount, any requested platform-fee refund, and reason, and may edit/cancel it only while still `REQUESTED`. The administrator reviews the order/payment state and either rejects it with a reason or approves an exact component breakdown. Approval and gateway completion are separate actions. The app may call Paystack's refund API after approval or let the administrator act in the Paystack dashboard, but it must store the gateway reference/status and reconcile the result before moving to `PROCESSED`. Organizers never receive the platform's Paystack credentials. Each transition writes an audit log and notifies the relevant parties.

After event end, the organizer requests payout for that event. The server calculates the eligible amount; the organizer cannot submit an arbitrary larger amount. Pending or approved-but-unprocessed refunds reduce or temporarily reserve payout availability. The administrator approves/rejects, performs the bank transfer outside the app, and records the actual transfer reference/date before marking it `PAID`. Store refunds, adjustments, and prior payouts so the same revenue is never paid twice. Lock the event payout ledger during calculation/approval to prevent duplicate concurrent requests. A processed organizer-liable refund after payout creates a negative organizer balance/receivable that is recovered from later payouts or settled manually; it must never be silently charged to unrelated platform revenue.

The system administrator can replace the active platform-fee rule with either `PERCENTAGE` or `FIXED`. Changing the rule creates a new immutable version and takes effect only for new orders. Never update historical order fee snapshots. Audit actor, old rule, new rule, effective time, and reason.

### 5.10 Media, email, and jobs

Use R2's S3-compatible API. Store public event images under an event-specific key and serve them through a public media domain with cache controls. Store ticket PDFs privately; short-lived presigned GET URLs use the R2 S3 API domain, not the public image domain. Validate image type and size, verify the upload belongs to the current organizer/event, and remove orphaned uploads on a schedule. Avoid keeping permanent uploads on VPS disk.

Persist an email/outbox record in the same transaction that confirms the order or RSVP; the worker sends and retries transactional messages for paid/free tickets, RSVP confirmations, refund/payout decisions, and any application-managed password-reset delivery hooks. Email failure must never roll back a paid order. Record failed delivery for retry/admin investigation and offer a resend operation that does not reissue tickets. Use the external Redis service for BullMQ/background execution and Better Auth secondary storage where configured, while durable PostgreSQL intent protects against lost jobs after an API/worker restart.

## 6. Suggested REST API surface

Use `/api/v1`; exact path names may follow repository conventions. Document DTOs, authentication, response schemas, pagination, and error codes in OpenAPI. Avoid returning internal ORM objects directly.

| Area | Endpoints and key behavior |
|---|---|
| Auth | Mount Better Auth under a documented path such as `/api/auth/*` for sign-up, sign-in, sign-out, verification, password reset, and session operations. Add `GET /api/v1/account/me` for the application profile/role/status. Do not reimplement password storage in NestJS. |
| Customer account | `GET /account/orders`, `GET /account/orders/:id`, `GET /account/tickets`, `GET /account/tickets/:id`, `GET /account/tickets/:id/download`. Every query derives customer identity from the verified session. |
| Public catalog | `GET /categories`, `GET /events?query=&city=&state=&category=&sort=&page=`, `GET /events/:slug`. |
| Checkout | `POST /orders/quote` (server-computed ticket amount, platform fee, total and short expiry), `POST /orders` (items/buyer, recomputes totals and returns pending order plus Paystack URL or confirmed free order), `GET /orders/:reference/status` (limited information), plus secret guest-access endpoints only if guest checkout remains enabled. |
| Payment | `POST /webhooks/paystack` (raw body + signature), `POST /orders/:reference/reconcile` (rate-limited browser recovery; server verifies), internal scheduled reconciliation. |
| Organizer events | `GET/POST /organizer/events`, `GET/PATCH /organizer/events/:id`, `POST /organizer/events/:id/publish` (no admin approval), `POST /organizer/events/:id/unpublish` where allowed, `POST/PATCH/DELETE /organizer/events/:id/ticket-types`. |
| Organizer operations | `GET /organizer/events/:id/dashboard`, `GET /organizer/events/:id/orders`, `GET /organizer/events/:id/attendees`, `GET /organizer/events/:id/attendees.csv`, `POST /organizer/orders/:orderId/refund-requests`, `GET /organizer/refund-requests`, `POST /organizer/events/:id/payout-requests`, `GET /organizer/payout-requests`. |
| RSVP | `POST /organizer/events/:id/guest-lists`, `POST /organizer/guest-lists/:id/links`, `GET/POST/PATCH /organizer/guest-lists/:id/guests`, `GET /organizer/guest-lists/:id/guests.csv`, `GET /rsvp/:token`, `POST /rsvp/:token/responses`. |
| Check-in | `POST /organizer/events/:id/check-ins/preview`, `POST /organizer/events/:id/check-ins/confirm`, `GET /organizer/events/:id/check-ins/summary`. Both POST routes require auth/ownership. |
| Admin | `GET /admin/events?state=`, `POST /admin/events/:id/suspend`, `POST /admin/events/:id/restore`, `PATCH /admin/events/:id/featured`, `GET /admin/users`, `POST /admin/users/:id/block`, `POST /admin/users/:id/unblock`, `GET /admin/orders`, `GET /admin/refund-requests`, `POST /admin/refund-requests/:id/approve`, `POST /admin/refund-requests/:id/reject`, `POST /admin/refund-requests/:id/mark-processed`, `GET /admin/payout-requests`, `POST /admin/payout-requests/:id/approve`, `POST /admin/payout-requests/:id/reject`, `POST /admin/payout-requests/:id/mark-paid`, `GET/PUT /admin/platform-fee-rule`, `GET /admin/summary`. |
| Media | `POST /organizer/events/:id/media/upload-intent`, `POST /organizer/events/:id/media/complete` or a server-streaming upload route, and private ticket download-link generation behind order access. |

For mutations, use validation DTOs, explicit allowed fields, and appropriate `400/401/403/404/409/422/429` responses. A conflict such as sold-out inventory or already-used QR should have a stable machine-readable code. Never expose another user's data through a distinction between 403 and 404 on secret resources.

## 7. Infrastructure and environment

Run the API and worker as separately restartable **systemd services** (or an agreed non-container process supervisor) on the VPS. Do not install or use Docker. PostgreSQL and Redis are external managed services and must require encrypted connections, credentials stored outside source control, network restrictions where supported, automated backups for PostgreSQL, retention, and restore testing. Use a pooler when the PostgreSQL provider recommends it and limit application connections; do not assume extra API processes imply unlimited database connections.

Environment variables should include `DATABASE_URL`, `REDIS_URL`, Better Auth secret/base URL/trusted origins, `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY` only where needed, R2 account/endpoint/bucket/key credentials, email provider credentials, public app URL, media URL, worker settings, and hold/notification TTLs. Store the active fee rule in PostgreSQL, not an environment variable. Use the Paystack secret key to validate webhook HMAC as documented by Paystack. Keep test and live keys separate; never log secrets or full QR/order-access/session tokens.

Expose health and readiness endpoints. Monitor API errors/latency, VPS CPU/RAM/disk, database availability and connections, queue lag, webhook failures, pending orders, failed email jobs, and suspicious invalid scans. Log order reference and internal IDs for diagnosis, excluding payment card data and personal information where unnecessary. Configure HTTPS, firewall, automated security updates, and a deployment/rollback procedure. Take a backup before production migrations.

## 8. Acceptance tests that protect money and entry

The development model should implement meaningful automated tests around these cases; mocks alone are insufficient for race conditions. Use an isolated PostgreSQL test database for transaction and uniqueness tests, plus Paystack test-mode integration where practical.

1. Two concurrent buyers requesting the last ticket cannot both acquire a valid hold.
2. A hold expiry and a payment-success webhook arriving together cannot oversell or silently discard a real payment. A late paid order enters an explicit resolution state if fulfillment is unsafe.
3. Duplicate signed webhooks, webhook plus callback reconciliation, and retries create exactly one paid order fulfillment and the correct number of tickets.
4. Invalid webhook signature, mismatched `totalKobo`/currency/reference, or Paystack `data.status != success` never issue tickets.
5. Fee tests cover fixed and percentage modes, integer rounding, quote/order recomputation, and rule changes. Every checkout shows ticket amount, platform fee, and total; existing orders keep their original fee snapshot after an admin change.
6. Paystack initialization contains no split/subaccount/transfer instruction, and the initialized amount equals the displayed total.
7. Free orders produce tickets without Paystack; paid tickets are issued only after server verification.
8. Customer A cannot list, open, or download Customer B's order or ticket. A logged-in customer's paid tickets appear in the account area after idempotent finalization.
9. A blocked customer/organizer loses active access and cannot create protected actions. A blocked organizer's events cannot accept new checkout. Unblocking does not silently restore an event explicitly suspended by admin.
10. An active organizer can publish a valid event without admin approval; invalid drafts cannot publish; admin can suspend/restore but no approve/reject endpoints exist.
11. Two simultaneous check-in requests for one QR yield one success and one `ALREADY_USED`; wrong-event, revoked, refunded, and unknown QR codes never enter.
12. Organizer A cannot access or mutate organizer B's event, refund request, payout request, guest list, attendees, dashboard, media, or check-in endpoint.
13. Refund requests require organizer ownership and admin approval. Approval alone does not mark a refund processed; only reconciled gateway evidence does. Processed affected tickets are revoked.
14. Payout cannot be requested before event end, cannot exceed the server-calculated payable amount, cannot be paid twice, and is never automatically sent by Paystack.
15. A guest cannot change a fixed invitation category to VIP; a revoked RSVP link or guest credential cannot be used.
16. Email/R2 failure after payment does not change a paid order to unpaid; a retry restores delivery without duplicating tickets.

Also test public event filtering, pagination, validation, password reset, CSV escaping, and signed private ticket access. Run a short load test of catalog and checkout initialization before launch and a gate check-in rehearsal on iPhone Safari and Android Chrome. Define a realistic initial traffic target with the client before promising capacity; a VPS size alone is not a throughput guarantee.

## 9. Delivery order for a coding model

1. Inspect the existing repository, dependencies, migrations, lint/test conventions, and environment examples. Summarize what exists and identify contradictions with this specification. Preserve established project patterns except where this specification explicitly requires Prisma, Better Auth, no Docker, and external PostgreSQL/Redis.
2. Configure Better Auth with its Prisma adapter, then define Better Auth and application-owned models in the Prisma schema and generate/apply Prisma migrations. Add the application profile creation hook, role/status guard, account blocking/session revocation, owner-scoped authorization, direct event publishing, and public catalog. Add seed data for an admin and sample events without live credentials.
3. Implement versioned platform-fee rules, deterministic quote calculation, transactional inventory holds, authenticated/free checkout, Paystack initialization without split instructions, raw-body webhook verification, idempotent ticket issuance, customer ticket history, and durable notification intent. Prove fee, concurrency, ownership, and replay cases before proceeding.
4. Implement RSVP and QR validation/check-in with owner-scoped access and atomic database constraints.
5. Implement dashboards, CSV, organizer refund requests with admin approval, post-event payout requests with manual completion, media/R2, worker/email, admin actions, and audit entries.
6. Add integration tests, OpenAPI docs, non-Docker system-service deployment configuration, managed PostgreSQL/Redis setup notes, backup/restore instructions, monitoring, staging acceptance evidence, and production handover notes.

For each module, provide migrations, DTOs, guards, service logic, API contracts, tests for the failure modes above, and a short explanation of how to run it. Do not replace durable PostgreSQL state with an in-memory map or a Redis-only reservation. Do not mark a feature complete based only on a happy-path controller. Raise a specific question if an unresolved business rule changes how money or admissions are handled; otherwise make the smallest documented assumption and continue.

## 10. Decisions to record before production

- Managed PostgreSQL and Redis providers, regions, connection limits, TLS requirements, PostgreSQL backup retention, and restore owner.
- Exact checkout hold TTL and policy for delayed Paystack methods or paid transactions after expiry.
- Initial platform-fee mode/value, percentage rounding rule, whether fixed means per-order or per-ticket, and the authorized admin roles that can change it.
- Whether Paystack processing charges are fully absorbed by the configured platform fee and the exact accounting report treatment; do not deduct them from organizer payout without an explicit approved rule.
- Refund limits, required evidence, whether the API or Paystack dashboard performs an approved refund, and whether partial refunds revoke specific tickets.
- Payout review evidence, transfer method, adjustments policy, and minimum waiting period after event end if any.
- RSVP guest limit behavior, whether a shared RSVP link is open or invitation-only, and required contact fields.
- Whether separate event-scoped staff accounts and admin event creation are added by a written change request.
- Email sender/domain, retention of buyer data and ticket PDFs, and the client-approved privacy/event policy text.

## Official integration references

- [Paystack accept payments](https://paystack.com/docs/payments/accept-payments/)
- [Paystack verify payments](https://paystack.com/docs/payments/verify-payments/)
- [Paystack webhooks and signatures](https://paystack.com/docs/payments/webhooks/)
- [Paystack refunds](https://paystack.com/docs/payments/refunds/)
- [Better Auth database and schema](https://better-auth.com/docs/concepts/database)
- [Better Auth NestJS integration](https://better-auth.com/docs/integrations/nestjs)
- [Prisma transactions](https://www.prisma.io/docs/orm/fundamentals/transactions)
- [Cloudflare R2 S3 API](https://developers.cloudflare.com/r2/api/s3/)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)

Implementation should check the current official documentation for exact request/response fields and provider behavior when coding the integrations.
