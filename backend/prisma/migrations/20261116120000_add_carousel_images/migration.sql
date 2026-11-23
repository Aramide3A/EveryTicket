CREATE TYPE "CarouselImageStatus" AS ENUM ('PENDING', 'READY', 'DELETING');
CREATE TABLE "carousel_image" (
  "id" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "publicUrl" TEXT NOT NULL,
  "altText" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "contentLength" INTEGER NOT NULL,
  "status" "CarouselImageStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "carousel_image_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "carousel_image_alt_text" CHECK (length(btrim("altText")) BETWEEN 1 AND 300),
  CONSTRAINT "carousel_image_content_length" CHECK ("contentLength" BETWEEN 1 AND 5242880),
  CONSTRAINT "carousel_image_content_type" CHECK ("contentType" IN ('image/jpeg', 'image/png', 'image/webp'))
);
CREATE UNIQUE INDEX "carousel_image_objectKey_key" ON "carousel_image"("objectKey");
CREATE INDEX "carousel_image_status_createdAt_id_idx" ON "carousel_image"("status", "createdAt", "id");
CREATE INDEX "carousel_image_status_expiresAt_idx" ON "carousel_image"("status", "expiresAt");
