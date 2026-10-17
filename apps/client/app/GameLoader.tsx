"use client";

import { COPY } from "@japalife/shared/copy";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Welcome } from "./Welcome";

const loadGame = () => import("../game/Game");

/**
 * The 3D game is split into its own download and never rendered on the server
 * (WebGL needs a browser). The page shell paints first; three.js follows.
 */
const Game = dynamic(loadGame, {
  ssr: false,
  loading: () => <p style={{ padding: 16, font: "600 16px system-ui, sans-serif" }}>{COPY.app.loading}</p>,
});

const AGE_CONFIRMED_KEY = "japalife.ageConfirmed";

export function GameLoader() {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    // Start downloading the game while the player reads the welcome screen.
    void loadGame();
    try {
      if (window.localStorage.getItem(AGE_CONFIRMED_KEY) === "yes") setEntered(true);
    } catch {
      // Storage blocked (private mode): show the welcome screen every visit.
    }
  }, []);

  if (entered) return <Game />;
  return (
    <Welcome
      onEnter={() => {
        try {
          window.localStorage.setItem(AGE_CONFIRMED_KEY, "yes");
        } catch {
          // Not remembered this time; the game still starts.
        }
        setEntered(true);
      }}
    />
  );
}
