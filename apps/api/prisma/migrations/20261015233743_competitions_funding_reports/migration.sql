-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- DropForeignKey
ALTER TABLE "CompetitionRegistration" DROP CONSTRAINT "CompetitionRegistration_competitionId_fkey";

-- AlterTable
ALTER TABLE "CompetitionRegistration" ADD COLUMN     "outcomeEvidenceUrl" TEXT,
ADD COLUMN     "outcomeVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "outcomeVerifiedById" UUID;

-- AlterTable
ALTER TABLE "GeneratedReport" ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "sizeBytes" INTEGER,
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FundingChangeRequest" (
    "id" UUID NOT NULL,
    "awardId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "proposed" JSONB NOT NULL,
    "previous" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FundingChangeRequest_status_createdAt_idx" ON "FundingChangeRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FundingChangeRequest_awardId_idx" ON "FundingChangeRequest"("awardId");

-- AddForeignKey
ALTER TABLE "CompetitionRegistration" ADD CONSTRAINT "CompetitionRegistration_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionRegistration" ADD CONSTRAINT "CompetitionRegistration_outcomeVerifiedById_fkey" FOREIGN KEY ("outcomeVerifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingChangeRequest" ADD CONSTRAINT "FundingChangeRequest_awardId_fkey" FOREIGN KEY ("awardId") REFERENCES "FundingAward"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingChangeRequest" ADD CONSTRAINT "FundingChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingChangeRequest" ADD CONSTRAINT "FundingChangeRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
