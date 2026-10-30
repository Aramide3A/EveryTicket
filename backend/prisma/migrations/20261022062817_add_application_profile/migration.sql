-- CreateEnum
CREATE TYPE "ApplicationRole" AS ENUM ('CUSTOMER', 'ORGANIZER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateTable
CREATE TABLE "application_profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ApplicationRole" NOT NULL DEFAULT 'CUSTOMER',
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_profile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "application_profile_userId_key" ON "application_profile"("userId");

-- AddForeignKey
ALTER TABLE "application_profile" ADD CONSTRAINT "application_profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
