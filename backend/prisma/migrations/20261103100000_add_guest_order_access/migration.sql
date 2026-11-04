ALTER TABLE "order" ADD COLUMN "guestAccessTokenDigest" TEXT;

CREATE UNIQUE INDEX "order_guestAccessTokenDigest_key" ON "order"("guestAccessTokenDigest");
