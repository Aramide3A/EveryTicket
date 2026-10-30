-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "ticket" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "holderEmail" TEXT NOT NULL,
    "ticketTypeName" TEXT NOT NULL,
    "priceKobo" INTEGER NOT NULL,
    "admissionTokenDigest" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'ACTIVE',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_admissionTokenDigest_key" ON "ticket"("admissionTokenDigest");

-- CreateIndex
CREATE INDEX "ticket_orderId_idx" ON "ticket"("orderId");

-- CreateIndex
CREATE INDEX "ticket_eventId_status_idx" ON "ticket"("eventId", "status");

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "ticket_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
