CREATE TYPE "RefundRequestStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PROCESSING', 'PROCESSED', 'FAILED', 'CANCELLED');

CREATE TYPE "PayoutRequestStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED');

CREATE TABLE "refund_request" (
    "id" TEXT NOT NULL,
    "organizerProfileId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "ticketRefundKobo" INTEGER NOT NULL,
    "platformFeeRefundKobo" INTEGER NOT NULL,
    "totalRefundKobo" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedByProfileId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "gatewayRefundReference" TEXT,
    "gatewayStatus" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "refund_request_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "refund_request_ticket" (
    "refundRequestId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    CONSTRAINT "refund_request_ticket_pkey" PRIMARY KEY ("refundRequestId", "ticketId")
);

CREATE TABLE "payout_request" (
    "id" TEXT NOT NULL,
    "organizerProfileId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ticketSubtotalKobo" INTEGER NOT NULL,
    "reservedRefundKobo" INTEGER NOT NULL,
    "priorPaidKobo" INTEGER NOT NULL,
    "requestedAmountKobo" INTEGER NOT NULL,
    "calculatedPayableKobo" INTEGER NOT NULL,
    "status" "PayoutRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedByProfileId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "transferReference" TEXT,
    "transferDate" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payout_request_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "refund_request_organizerProfileId_requestedAt_idx" ON "refund_request"("organizerProfileId", "requestedAt");
CREATE INDEX "refund_request_eventId_status_idx" ON "refund_request"("eventId", "status");
CREATE INDEX "refund_request_orderId_status_idx" ON "refund_request"("orderId", "status");
CREATE INDEX "refund_request_ticket_ticketId_idx" ON "refund_request_ticket"("ticketId");
CREATE INDEX "payout_request_organizerProfileId_requestedAt_idx" ON "payout_request"("organizerProfileId", "requestedAt");
CREATE INDEX "payout_request_eventId_status_idx" ON "payout_request"("eventId", "status");

ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_organizerProfileId_fkey" FOREIGN KEY ("organizerProfileId") REFERENCES "application_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_reviewedByProfileId_fkey" FOREIGN KEY ("reviewedByProfileId") REFERENCES "application_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_request_ticket" ADD CONSTRAINT "refund_request_ticket_refundRequestId_fkey" FOREIGN KEY ("refundRequestId") REFERENCES "refund_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_request_ticket" ADD CONSTRAINT "refund_request_ticket_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payout_request" ADD CONSTRAINT "payout_request_organizerProfileId_fkey" FOREIGN KEY ("organizerProfileId") REFERENCES "application_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payout_request" ADD CONSTRAINT "payout_request_reviewedByProfileId_fkey" FOREIGN KEY ("reviewedByProfileId") REFERENCES "application_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payout_request" ADD CONSTRAINT "payout_request_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
