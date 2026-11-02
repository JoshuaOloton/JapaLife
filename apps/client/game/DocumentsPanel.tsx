"use client";

import { COPY, fill, type StatsMessage } from "@japalife/shared";
import { formatCountdown } from "./format";
import styles from "./hud.module.css";

const text = COPY.documents;

/**
 * The documents the player is waiting for or holds, with the time left on
 * each. Read from the server's stats, which the server sends again whenever
 * one changes; the countdowns follow the server's clock.
 */
export function DocumentsPanel({
  documents,
  now,
  onClose,
}: {
  documents: StatsMessage["documents"];
  now: number;
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
      {documents.length === 0 && <p className={styles.detail}>{text.empty}</p>}
      {documents.map((document) => (
        <article key={document.documentId} className={styles.inboxItem}>
          <strong>{document.name}</strong>
          <p className={styles.detail}>
            {document.status === "in_progress"
              ? fill(text.inProgress, { time: formatCountdown(Date.parse(document.readyAt) - now) })
              : document.expiresAt
                ? fill(text.validFor, { time: formatCountdown(Date.parse(document.expiresAt) - now) })
                : text.ready}
          </p>
        </article>
      ))}
    </section>
  );
}
