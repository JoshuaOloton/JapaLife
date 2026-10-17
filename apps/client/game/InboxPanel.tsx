"use client";

import { COPY, type InboxEntry, type StatsMessage } from "@japalife/shared";
import { formatGameClock } from "./format";
import styles from "./hud.module.css";

const text = COPY.inbox;

/**
 * What happened to the player, newest first: shift pay, events, family requests
 * and rent fees, including everything that happened while they were offline.
 * The server marked these read when it sent them.
 */
export function InboxPanel({
  messages,
  stats,
  onClose,
}: {
  messages: InboxEntry[];
  stats: StatsMessage | null;
  onClose: () => void;
}) {
  return (
    <section className={styles.sheet} aria-label={text.title}>
      <div className={styles.sheetHeader}>
        <h2>{text.title}</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label={COPY.hud.close}>
          ×
        </button>
      </div>
      {messages.length === 0 && <p className={styles.detail}>{text.empty}</p>}
      {messages.map((entry) => (
        <article key={entry.id} className={styles.inboxItem}>
          <strong>{entry.title}</strong>
          {entry.unread && <span className={styles.newTag}>{text.new}</span>}
          <p>{entry.message}</p>
          {stats && (
            <p className={styles.detail}>{formatGameClock(Date.parse(entry.at), stats.startedOn, stats.timeZone)}</p>
          )}
        </article>
      ))}
    </section>
  );
}
