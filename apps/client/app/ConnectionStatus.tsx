"use client";

import { Client } from "@colyseus/sdk";
import { DEFAULT_SERVER_PORT, DISTRICT_ROOM_NAME } from "@japalife/shared";
import { useEffect, useState } from "react";

type Status = "connecting" | "connected" | "failed";

function serverUrl(): string {
  // Default to the page's own host so a phone on the LAN reaches the dev server too.
  return (
    process.env["NEXT_PUBLIC_SERVER_URL"] ??
    `ws://${window.location.hostname}:${DEFAULT_SERVER_PORT}`
  );
}

export function ConnectionStatus() {
  const [status, setStatus] = useState<Status>("connecting");

  useEffect(() => {
    let cancelled = false;
    let leave: (() => Promise<unknown>) | undefined;

    new Client(serverUrl())
      .joinOrCreate(DISTRICT_ROOM_NAME)
      .then((room) => {
        if (cancelled) {
          void room.leave();
          return;
        }
        leave = () => room.leave();
        setStatus("connected");
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });

    return () => {
      cancelled = true;
      void leave?.();
    };
  }, []);

  if (status === "connected") return <p>Connected to JapaLife</p>;
  if (status === "failed") return <p>Could not reach the JapaLife server</p>;
  return <p>Connecting...</p>;
}
