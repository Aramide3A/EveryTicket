-- CreateTable
CREATE TABLE "ticket_type" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceKobo" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "salesStartAt" TIMESTAMP(3),
    "salesEndAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "maxPerOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_type_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_type_eventId_isActive_idx" ON "ticket_type"("eventId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_type_eventId_name_key" ON "ticket_type"("eventId", "name");

-- AddForeignKey
ALTER TABLE "ticket_type" ADD CONSTRAINT "ticket_type_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
