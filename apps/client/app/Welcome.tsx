"use client";

import { COPY } from "@japalife/shared/copy";
import { Fragment, useState } from "react";
import styles from "./welcome.module.css";

const text = COPY.welcome;

/**
 * 18+ GATE STUB and the disclaimer. Players must be 18 or older (CLAUDE.md).
 * This is a self-declaration remembered in this browser only: no date of birth
 * is asked for or stored, and nothing is sent to the server. The real gate comes
 * with sign-up, which needs the owner's approval (auth and player data).
 */
export function Welcome({ onEnter }: { onEnter: () => void }) {
  const [underage, setUnderage] = useState(false);

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{text.title}</h1>
        <p className={styles.lead}>{text.lead}</p>

        <section className={styles.disclaimer} aria-labelledby="disclaimer-heading">
          <h2 id="disclaimer-heading">{text.disclaimerHeading}</h2>
          {text.disclaimer.map((paragraph) => (
            <p key={paragraph}>
              <WithBold text={paragraph} />
            </p>
          ))}
        </section>

        {underage ? (
          <p className={styles.underage} role="alert">
            {text.underage}
          </p>
        ) : (
          <>
            <p className={styles.question}>{text.ageQuestion}</p>
            <div className={styles.buttons}>
              <button type="button" className={styles.primary} onClick={onEnter}>
                {text.ageYes}
              </button>
              <button type="button" className={styles.secondary} onClick={() => setUnderage(true)}>
                {text.ageNo}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

/** Shows `**text**` in bold. Plain text otherwise: copy never carries HTML. */
function WithBold({ text: line }: { text: string }) {
  return line.split(/\*\*(.+?)\*\*/).map((part, index) =>
    index % 2 === 1 ? <strong key={index}>{part}</strong> : <Fragment key={index}>{part}</Fragment>,
  );
}
