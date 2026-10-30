-- CreateEnum
CREATE TYPE "PlatformFeeMode" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateTable
CREATE TABLE "platform_fee_rule" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "mode" "PlatformFeeMode" NOT NULL,
    "percentageBasisPoints" INTEGER,
    "fixedAmountKobo" INTEGER,
    "appliesToFreeOrder" BOOLEAN NOT NULL DEFAULT false,
    "activeFrom" TIMESTAMP(3) NOT NULL,
    "activeUntil" TIMESTAMP(3),
    "changedByProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_fee_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_fee_rule_version_key" ON "platform_fee_rule"("version");

-- CreateIndex
CREATE INDEX "platform_fee_rule_activeFrom_activeUntil_idx" ON "platform_fee_rule"("activeFrom", "activeUntil");

-- AddForeignKey
ALTER TABLE "platform_fee_rule" ADD CONSTRAINT "platform_fee_rule_changedByProfileId_fkey" FOREIGN KEY ("changedByProfileId") REFERENCES "application_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
