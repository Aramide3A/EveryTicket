-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED', 'PAID_NEEDS_RESOLUTION');

-- CreateTable
CREATE TABLE "order" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "customerProfileId" TEXT,
    "buyerName" TEXT NOT NULL,
    "buyerEmail" TEXT NOT NULL,
    "buyerPhone" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "ticketSubtotalKobo" INTEGER NOT NULL,
    "platformFeeKobo" INTEGER NOT NULL,
    "totalKobo" INTEGER NOT NULL,
    "platformFeeRuleId" TEXT NOT NULL,
    "platformFeeRuleVersion" INTEGER NOT NULL,
    "platformFeeMode" "PlatformFeeMode" NOT NULL,
    "platformFeePercentageBasisPoints" INTEGER,
    "platformFeeFixedAmountKobo" INTEGER,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "holdExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_line" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,
    "ticketTypeName" TEXT NOT NULL,
    "unitPriceKobo" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_reference_key" ON "order"("reference");

-- CreateIndex
CREATE INDEX "order_eventId_status_idx" ON "order"("eventId", "status");

-- CreateIndex
CREATE INDEX "order_customerProfileId_createdAt_idx" ON "order"("customerProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "order_line_orderId_idx" ON "order_line"("orderId");

-- CreateIndex
CREATE INDEX "order_line_ticketTypeId_idx" ON "order_line"("ticketTypeId");

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "application_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_platformFeeRuleId_fkey" FOREIGN KEY ("platformFeeRuleId") REFERENCES "platform_fee_rule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "ticket_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
