-- Morale, family relationship and generator fuel (Phase 1, Slice 7). Not money.
--
-- Existing players get the starting values from content/economy/needs.json as
-- of 2026-10-16 (morale 70, family 60, an empty tank). The defaults are dropped
-- straight after, so new players always take their values from content/.

-- AlterTable
ALTER TABLE "PlayerState" ADD COLUMN     "family" DOUBLE PRECISION NOT NULL DEFAULT 60,
ADD COLUMN     "generatorFuelHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "morale" DOUBLE PRECISION NOT NULL DEFAULT 70;

ALTER TABLE "PlayerState" ALTER COLUMN "family" DROP DEFAULT,
ALTER COLUMN "generatorFuelHours" DROP DEFAULT,
ALTER COLUMN "morale" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "payKobo" BIGINT;
