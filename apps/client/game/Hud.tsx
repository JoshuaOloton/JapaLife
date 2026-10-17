"use client";

import { COPY, fill, type EventAnswer } from "@japalife/shared";
import { useEffect, useState } from "react";
import { EventCard } from "./EventCard";
import { formatCountdown, formatGameClock, formatNaira } from "./format";
import styles from "./hud.module.css";
import type { ServerStats, Toast } from "./useGameMessages";

const hud = COPY.hud;

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
  onAnswer,
  onOpenInbox,
}: {
  server: ServerStats | null;
  now: number;
  toasts: Toast[];
  districtName: string;
  onAnswer: (choiceId: string, answer: EventAnswer) => void;
  onOpenInbox: () => void;
}) {
  const choice = server?.stats.pendingChoice;
  return (
    <div className={styles.hud}>
      {server ? (
        <Stats server={server} now={now} onOpenInbox={onOpenInbox} />
      ) : (
        <div className={styles.bar}>{districtName}</div>
      )}
      {server && choice && (
        <EventCard
          choice={choice}
          balanceKobo={server.stats.balanceKobo}
          statsAt={server.stats.serverTime}
          now={now}
          onAnswer={onAnswer}
        />
      )}
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

function Stats({ server, now, onOpenInbox }: { server: ServerStats; now: number; onOpenInbox: () => void }) {
  const { stats } = server;
  const rentLeft = Date.parse(stats.rentDueAt) - now;
  const rentClass =
    stats.rentStatus === "overdue" ? styles.rentOverdue : stats.rentStatus === "due" ? styles.rentDue : "";
  const rentText =
    stats.rentStatus === "overdue"
      ? hud.rentOverdue
      : stats.rentStatus === "due"
        ? fill(hud.rentDueNow, { time: formatCountdown(Date.parse(stats.rentLateFeeAt) - now) })
        : fill(hud.rentIn, { time: formatCountdown(rentLeft) });

  const chips: { key: string; text: string; warn?: boolean }[] = [];
  if (stats.activeShift) {
    chips.push({ key: "shift", text: fill(hud.atWork, { time: formatCountdown(Date.parse(stats.activeShift.endsAt) - now) }) });
  }
  const hours = stats.generatorFuelHours;
  if (stats.blackoutEndsAt) {
    const time = formatCountdown(Date.parse(stats.blackoutEndsAt) - now);
    if (!stats.isNight) chips.push({ key: "light", text: fill(hud.noLight, { time }), warn: true });
    else if (hours > 0) chips.push({ key: "light", text: fill(hud.generatorRunning, { hours }) });
    else chips.push({ key: "light", text: hud.noFuel, warn: true });
  } else if (hours > 0) {
    chips.push({ key: "fuel", text: fill(hud.generatorFuel, { hours }) });
  }
  if (stats.lowMorale) chips.push({ key: "morale", text: hud.lowMorale, warn: true });
  if (stats.foodPriceRisePercent > 0) {
    chips.push({ key: "food", text: fill(hud.foodPrices, { percent: stats.foodPriceRisePercent }) });
  }
  if (stats.fuelPriceRisePercent > 0) {
    chips.push({ key: "fuelPrice", text: fill(hud.fuelPrices, { percent: stats.fuelPriceRisePercent }) });
  }
  chips.push({ key: "shifts", text: fill(hud.shiftsToday, { done: stats.shiftsToday, max: stats.maxShiftsToday }) });

  const clock = formatGameClock(now, stats.startedOn, stats.timeZone);
  return (
    <>
      <div className={styles.bar}>
        <span className={styles.money} aria-label={hud.wallet}>
          {formatNaira(stats.balanceKobo)}
        </span>
        <span className={`${styles.rent} ${rentClass}`}>
          {rentText}
          <br />
          {formatNaira(stats.rentAmountKobo)}
        </span>
        <div className={styles.clockRow}>
          <span className={styles.clock}>{stats.isNight ? fill(hud.clockAtNight, { clock }) : clock}</span>
          <button
            type="button"
            className={styles.inboxButton}
            onClick={onOpenInbox}
            aria-label={stats.unreadInbox > 0 ? fill(hud.inboxUnread, { count: stats.unreadInbox }) : hud.inbox}
          >
            {hud.inbox}
            {stats.unreadInbox > 0 && (
              <span className={styles.badge} aria-hidden="true">
                {stats.unreadInbox}
              </span>
            )}
          </button>
        </div>
        <div className={styles.meters}>
          <Meter label={hud.hunger} value={stats.hunger} />
          <Meter label={hud.energy} value={stats.energy} />
          <Meter label={hud.morale} value={stats.morale} />
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
