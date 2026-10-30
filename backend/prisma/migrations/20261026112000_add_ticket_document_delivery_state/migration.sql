ALTER TYPE "TicketDocumentStatus" ADD VALUE 'PROCESSING';

ALTER TABLE "ticket_document_job"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

CREATE INDEX "ticket_document_job_status_nextAttemptAt_idx"
  ON "ticket_document_job"("status", "nextAttemptAt");
