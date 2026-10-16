"use client";

import dynamic from "next/dynamic";

/**
 * The 3D game is split into its own download and never rendered on the server
 * (WebGL needs a browser). The page shell paints first; three.js follows.
 */
const Game = dynamic(() => import("../game/Game"), {
  ssr: false,
  loading: () => <p style={{ padding: 16, font: "600 16px system-ui, sans-serif" }}>Loading Yaba...</p>,
});

export function GameLoader() {
  return <Game />;
}
