import { COPY } from "@japalife/shared/copy";
import { GameLoader } from "./GameLoader";

export default function Home() {
  return (
    <main>
      <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {COPY.app.title}
      </h1>
      <GameLoader />
    </main>
  );
}
