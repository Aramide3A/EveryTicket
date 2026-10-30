ALTER TABLE "application_profile" ADD COLUMN "blockReason" TEXT, ADD COLUMN "blockedAt" TIMESTAMP(3);

CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actorProfileId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_log_targetType_targetId_createdAt_idx" ON "audit_log"("targetType", "targetId", "createdAt");
CREATE INDEX "audit_log_actorProfileId_createdAt_idx" ON "audit_log"("actorProfileId", "createdAt");
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorProfileId_fkey" FOREIGN KEY ("actorProfileId") REFERENCES "application_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
