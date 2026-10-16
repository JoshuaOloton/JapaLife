-- CreateTable
CREATE TABLE "BalanceFlag" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "reason" TEXT NOT NULL,
    "receivedInWindow" BIGINT NOT NULL,
    "ceiling" BIGINT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "dayKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BalanceFlag_createdAt_idx" ON "BalanceFlag"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BalanceFlag_playerId_currency_reason_dayKey_key" ON "BalanceFlag"("playerId", "currency", "reason", "dayKey");

-- AddForeignKey
ALTER TABLE "BalanceFlag" ADD CONSTRAINT "BalanceFlag_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
