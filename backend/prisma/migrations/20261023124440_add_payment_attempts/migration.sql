-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('INITIALIZED', 'VERIFIED_SUCCESS', 'VERIFIED_FAILED');

-- CreateTable
CREATE TABLE "payment_attempt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "expectedAmountKobo" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "gatewayTransactionId" TEXT,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'INITIALIZED',
    "failureDetail" TEXT,
    "initializedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempt_reference_key" ON "payment_attempt"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempt_gatewayTransactionId_key" ON "payment_attempt"("gatewayTransactionId");

-- CreateIndex
CREATE INDEX "payment_attempt_orderId_status_idx" ON "payment_attempt"("orderId", "status");

-- AddForeignKey
ALTER TABLE "payment_attempt" ADD CONSTRAINT "payment_attempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
