-- CreateTable
CREATE TABLE "PlayerRide" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromStop" TEXT NOT NULL,
    "toStop" TEXT NOT NULL,
    "fareKobo" BIGINT NOT NULL,
    "path" JSONB NOT NULL,
    "speed" DOUBLE PRECISION NOT NULL,
    "boardingSeconds" DOUBLE PRECISION NOT NULL,
    "stopsAtMetres" DOUBLE PRECISION NOT NULL,
    "stoppedEarly" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "arrivesAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "activeKey" TEXT,

    CONSTRAINT "PlayerRide_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayerRide_activeKey_key" ON "PlayerRide"("activeKey");

-- CreateIndex
CREATE INDEX "PlayerRide_playerId_finishedAt_idx" ON "PlayerRide"("playerId", "finishedAt");

-- AddForeignKey
ALTER TABLE "PlayerRide" ADD CONSTRAINT "PlayerRide_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
