"use client";

import { Client, type Room } from "@colyseus/sdk";
import {
  type AppearanceMessage,
  CHUNK_KEEP_RING,
  COPY,
  type ChunkContent,
  type ChunksMessage,
  DEFAULT_SERVER_PORT,
  DISTRICT_ROOM_NAME,
  type DistrictHeader,
  type DistrictLayout,
  type InboxMessage,
  type InteractionMessage,
  type NoticeMessage,
  type RejectedMessage,
  SERVER_MESSAGES,
  type StatsMessage,
  chunkKey,
  chunksMessageSchema,
  districtHeaderSchema,
  withinRing,
} from "@japalife/shared";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

/** The part of the server's synced state the client reads. Mirrors `DistrictState` on the server. */
export interface DistrictStateView {
  districtId: string;
  players: { get(sessionId: string): { x: number; z: number } | undefined };
}

export type DistrictRoom = Room<unknown, DistrictStateView>;

export type Connection =
  | { status: "connecting" }
  | { status: "failed"; message: string }
  | {
      status: "connected";
      room: DistrictRoom;
      header: DistrictHeader;
      /** The header as a layout, without chunks: stable for the whole visit (see `headerLayout`). */
      district: DistrictLayout;
      chunks: ChunkStore;
      messages: MessageBuffer;
    };

export type ServerEvent =
  | { type: "stats"; stats: StatsMessage; receivedAt: number }
  | { type: "notice"; notice: NoticeMessage }
  | { type: "rejected"; rejected: RejectedMessage }
  | { type: "interaction"; interaction: InteractionMessage }
  | { type: "inbox"; inbox: InboxMessage }
  | { type: "appearance"; appearance: AppearanceMessage };

/** More than a join could ever produce; a cap only so a stalled UI cannot grow it forever. */
const MAX_BUFFERED = 50;

/**
 * Receives the server's HUD messages from the moment the room is joined. The
 * server sends stats straight after the layout, before React has drawn the HUD,
 * and Colyseus drops messages nobody is listening for, so they wait here until
 * the HUD subscribes.
 */
export class MessageBuffer {
  private buffered: ServerEvent[] = [];
  private listener: ((event: ServerEvent) => void) | undefined;

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
    room.onMessage(SERVER_MESSAGES.inbox, (inbox: InboxMessage) => this.deliver({ type: "inbox", inbox }));
    room.onMessage(SERVER_MESSAGES.appearance, (appearance: AppearanceMessage) =>
      this.deliver({ type: "appearance", appearance }),
    );
  }

  /** One listener at a time (the HUD). Anything that arrived earlier is handed over first. */
  listen(listener: (event: ServerEvent) => void): () => void {
    this.listener = listener;
    const waiting = this.buffered;
    this.buffered = [];
    for (const event of waiting) listener(event);
    return () => {
      if (this.listener === listener) this.listener = undefined;
    };
  }

  private deliver(event: ServerEvent): void {
    if (this.listener) {
      this.listener(event);
      return;
    }
    this.buffered.push(event);
    if (this.buffered.length > MAX_BUFFERED) this.buffered.shift();
  }
}

/**
 * The district's chunks the client holds (area of interest): the server sends
 * the chunks around the player as they walk, and this keeps the ones within
 * `CHUNK_KEEP_RING` of the latest centre, the same rule the server uses to
 * know what to send again. Listening starts at join, like `MessageBuffer`, so
 * the first chunks (sent straight after the header) are never missed.
 */
export class ChunkStore {
  private readonly loaded = new Map<string, ChunkContent>();
  private readonly listeners = new Set<() => void>();
  /** Changes whenever the loaded chunks do, for React's `useSyncExternalStore`. */
  version = 0;

  constructor(room: DistrictRoom) {
    room.onMessage(SERVER_MESSAGES.chunks, (payload: unknown) => {
      const parsed = chunksMessageSchema.safeParse(payload);
      if (parsed.success) this.receive(parsed.data);
    });
  }

  receive({ centre, chunks }: ChunksMessage): void {
    for (const [key, chunk] of this.loaded) {
      if (!withinRing(chunk, centre, CHUNK_KEEP_RING)) this.loaded.delete(key);
    }
    for (const chunk of chunks) this.loaded.set(chunkKey(chunk), chunk);
    this.version++;
    for (const listener of this.listeners) listener();
  }

  chunks(): ChunkContent[] {
    return [...this.loaded.values()];
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

/**
 * The header as a layout with no buildings or props yet (the road furniture
 * aside). The traffic runs on this, so it never restarts as chunks come and go.
 */
export function headerLayout(header: DistrictHeader): DistrictLayout {
  const layout: DistrictLayout & Partial<Pick<DistrictHeader, "roadProps" | "buildingModels" | "mapBuildings">> = {
    ...header,
    buildings: [],
    props: header.roadProps,
  };
  // Header-only fields, not part of a layout.
  delete layout.roadProps;
  delete layout.buildingModels;
  delete layout.mapBuildings;
  return layout;
}

/** The district as far as the client holds it, updated as chunks come and go. */
export function useLoadedDistrict(base: DistrictLayout, store: ChunkStore): DistrictLayout {
  const version = useSyncExternalStore(store.subscribe, () => store.version, () => store.version);
  return useMemo(() => withChunks(base, store.chunks()), [base, store, version]);
}

/** The district as far as the client holds it: the header plus every loaded chunk's buildings and props. */
export function withChunks(base: DistrictLayout, chunks: readonly ChunkContent[]): DistrictLayout {
  return {
    ...base,
    buildings: chunks.flatMap((chunk) => chunk.buildings),
    props: [...base.props, ...chunks.flatMap((chunk) => chunk.props)],
  };
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
        const messages = new MessageBuffer(room as DistrictRoom);
        const chunks = new ChunkStore(room as DistrictRoom);
        room.onMessage(SERVER_MESSAGES.district, (payload: unknown) => {
          const parsed = districtHeaderSchema.safeParse(payload);
          if (cancelled) return;
          setConnection(
            parsed.success
              ? {
                  status: "connected",
                  room: room as DistrictRoom,
                  header: parsed.data,
                  district: headerLayout(parsed.data),
                  chunks,
                  messages,
                }
              : { status: "failed", message: COPY.app.badDistrict },
          );
        });
        room.onLeave(() => {
          if (!cancelled) setConnection({ status: "failed", message: COPY.app.connectionLost });
        });
      })
      .catch(() => {
        if (!cancelled) setConnection({ status: "failed", message: COPY.app.serverUnreachable });
      });

    return () => {
      cancelled = true;
      void joined?.leave();
    };
  }, []);

  return connection;
}
