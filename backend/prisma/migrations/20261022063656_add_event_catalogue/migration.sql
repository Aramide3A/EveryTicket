-- CreateEnum
CREATE TYPE "EventState" AS ENUM ('DRAFT', 'PUBLISHED', 'SUSPENDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "event_category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event" (
    "id" TEXT NOT NULL,
    "organizerProfileId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "EventState" NOT NULL DEFAULT 'DRAFT',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_category_name_key" ON "event_category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "event_category_slug_key" ON "event_category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "event_slug_key" ON "event"("slug");

-- CreateIndex
CREATE INDEX "event_organizerProfileId_status_idx" ON "event"("organizerProfileId", "status");

-- CreateIndex
CREATE INDEX "event_startAt_idx" ON "event"("startAt");

-- CreateIndex
CREATE INDEX "event_city_state_idx" ON "event"("city", "state");

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_organizerProfileId_fkey" FOREIGN KEY ("organizerProfileId") REFERENCES "application_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "event_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
