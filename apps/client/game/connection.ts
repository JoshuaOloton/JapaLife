"use client";

import { Client, type Room } from "@colyseus/sdk";
import {
  DEFAULT_SERVER_PORT,
  DISTRICT_ROOM_NAME,
  type DistrictConfig,
  SERVER_MESSAGES,
  districtSchema,
} from "@japalife/shared";
import { useEffect, useState } from "react";

/** The part of the server's synced state the client reads. Mirrors `DistrictState` on the server. */
export interface DistrictStateView {
  districtId: string;
  players: { get(sessionId: string): { x: number; z: number } | undefined };
}

export type DistrictRoom = Room<unknown, DistrictStateView>;

export type Connection =
  | { status: "connecting" }
  | { status: "failed"; message: string }
  | { status: "connected"; room: DistrictRoom; district: DistrictConfig };

function serverUrl(): string {
  // Default to the page's own host so a phone on the LAN reaches the dev server too.
  return (
    process.env["NEXT_PUBLIC_SERVER_URL"] ??
    `ws://${window.location.hostname}:${DEFAULT_SERVER_PORT}`
  );
}

const DEV_PLAYER_KEY = "japalife.devPlayerId";

/**
 * DEV IDENTITY STUB, matching the server's: there is no sign-in yet, so the
 * client names itself. `?player=<id>` picks a name (handy for two tabs);
 * otherwise a random id is remembered in this browser.
 */
function devPlayerId(): string {
  const fromUrl = new URLSearchParams(window.location.search).get("player");
  if (fromUrl) return fromUrl;
  try {
    const saved = window.localStorage.getItem(DEV_PLAYER_KEY);
    if (saved) return saved;
    const created = `dev-${crypto.randomUUID().slice(0, 8)}`;
    window.localStorage.setItem(DEV_PLAYER_KEY, created);
    return created;
  } catch {
    // Storage can be blocked (private mode); a fresh id per visit still works.
    return `dev-${crypto.randomUUID().slice(0, 8)}`;
  }
}

/** Joins the district room and waits for its layout. Leaves when the component unmounts. */
export function useDistrictConnection(): Connection {
  const [connection, setConnection] = useState<Connection>({ status: "connecting" });

  useEffect(() => {
    let cancelled = false;
    let joined: DistrictRoom | undefined;

    new Client(serverUrl())
      .joinOrCreate<DistrictStateView>(DISTRICT_ROOM_NAME, { playerId: devPlayerId() })
      .then((room) => {
        joined = room as DistrictRoom;
        if (cancelled) {
          void room.leave();
          return;
        }
        room.onMessage(SERVER_MESSAGES.district, (payload: unknown) => {
          const parsed = districtSchema.safeParse(payload);
          if (cancelled) return;
          setConnection(
            parsed.success
              ? { status: "connected", room: room as DistrictRoom, district: parsed.data }
              : { status: "failed", message: "The server sent a district this client does not understand." },
          );
        });
        room.onLeave(() => {
          if (!cancelled) setConnection({ status: "failed", message: "Lost connection to the server." });
        });
      })
      .catch(() => {
        if (!cancelled) setConnection({ status: "failed", message: "Could not reach the JapaLife server." });
      });

    return () => {
      cancelled = true;
      void joined?.leave();
    };
  }, []);

  return connection;
}
