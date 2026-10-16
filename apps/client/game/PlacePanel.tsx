"use client";

import type { InteractionMessage, StatsMessage } from "@japalife/shared";
import { formatCountdown, formatNaira } from "./format";
import styles from "./hud.module.css";
import type { DistrictRoom } from "./connection";

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
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
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
              {formatNaira(job.payKobo)} for {job.shiftMinutes} min · uses {job.energyCost} energy
            </div>
            {stats && (
              <div className={styles.detail}>
                Shifts today: {stats.shiftsToday} of {stats.maxShiftsToday}
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
              : "Start shift"}
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
                  +{item.hungerRestored} hunger{item.energyRestored > 0 ? ` · +${item.energyRestored} energy` : ""}
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
            <strong>Rent</strong>
            {stats && (
              <div className={styles.detail}>
                {formatNaira(stats.rentAmountKobo)} ·{" "}
                {stats.rentStatus === "ok"
                  ? `due in ${formatCountdown(Date.parse(stats.rentDueAt) - now)}`
                  : stats.rentStatus === "due"
                    ? "due now"
                    : "overdue"}
              </div>
            )}
          </div>
          <button type="button" className={styles.action} onClick={() => room.send("payRent", {})}>
            Pay rent
          </button>
        </div>
      );
    case "bus_stop":
      return <p className={styles.detail}>No buses yet. Danfos are coming in a later update.</p>;
    case "fuel_station":
      return (
        <>
          {interaction.items.map((item) => (
            <div key={item.itemId} className={styles.row}>
              <div>
                <strong>{item.name}</strong>
                <div className={styles.detail}>
                  Runs your generator {item.generatorHours}h when NEPA takes light at night
                  {stats ? ` · in your jerrycan: ${stats.generatorFuelHours}h` : ""}
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
