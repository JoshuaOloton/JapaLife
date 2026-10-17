"use client";

import { COPY, fill, type InteractionMessage, type StatsMessage } from "@japalife/shared";
import { formatCountdown, formatNaira } from "./format";
import styles from "./hud.module.css";
import type { DistrictRoom } from "./connection";

const text = COPY.places;

/**
 * The sheet that opens at a place: the office's shift, the buka's menu, or your
 * room's rent. Buttons send intents only; the server decides what happens and
 * the HUD shows the result when its stats arrive.
 */
export function PlacePanel({
  interaction,
  label,
  stats,
  now,
  room,
  onClose,
}: {
  interaction: InteractionMessage;
  label: string;
  stats: StatsMessage | null;
  now: number;
  room: DistrictRoom;
  onClose: () => void;
}) {
  return (
    <section className={styles.sheet} aria-label={label}>
      <div className={styles.sheetHeader}>
        <h2>{label}</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label={COPY.hud.close}>
          ×
        </button>
      </div>
      <Body interaction={interaction} stats={stats} now={now} room={room} />
    </section>
  );
}

function Body({
  interaction,
  stats,
  now,
  room,
}: {
  interaction: InteractionMessage;
  stats: StatsMessage | null;
  now: number;
  room: DistrictRoom;
}) {
  switch (interaction.kind) {
    case "job_site": {
      const { job } = interaction;
      const working = stats?.activeShift?.jobId === job.jobId;
      return (
        <div className={styles.row}>
          <div>
            <strong>{job.name}</strong>
            <div className={styles.detail}>
              {fill(text.jobTerms, { pay: formatNaira(job.payKobo), minutes: job.shiftMinutes, energy: job.energyCost })}
            </div>
            {stats && (
              <div className={styles.detail}>
                {fill(text.jobShiftsToday, { done: stats.shiftsToday, max: stats.maxShiftsToday })}
              </div>
            )}
          </div>
          <button
            type="button"
            className={styles.action}
            disabled={working}
            onClick={() => room.send("work", { jobId: job.jobId })}
          >
            {working && stats?.activeShift
              ? formatCountdown(Date.parse(stats.activeShift.endsAt) - now)
              : text.startShift}
          </button>
        </div>
      );
    }
    case "food_vendor":
      return (
        <>
          {interaction.menu.map((item) => (
            <div key={item.itemId} className={styles.row}>
              <div>
                <strong>{item.name}</strong>
                <div className={styles.detail}>
                  {[
                    fill(text.foodHunger, { hunger: item.hungerRestored }),
                    ...(item.energyRestored > 0 ? [fill(text.foodEnergy, { energy: item.energyRestored })] : []),
                  ].join(" · ")}
                </div>
              </div>
              <button
                type="button"
                className={styles.action}
                onClick={() => room.send("buyFood", { itemId: item.itemId, quantity: 1 })}
              >
                {formatNaira(item.priceKobo)}
              </button>
            </div>
          ))}
        </>
      );
    case "home":
      return (
        <div className={styles.row}>
          <div>
            <strong>{text.rent}</strong>
            {stats && (
              <div className={styles.detail}>
                {stats.rentStatus === "ok"
                  ? fill(text.rentDueIn, {
                      amount: formatNaira(stats.rentAmountKobo),
                      time: formatCountdown(Date.parse(stats.rentDueAt) - now),
                    })
                  : fill(stats.rentStatus === "due" ? text.rentDueNow : text.rentOverdue, {
                      amount: formatNaira(stats.rentAmountKobo),
                    })}
              </div>
            )}
            {stats && stats.rentStatus !== "ok" && (
              <div className={styles.detail}>
                {fill(text.rentLateFee, {
                  fee: formatNaira(stats.rentLateFeeKobo),
                  time: formatCountdown(Date.parse(stats.rentLateFeeAt) - now),
                })}
              </div>
            )}
          </div>
          <button type="button" className={styles.action} onClick={() => room.send("payRent", {})}>
            {text.payRent}
          </button>
        </div>
      );
    case "bus_stop":
      return <p className={styles.detail}>{text.noBuses}</p>;
    case "fuel_station":
      return (
        <>
          {interaction.items.map((item) => (
            <div key={item.itemId} className={styles.row}>
              <div>
                <strong>{item.name}</strong>
                <div className={styles.detail}>
                  {[
                    fill(text.fuelRuns, { hours: item.generatorHours }),
                    ...(stats ? [fill(text.fuelInTank, { hours: stats.generatorFuelHours })] : []),
                  ].join(" · ")}
                </div>
              </div>
              <button
                type="button"
                className={styles.action}
                onClick={() => room.send("buyItem", { itemId: item.itemId, quantity: 1 })}
              >
                {formatNaira(item.priceKobo)}
              </button>
            </div>
          ))}
        </>
      );
  }
}
