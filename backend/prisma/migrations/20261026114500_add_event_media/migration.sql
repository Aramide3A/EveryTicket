CREATE TYPE "EventMediaStatus" AS ENUM ('PENDING', 'READY');

CREATE TABLE "event_media" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "publicUrl" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "contentLength" INTEGER NOT NULL,
  "status" "EventMediaStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "event_media_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "event_media_objectKey_key" ON "event_media"("objectKey");
CREATE INDEX "event_media_eventId_status_idx" ON "event_media"("eventId", "status");
CREATE INDEX "event_media_status_expiresAt_idx" ON "event_media"("status", "expiresAt");

ALTER TABLE "event_media" ADD CONSTRAINT "event_media_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
