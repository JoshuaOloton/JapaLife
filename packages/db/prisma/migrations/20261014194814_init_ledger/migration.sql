-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('NGN', 'GBP', 'CAD');

-- CreateEnum
CREATE TYPE "WalletKind" AS ENUM ('PLAYER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ConversionChannel" AS ENUM ('BANK', 'FINTECH', 'STREET');

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "kind" "WalletKind" NOT NULL,
    "currency" "Currency" NOT NULL,
    "playerId" TEXT,
    "systemKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" BIGSERIAL NOT NULL,
    "fromWalletId" TEXT NOT NULL,
    "toWalletId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromBalanceAfter" BIGINT NOT NULL,
    "toBalanceAfter" BIGINT NOT NULL,
    "conversionId" TEXT,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversion" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "channel" "ConversionChannel" NOT NULL,
    "fromCurrency" "Currency" NOT NULL,
    "toCurrency" "Currency" NOT NULL,
    "fromAmount" BIGINT NOT NULL,
    "toAmount" BIGINT NOT NULL,
    "midRateMicro" BIGINT NOT NULL,
    "spreadBps" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_playerId_currency_key" ON "Wallet"("playerId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_systemKey_currency_key" ON "Wallet"("systemKey", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_id_currency_key" ON "Wallet"("id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_reference_key" ON "Transaction"("reference");

-- CreateIndex
CREATE INDEX "Transaction_fromWalletId_id_idx" ON "Transaction"("fromWalletId", "id");

-- CreateIndex
CREATE INDEX "Transaction_toWalletId_id_idx" ON "Transaction"("toWalletId", "id");

-- CreateIndex
CREATE INDEX "Transaction_conversionId_idx" ON "Transaction"("conversionId");

-- CreateIndex
CREATE INDEX "Transaction_reason_createdAt_idx" ON "Transaction"("reason", "createdAt");

-- CreateIndex
CREATE INDEX "Conversion_playerId_createdAt_idx" ON "Conversion"("playerId", "createdAt");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_fromWalletId_currency_fkey" FOREIGN KEY ("fromWalletId", "currency") REFERENCES "Wallet"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_toWalletId_currency_fkey" FOREIGN KEY ("toWalletId", "currency") REFERENCES "Wallet"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_conversionId_fkey" FOREIGN KEY ("conversionId") REFERENCES "Conversion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written below: rules Prisma cannot express.

-- A movement is a positive amount within MAX_WALLET_BALANCE (10^15) between two different wallets.
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_amount_range_check"
    CHECK ("amount" > 0 AND "amount" <= 1000000000000000);
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_distinct_wallets_check"
    CHECK ("fromWalletId" <> "toWalletId");

-- Running balances stay inside the cap. (They may be negative only for SYSTEM wallets, which
-- the ledger service guarantees; PLAYER wallets are checked under the wallet lock.)
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_balance_range_check"
    CHECK (
        "fromBalanceAfter" >= -1000000000000000000 AND "fromBalanceAfter" <= 1000000000000000
        AND "toBalanceAfter" >= -1000000000000000000 AND "toBalanceAfter" <= 1000000000000000
    );

-- PLAYER wallets belong to a player and have no system key; SYSTEM wallets are the reverse.
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_shape_check"
    CHECK (
        ("kind" = 'PLAYER' AND "playerId" IS NOT NULL AND "systemKey" IS NULL)
        OR ("kind" = 'SYSTEM' AND "playerId" IS NULL AND "systemKey" IS NOT NULL)
    );

-- Conversions: real swap, positive amounts, sane rate and spread.
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_values_check"
    CHECK (
        "fromCurrency" <> "toCurrency"
        AND "fromAmount" > 0 AND "toAmount" > 0
        AND "midRateMicro" > 0
        AND "spreadBps" >= 0 AND "spreadBps" < 10000
    );

-- The ledger is append-only: no edits, no deletes. (TRUNCATE is not blocked, so tests can reset.)
CREATE FUNCTION "reject_ledger_mutation"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Transaction rows are immutable (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Transaction_immutable"
    BEFORE UPDATE OR DELETE ON "Transaction"
    FOR EACH ROW EXECUTE FUNCTION "reject_ledger_mutation"();
