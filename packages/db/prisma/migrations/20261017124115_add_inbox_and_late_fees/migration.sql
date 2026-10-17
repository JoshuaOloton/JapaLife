-- AlterTable
-- Existing players get their first late fee at the end of the grace period.
-- 3 days is content/economy/ngn.json's graceDays when this migration was written.
ALTER TABLE "PlayerState" ADD COLUMN     "lateFeeDueAt" TIMESTAMP(3);
UPDATE "PlayerState" SET "lateFeeDueAt" = "rentDueAt" + INTERVAL '3 days';
ALTER TABLE "PlayerState" ALTER COLUMN "lateFeeDueAt" SET NOT NULL;

-- CreateTable
CREATE TABLE "InboxMessage" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "InboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboxMessage_playerId_createdAt_idx" ON "InboxMessage"("playerId", "createdAt");

-- CreateIndex
CREATE INDEX "InboxMessage_playerId_readAt_idx" ON "InboxMessage"("playerId", "readAt");

-- CreateIndex
CREATE INDEX "PlayerState_lateFeeDueAt_idx" ON "PlayerState"("lateFeeDueAt");

-- AddForeignKey
ALTER TABLE "InboxMessage" ADD CONSTRAINT "InboxMessage_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
