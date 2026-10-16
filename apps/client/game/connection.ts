"use client";

import { Client, type Room } from "@colyseus/sdk";
import {
  DEFAULT_SERVER_PORT,
  DISTRICT_ROOM_NAME,
  type DistrictConfig,
  type InteractionMessage,
  type NoticeMessage,
  type RejectedMessage,
  SERVER_MESSAGES,
  type StatsMessage,
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
  | { status: "connected"; room: DistrictRoom; district: DistrictConfig; inbox: ServerInbox };

export type InboxEvent =
  | { type: "stats"; stats: StatsMessage; receivedAt: number }
  | { type: "notice"; notice: NoticeMessage }
  | { type: "rejected"; rejected: RejectedMessage }
  | { type: "interaction"; interaction: InteractionMessage };

/** More than a join could ever produce; a cap only so a stalled UI cannot grow it forever. */
const MAX_BUFFERED = 50;

/**
 * Receives the server's HUD messages from the moment the room is joined. The
 * server sends stats straight after the layout, before React has drawn the HUD,
 * and Colyseus drops messages nobody is listening for, so they wait here until
 * the HUD subscribes.
 */
export class ServerInbox {
  private buffered: InboxEvent[] = [];
  private listener: ((event: InboxEvent) => void) | undefined;

  constructor(room: DistrictRoom) {
    room.onMessage(SERVER_MESSAGES.stats, (stats: StatsMessage) =>
      this.deliver({ type: "stats", stats, receivedAt: performance.now() }),
    );
    room.onMessage(SERVER_MESSAGES.notice, (notice: NoticeMessage) => this.deliver({ type: "notice", notice }));
    room.onMessage(SERVER_MESSAGES.rejected, (rejected: RejectedMessage) =>
      this.deliver({ type: "rejected", rejected }),
    );
    room.onMessage(SERVER_MESSAGES.interaction, (interaction: InteractionMessage) =>
      this.deliver({ type: "interaction", interaction }),
    );
  }

  /** One listener at a time (the HUD). Anything that arrived earlier is handed over first. */
  listen(listener: (event: InboxEvent) => void): () => void {
    this.listener = listener;
    const waiting = this.buffered;
    this.buffered = [];
    for (const event of waiting) listener(event);
    return () => {
      if (this.listener === listener) this.listener = undefined;
    };
  }

  private deliver(event: InboxEvent): void {
    if (this.listener) {
      this.listener(event);
      return;
    }
    this.buffered.push(event);
    if (this.buffered.length > MAX_BUFFERED) this.buffered.shift();
  }
}

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
    const created = randomDevPlayerId();
    window.localStorage.setItem(DEV_PLAYER_KEY, created);
    return created;
  } catch {
    // Storage can be blocked (private mode); a fresh id per visit still works.
    return randomDevPlayerId();
  }
}

/**
 * Not `crypto.randomUUID()`: browsers only offer it on secure pages (https or
 * localhost), so it is missing when a phone opens http://<lan-ip>:3000.
 * `getRandomValues` works everywhere.
 */
function randomDevPlayerId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `dev-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
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
        const inbox = new ServerInbox(room as DistrictRoom);
        room.onMessage(SERVER_MESSAGES.district, (payload: unknown) => {
          const parsed = districtSchema.safeParse(payload);
          if (cancelled) return;
          setConnection(
            parsed.success
              ? { status: "connected", room: room as DistrictRoom, district: parsed.data, inbox }
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
