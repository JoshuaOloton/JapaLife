"use client";

import { useState } from "react";
import styles from "./welcome.module.css";

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
        <h1 className={styles.title}>JapaLife</h1>
        <p className={styles.lead}>Hustle in Lagos, sort your papers, japa, and build a life abroad.</p>

        <section className={styles.disclaimer} aria-labelledby="disclaimer-heading">
          <h2 id="disclaimer-heading">This is a game, not immigration advice</h2>
          <p>
            Fees, rules, waiting times and prices in JapaLife are simplified, can be out of date, and some are made up
            for gameplay. Never use them to plan a real move.
          </p>
          <p>
            For real decisions, use official sources only: <strong>gov.uk</strong> for the UK and{" "}
            <strong>canada.ca</strong> for Canada. Nobody can genuinely guarantee you a visa, so treat any
            agent who promises one as a scam.
          </p>
        </section>

        {underage ? (
          <p className={styles.underage} role="alert">
            Sorry, JapaLife is only for players aged 18 and over.
          </p>
        ) : (
          <>
            <p className={styles.question}>JapaLife is for players aged 18 and over. Are you 18 or older?</p>
            <div className={styles.buttons}>
              <button type="button" className={styles.primary} onClick={onEnter}>
                Yes, I'm 18 or older
              </button>
              <button type="button" className={styles.secondary} onClick={() => setUnderage(true)}>
                No
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
