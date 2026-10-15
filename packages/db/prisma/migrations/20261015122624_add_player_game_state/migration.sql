-- CreateTable
CREATE TABLE "PlayerState" (
    "playerId" TEXT NOT NULL,
    "hunger" DOUBLE PRECISION NOT NULL,
    "energy" DOUBLE PRECISION NOT NULL,
    "statsAt" TIMESTAMP(3) NOT NULL,
    "rentDueAt" TIMESTAMP(3) NOT NULL,
    "eventsCheckedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerState_pkey" PRIMARY KEY ("playerId")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "dayKey" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventFiring" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "amountKobo" BIGINT,

    CONSTRAINT "EventFiring_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shift_playerId_dayKey_idx" ON "Shift"("playerId", "dayKey");

-- CreateIndex
CREATE INDEX "Shift_paidAt_endsAt_idx" ON "Shift"("paidAt", "endsAt");

-- CreateIndex
CREATE INDEX "EventFiring_playerId_eventId_firedAt_idx" ON "EventFiring"("playerId", "eventId", "firedAt");

-- CreateIndex
CREATE INDEX "EventFiring_playerId_endsAt_idx" ON "EventFiring"("playerId", "endsAt");

-- AddForeignKey
ALTER TABLE "PlayerState" ADD CONSTRAINT "PlayerState_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventFiring" ADD CONSTRAINT "EventFiring_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
