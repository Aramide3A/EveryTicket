-- CreateEnum
CREATE TYPE "TicketDocumentStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "ticket_document_job" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "status" "TicketDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "failureDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_document_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_document_job_ticketId_key" ON "ticket_document_job"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_document_job_objectKey_key" ON "ticket_document_job"("objectKey");

-- CreateIndex
CREATE INDEX "ticket_document_job_status_createdAt_idx" ON "ticket_document_job"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ticket_document_job" ADD CONSTRAINT "ticket_document_job_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
