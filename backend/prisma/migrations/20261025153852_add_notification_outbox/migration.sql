-- CreateEnum
CREATE TYPE "NotificationJobStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationJobType" AS ENUM ('ORDER_CONFIRMATION', 'RSVP_CONFIRMATION');

-- CreateTable
CREATE TABLE "notification_job" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "type" "NotificationJobType" NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "NotificationJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failureDetail" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_job_idempotencyKey_key" ON "notification_job"("idempotencyKey");

-- CreateIndex
CREATE INDEX "notification_job_status_createdAt_idx" ON "notification_job"("status", "createdAt");

-- CreateIndex
CREATE INDEX "notification_job_orderId_idx" ON "notification_job"("orderId");

-- AddForeignKey
ALTER TABLE "notification_job" ADD CONSTRAINT "notification_job_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
