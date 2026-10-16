import { GameLoader } from "./GameLoader";

export default function Home() {
  return (
    <main>
      <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        JapaLife
      </h1>
      <GameLoader />
    </main>
  );
}
