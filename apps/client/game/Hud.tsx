"use client";

import { useEffect, useState } from "react";
import { formatCountdown, formatGameClock, formatNaira } from "./format";
import styles from "./hud.module.css";
import type { ServerStats, Toast } from "./useGameMessages";

/**
 * The always-visible numbers: money, hunger, energy, rent, and anything running
 * (a shift, a power cut, a price rise). Everything comes from the server's stats;
 * the HUD only counts down between updates using the server's clock.
 */
export function Hud({
  server,
  now,
  toasts,
  districtName,
}: {
  server: ServerStats | null;
  now: number;
  toasts: Toast[];
  districtName: string;
}) {
  return (
    <div className={styles.hud}>
      {server ? <Stats server={server} now={now} /> : <div className={styles.bar}>{districtName}</div>}
      <div className={styles.toasts} aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={[
              styles.toast,
              toast.tone === "good" ? styles.toastGood : "",
              toast.tone === "refused" ? styles.toastRefused : "",
            ].join(" ")}
          >
            {toast.title && <strong>{toast.title}</strong>}
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function Stats({ server, now }: { server: ServerStats; now: number }) {
  const { stats } = server;
  const rentLeft = Date.parse(stats.rentDueAt) - now;
  const rentClass =
    stats.rentStatus === "overdue" ? styles.rentOverdue : stats.rentStatus === "due" ? styles.rentDue : "";
  const rentText =
    stats.rentStatus === "overdue"
      ? "Rent overdue!"
      : stats.rentStatus === "due"
        ? "Rent due now"
        : `Rent in ${formatCountdown(rentLeft)}`;

  const chips: { key: string; text: string; warn?: boolean }[] = [];
  if (stats.activeShift) {
    chips.push({ key: "shift", text: `At work · ${formatCountdown(Date.parse(stats.activeShift.endsAt) - now)} left` });
  }
  const fuel = `${stats.generatorFuelHours}h fuel`;
  if (stats.blackoutEndsAt) {
    const left = formatCountdown(Date.parse(stats.blackoutEndsAt) - now);
    if (!stats.isNight) chips.push({ key: "light", text: `No light · ${left}`, warn: true });
    else if (stats.generatorFuelHours > 0) chips.push({ key: "light", text: `No light · gen on · ${fuel}` });
    else chips.push({ key: "light", text: `No light · no fuel, sleeping badly`, warn: true });
  } else if (stats.generatorFuelHours > 0) {
    chips.push({ key: "fuel", text: `Gen · ${fuel}` });
  }
  if (stats.lowMorale) chips.push({ key: "morale", text: "Low morale · resting slower, earning less", warn: true });
  if (stats.foodPriceRisePercent > 0) chips.push({ key: "food", text: `Food prices +${stats.foodPriceRisePercent}%` });
  if (stats.fuelPriceRisePercent > 0) chips.push({ key: "fuelPrice", text: `Fuel prices +${stats.fuelPriceRisePercent}%` });
  chips.push({ key: "shifts", text: `Shifts today ${stats.shiftsToday}/${stats.maxShiftsToday}` });

  return (
    <>
      <div className={styles.bar}>
        <span className={styles.money} aria-label="Wallet">
          {formatNaira(stats.balanceKobo)}
        </span>
        <span className={`${styles.rent} ${rentClass}`}>
          {rentText}
          <br />
          {formatNaira(stats.rentAmountKobo)}
        </span>
        <span className={styles.clock}>
          {formatGameClock(now, stats.startedOn, stats.timeZone)}
          {stats.isNight ? " · night" : ""}
        </span>
        <div className={styles.meters}>
          <Meter label="Hunger" value={stats.hunger} />
          <Meter label="Energy" value={stats.energy} />
          <Meter label="Morale" value={stats.morale} />
        </div>
      </div>
      <div className={styles.chips}>
        {chips.map((chip) => (
          <span key={chip.key} className={`${styles.chip} ${chip.warn ? styles.chipWarn : ""}`}>
            {chip.text}
          </span>
        ))}
      </div>
    </>
  );
}

/** A 0-100 bar. Hunger is fullness, so both meters are good when full and turn red when low. */
function Meter({ label, value }: { label: string; value: number }) {
  const colour = value <= 20 ? "#ff7b6b" : value <= 45 ? "#ffd166" : "#6fcf97";
  return (
    <div className={styles.meter}>
      <span>
        {label} {value}
      </span>
      <div className={styles.track} role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
        <div className={styles.fill} style={{ width: `${value}%`, background: colour }} />
      </div>
    </div>
  );
}

/** Server time, refreshed once a second so countdowns tick. Use it below the Canvas, never above it. */
export function useTicker(server: ServerStats | null): number {
  const [now, setNow] = useState(() => server?.serverNow() ?? 0);
  useEffect(() => {
    if (!server) return;
    setNow(server.serverNow());
    const timer = window.setInterval(() => setNow(server.serverNow()), 1000);
    return () => window.clearInterval(timer);
  }, [server]);
  return now;
}
