-- CreateTable
CREATE TABLE "inventory_hold" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_hold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_hold_ticketTypeId_expiresAt_idx" ON "inventory_hold"("ticketTypeId", "expiresAt");

-- CreateIndex
CREATE INDEX "inventory_hold_orderId_idx" ON "inventory_hold"("orderId");

-- AddForeignKey
ALTER TABLE "inventory_hold" ADD CONSTRAINT "inventory_hold_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_hold" ADD CONSTRAINT "inventory_hold_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "ticket_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
