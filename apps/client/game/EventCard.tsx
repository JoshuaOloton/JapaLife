"use client";

import { COPY, fill, type EventAnswer, type PendingChoice } from "@japalife/shared";
import { useState } from "react";
import { formatCountdown, formatNaira } from "./format";
import styles from "./hud.module.css";

/**
 * A request waiting for the player's answer (family asking for money). The
 * buttons only send the answer; the server decides what it costs and does, and
 * the card goes away when the next stats arrive without it.
 */
export function EventCard({
  choice,
  balanceKobo,
  statsAt,
  now,
  onAnswer,
}: {
  choice: PendingChoice;
  balanceKobo: number;
  /** `serverTime` of the stats the card was drawn from. */
  statsAt: string;
  now: number;
  onAnswer: (choiceId: string, answer: EventAnswer) => void;
}) {
  // One answer per card: a double tap must not send twice (the server would refuse it anyway).
  // Fresh stats follow every answer; if the card is still there (the answer was refused), the buttons come back.
  const [sentFor, setSentFor] = useState<{ choiceId: string; statsAt: string } | null>(null);
  const sent = sentFor?.choiceId === choice.choiceId && sentFor.statsAt === statsAt;
  const canPay = balanceKobo >= choice.amountKobo;
  const send = (answer: EventAnswer): void => {
    setSentFor({ choiceId: choice.choiceId, statsAt });
    onAnswer(choice.choiceId, answer);
  };

  return (
    <section className={styles.card} aria-label={choice.title}>
      <strong>{choice.title}</strong>
      <p className={styles.cardText}>{choice.message}</p>
      <p className={styles.cardHint}>
        {canPay
          ? fill(COPY.eventCard.replyWithin, { time: formatCountdown(Date.parse(choice.expiresAt) - now) })
          : fill(COPY.eventCard.cannotAfford, { amount: formatNaira(choice.amountKobo) })}
      </p>
      <div className={styles.cardButtons}>
        <button type="button" className={styles.action} disabled={sent || !canPay} onClick={() => send("pay")}>
          {choice.payLabel}
        </button>
        <button type="button" className={styles.secondary} disabled={sent} onClick={() => send("decline")}>
          {choice.declineLabel}
        </button>
      </div>
    </section>
  );
}
