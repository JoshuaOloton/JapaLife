-- CreateTable
CREATE TABLE "EventChoice" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "firingId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "variant" INTEGER NOT NULL,
    "askedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "answer" TEXT,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "EventChoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventChoice_firingId_key" ON "EventChoice"("firingId");

-- CreateIndex
CREATE INDEX "EventChoice_playerId_answer_idx" ON "EventChoice"("playerId", "answer");

-- CreateIndex
CREATE INDEX "EventChoice_answer_expiresAt_idx" ON "EventChoice"("answer", "expiresAt");

-- AddForeignKey
ALTER TABLE "EventChoice" ADD CONSTRAINT "EventChoice_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventChoice" ADD CONSTRAINT "EventChoice_firingId_fkey" FOREIGN KEY ("firingId") REFERENCES "EventFiring"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
