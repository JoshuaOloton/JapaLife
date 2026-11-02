-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "viaAgent" BOOLEAN NOT NULL DEFAULT false,
    "feeKobo" BIGINT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "readyAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "warnAt" TIMESTAMP(3),
    "warnedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "activeKey" TEXT,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Document_activeKey_key" ON "Document"("activeKey");

-- CreateIndex
CREATE INDEX "Document_playerId_status_idx" ON "Document"("playerId", "status");

-- CreateIndex
CREATE INDEX "Document_status_readyAt_idx" ON "Document"("status", "readyAt");

-- CreateIndex
CREATE INDEX "Document_status_expiresAt_idx" ON "Document"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
