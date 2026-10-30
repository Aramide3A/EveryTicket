CREATE UNIQUE INDEX "inventory_hold_orderId_ticketTypeId_key"
ON "inventory_hold"("orderId", "ticketTypeId");
