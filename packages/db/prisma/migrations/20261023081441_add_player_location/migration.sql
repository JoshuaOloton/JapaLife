-- CreateTable
CREATE TABLE "PlayerLocation" (
    "playerId" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerLocation_pkey" PRIMARY KEY ("playerId")
);

-- AddForeignKey
ALTER TABLE "PlayerLocation" ADD CONSTRAINT "PlayerLocation_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
