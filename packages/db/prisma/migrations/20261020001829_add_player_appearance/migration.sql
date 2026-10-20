-- CreateTable
CREATE TABLE "PlayerAppearance" (
    "playerId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "skinTone" TEXT NOT NULL,
    "hair" TEXT NOT NULL,
    "hairColour" TEXT NOT NULL,
    "outfit" TEXT NOT NULL,
    "outfitColour" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerAppearance_pkey" PRIMARY KEY ("playerId")
);

-- AddForeignKey
ALTER TABLE "PlayerAppearance" ADD CONSTRAINT "PlayerAppearance_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
