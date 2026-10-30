ALTER TABLE "application_profile" ADD COLUMN "blockedByProfileId" TEXT;

CREATE INDEX "application_profile_blockedByProfileId_idx" ON "application_profile"("blockedByProfileId");

ALTER TABLE "application_profile"
  ADD CONSTRAINT "application_profile_blockedByProfileId_fkey"
  FOREIGN KEY ("blockedByProfileId") REFERENCES "application_profile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
