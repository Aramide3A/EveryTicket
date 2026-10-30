-- CreateEnum
CREATE TYPE "GuestResponseStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "guest_list" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "maxResponses" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_category" (
    "id" TEXT NOT NULL,
    "guestListId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isRestricted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rsvp_link" (
    "id" TEXT NOT NULL,
    "guestListId" TEXT NOT NULL,
    "tokenDigest" TEXT NOT NULL,
    "categoryId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "maxResponses" INTEGER,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rsvp_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest" (
    "id" TEXT NOT NULL,
    "guestListId" TEXT NOT NULL,
    "rsvpLinkId" TEXT,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "responseStatus" "GuestResponseStatus" NOT NULL DEFAULT 'PENDING',
    "credentialStatus" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "admissionTokenDigest" TEXT,
    "idempotencyKey" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_in" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ticketId" TEXT,
    "guestId" TEXT,
    "checkedInByProfileId" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "check_in_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "check_in"
  ADD CONSTRAINT "check_in_has_exactly_one_credential"
  CHECK (num_nonnulls("ticketId", "guestId") = 1);

-- CreateIndex
CREATE INDEX "guest_list_eventId_isEnabled_idx" ON "guest_list"("eventId", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "guest_category_guestListId_name_key" ON "guest_category"("guestListId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "rsvp_link_tokenDigest_key" ON "rsvp_link"("tokenDigest");

-- CreateIndex
CREATE INDEX "rsvp_link_guestListId_idx" ON "rsvp_link"("guestListId");

-- CreateIndex
CREATE UNIQUE INDEX "guest_admissionTokenDigest_key" ON "guest"("admissionTokenDigest");

-- CreateIndex
CREATE UNIQUE INDEX "guest_idempotencyKey_key" ON "guest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "guest_guestListId_responseStatus_idx" ON "guest"("guestListId", "responseStatus");

-- CreateIndex
CREATE UNIQUE INDEX "check_in_ticketId_key" ON "check_in"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "check_in_guestId_key" ON "check_in"("guestId");

-- CreateIndex
CREATE INDEX "check_in_eventId_checkedInAt_idx" ON "check_in"("eventId", "checkedInAt");

-- AddForeignKey
ALTER TABLE "guest_list" ADD CONSTRAINT "guest_list_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_category" ADD CONSTRAINT "guest_category_guestListId_fkey" FOREIGN KEY ("guestListId") REFERENCES "guest_list"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rsvp_link" ADD CONSTRAINT "rsvp_link_guestListId_fkey" FOREIGN KEY ("guestListId") REFERENCES "guest_list"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rsvp_link" ADD CONSTRAINT "rsvp_link_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "guest_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest" ADD CONSTRAINT "guest_guestListId_fkey" FOREIGN KEY ("guestListId") REFERENCES "guest_list"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest" ADD CONSTRAINT "guest_rsvpLinkId_fkey" FOREIGN KEY ("rsvpLinkId") REFERENCES "rsvp_link"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest" ADD CONSTRAINT "guest_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "guest_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_in" ADD CONSTRAINT "check_in_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_in" ADD CONSTRAINT "check_in_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_in" ADD CONSTRAINT "check_in_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_in" ADD CONSTRAINT "check_in_checkedInByProfileId_fkey" FOREIGN KEY ("checkedInByProfileId") REFERENCES "application_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
