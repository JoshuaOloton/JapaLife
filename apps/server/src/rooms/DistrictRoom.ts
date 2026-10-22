import { type Client, Room, ServerError } from "@colyseus/core";
import { StateView } from "@colyseus/schema";
import {
  type Appearance,
  type AppearanceMessage,
  type InboxMessage,
  type Intent,
  type Interactable,
  MAX_PLAYERS_PER_ROOM,
  PLAYER_SPEED_UNITS_PER_SECOND,
  PLAYER_VIEW_METRES,
  POSITION_UPDATE_HZ,
  type RejectReason,
  SERVER_MESSAGES,
  encodeAppearance,
  parseIntent,
} from "@japalife/shared";
import { z } from "zod";
import type { GameSystems } from "../game";
import { ChunkStream } from "../game/chunkStream";
import type { DistrictMap } from "../game/district";
import { logError } from "../log";
import { describeOffer } from "../game/offers";
import type { Outcome } from "../game/outcome";
import { TokenBucket } from "../game/tokenBucket";
import { DistrictState, PlayerPosition } from "./DistrictState";

const DEFAULT_DISTRICT_ID = "yaba";

/** How often a connected player's random events are checked, in real time. */
const EVENT_CHECK_INTERVAL_MS = 60_000;

/** Non-movement intents: bursts of 8, then 4 per second. Walking is not limited here. */
const INTENT_BUCKET_CAPACITY = 8;
const INTENT_BUCKET_REFILL_PER_SECOND = 4;

/** A long frame (a stalled server) must not teleport players across the map. */
const MAX_STEP_SECONDS = 0.25;

/**
 * DEV IDENTITY STUB. There is no sign-in yet (auth needs the owner's approval),
 * so a client names itself with `playerId`. This is only accepted outside
 * production; in production nobody can join until real auth replaces it.
 */
const joinOptionsSchema = z.object({
  playerId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
});

interface LivePlayer {
  playerId: string;
  x: number;
  z: number;
  dx: number;
  dz: number;
  lastMoveSeq: number;
  bucket: TokenBucket;
  unsubscribeNotices: () => void;
  /** Which chunks of the district this player has been sent. */
  chunks: ChunkStream;
}

/**
 * Builds the room class with the game systems it needs. Colyseus constructs
 * rooms itself, so the systems are captured in a closure rather than passed in.
 */
export function createDistrictRoom(game: GameSystems) {
  return class DistrictRoom extends Room {
    override maxClients = MAX_PLAYERS_PER_ROOM;
    override state = new DistrictState();

    private district!: DistrictMap;
    private readonly live = new Map<string, LivePlayer>();

    override onCreate(): void {
      const district = game.districts.get(DEFAULT_DISTRICT_ID);
      if (!district) throw new Error(`content has no district "${DEFAULT_DISTRICT_ID}"`);
      this.district = district;
      this.state.districtId = district.id;

      this.setSimulationInterval((deltaMs) => this.step(deltaMs), 1000 / POSITION_UPDATE_HZ);
      this.clock.setInterval(() => this.checkEventsForEveryone(), EVENT_CHECK_INTERVAL_MS);
      this.onMessage("*", (client, type, payload) => this.receive(client, String(type), payload));
    }

    override onAuth(_client: Client, options: unknown): { playerId: string } {
      if (process.env["NODE_ENV"] === "production") {
        throw new ServerError(401, "sign-in is not available yet");
      }
      const parsed = joinOptionsSchema.safeParse(options);
      if (!parsed.success) throw new ServerError(400, "invalid join options");
      const { playerId } = parsed.data;
      for (const other of this.live.values()) {
        if (other.playerId === playerId) throw new ServerError(409, "already connected");
      }
      return { playerId };
    }

    override async onJoin(client: Client, _options: unknown, auth: { playerId: string }): Promise<void> {
      const { playerId } = auth;
      const live: LivePlayer = {
        playerId,
        x: this.district.spawn.x,
        z: this.district.spawn.z,
        dx: 0,
        dz: 0,
        lastMoveSeq: -1,
        bucket: new TokenBucket(INTENT_BUCKET_CAPACITY, INTENT_BUCKET_REFILL_PER_SECOND, Date.now()),
        unsubscribeNotices: () => {},
        chunks: new ChunkStream(this.district.chunks),
      };

      // Catch up on whatever happened while the player was away, then show the HUD.
      // Not subscribed to toasts yet: what the catch-up finds was missed, so it
      // waits in the inbox as unread instead of flashing past as toasts.
      const appearance = await game.mutex.run(playerId, async () => {
        await game.players.ensurePlayer(playerId);
        await this.catchUp(playerId);
        return game.appearance.get(playerId);
      });

      live.unsubscribeNotices = game.notices.subscribe(playerId, (notice) => client.send(SERVER_MESSAGES.notice, notice));
      this.live.set(client.sessionId, live);
      const position = new PlayerPosition();
      position.x = live.x;
      position.z = live.z;
      this.state.players.set(client.sessionId, position);
      // Each client sees itself, and others only within range (`updateViews`).
      client.view = new StateView();
      client.view.add(position);
      this.updateViews();
      // The layout the client draws and predicts its walking from (one source of truth): the
      // header now, then the chunks around the player, more as they walk.
      client.send(SERVER_MESSAGES.district, this.district.header);
      this.sendChunks(client, live);
      // Null opens the character creator.
      this.showAppearance(client, appearance);
      await this.sendStats(client, live);
    }

    /** Tells the player their character, and puts its code in the synced state (for drawing other players, Phase 5). */
    private showAppearance(client: Client, appearance: Appearance | null): void {
      const message: AppearanceMessage = { appearance };
      client.send(SERVER_MESSAGES.appearance, message);
      const synced = this.state.players.get(client.sessionId);
      if (synced) synced.appearance = appearance ? encodeAppearance(appearance) : "";
    }

    override onLeave(client: Client): void {
      this.live.get(client.sessionId)?.unsubscribeNotices();
      this.live.delete(client.sessionId);
      const position = this.state.players.get(client.sessionId);
      if (position) {
        for (const other of this.clients) if (other.view?.has(position)) other.view.remove(position);
      }
      this.state.players.delete(client.sessionId);
    }

    /** Sends the player the chunks around them they do not have yet, if they walked into another chunk. */
    private sendChunks(client: Client, live: LivePlayer): void {
      const message = live.chunks.update(live);
      if (message) client.send(SERVER_MESSAGES.chunks, message);
    }

    /**
     * Area of interest for players: each client's view holds the players within
     * `PLAYER_VIEW_METRES` of it. At most 50 x 50 distance checks a tick, and the
     * view only changes when someone crosses the line.
     */
    private updateViews(): void {
      for (const client of this.clients) {
        const me = this.live.get(client.sessionId);
        const view = client.view;
        if (!me || !view) continue;
        for (const [sessionId, other] of this.live) {
          if (sessionId === client.sessionId) continue;
          const position = this.state.players.get(sessionId);
          if (!position) continue;
          const near = Math.hypot(other.x - me.x, other.z - me.z) <= PLAYER_VIEW_METRES;
          if (near && !view.has(position)) view.add(position);
          else if (!near && view.has(position)) view.remove(position);
        }
      }
    }

    // ---- intents ---------------------------------------------------------------

    private receive(client: Client, type: string, payload: unknown): void {
      const live = this.live.get(client.sessionId);
      if (!live) return; // not finished joining
      const parsed = parseIntent(type, payload);
      if (!parsed.ok) {
        this.reject(client, type, "invalid");
        return;
      }
      const { intent } = parsed;

      if (intent.type === "move") {
        // Only a direction is accepted; the server decides how far that moves the player.
        if (intent.payload.seq > live.lastMoveSeq) {
          live.lastMoveSeq = intent.payload.seq;
          live.dx = intent.payload.dx;
          live.dz = intent.payload.dz;
        }
        return;
      }

      // Wall-clock time on purpose: this limits request floods, it is not game time.
      if (!live.bucket.tryTake(Date.now())) {
        this.reject(client, type, "rate_limited");
        return;
      }
      game.mutex
        .run(live.playerId, () => this.execute(client, live, intent))
        .catch((error: unknown) => {
          // Never echo internals to the client, and never log money details.
          logError(`intent ${type.slice(0, 32)} failed`, error);
          this.reject(client, type, "invalid");
        });
    }

    private async execute(client: Client, live: LivePlayer, intent: Intent): Promise<void> {
      const now = game.clock.now();
      const position = { x: live.x, z: live.z };
      const { playerId } = live;
      let outcome: Outcome | undefined;

      switch (intent.type) {
        case "interact": {
          const target = this.district.byId(intent.payload.targetId);
          if (!target) return this.reject(client, intent.type, "unknown_target");
          if (!this.district.nearest(position, (thing) => thing.id === target.id)) {
            return this.reject(client, intent.type, "too_far");
          }
          const state = await game.players.getState(playerId);
          if (!state) return this.reject(client, intent.type, "not_signed_in");
          const [{ priceFactorBp }, { morale }] = await Promise.all([
            game.events.activeEffects(playerId, now),
            game.players.currentNeeds(state, now),
          ]);
          client.send(SERVER_MESSAGES.interaction, describeOffer(target, game.content, { priceFactorBp, morale }));
          return;
        }
        case "work": {
          const { jobId } = intent.payload;
          const isSite = (thing: Interactable): boolean =>
            thing.kind === "job_site" && thing.jobId === jobId;
          if (!this.district.config.interactables.some(isSite)) {
            return this.reject(client, intent.type, "unknown_target");
          }
          const near = this.district.nearest(position, isSite);
          if (!near) return this.reject(client, intent.type, "too_far");
          outcome = await game.jobs.startShift(playerId, jobId, now);
          break;
        }
        case "buyFood": {
          const { itemId, quantity } = intent.payload;
          const sellsItem = (thing: Interactable): boolean =>
            thing.kind === "food_vendor" && thing.foodIds.includes(itemId);
          if (!this.district.config.interactables.some(sellsItem)) {
            return this.reject(client, intent.type, "unknown_target");
          }
          const near = this.district.nearest(position, sellsItem);
          if (!near) return this.reject(client, intent.type, "too_far");
          outcome = await game.food.buy(playerId, itemId, quantity, now);
          break;
        }
        case "buyItem": {
          const { itemId, quantity } = intent.payload;
          const sellsItem = (thing: Interactable): boolean =>
            thing.kind === "fuel_station" && thing.shopItemIds.includes(itemId);
          if (!this.district.config.interactables.some(sellsItem)) {
            return this.reject(client, intent.type, "unknown_target");
          }
          if (!this.district.nearest(position, sellsItem)) return this.reject(client, intent.type, "too_far");
          outcome = await game.shop.buy(playerId, itemId, quantity, now);
          break;
        }
        case "payRent": {
          if (!this.district.nearest(position, (thing) => thing.kind === "home")) {
            return this.reject(client, intent.type, "too_far");
          }
          outcome = await game.rent.payRent(playerId, now);
          break;
        }
        case "answerEvent": {
          // A phone call: answered from anywhere, no walking needed.
          outcome = await game.choices.answer(playerId, intent.payload.choiceId, intent.payload.answer, now);
          break;
        }
        case "openInbox": {
          const inbox: InboxMessage = { messages: await game.inbox.open(playerId, now) };
          client.send(SERVER_MESSAGES.inbox, inbox);
          outcome = { ok: true };
          break;
        }
        case "setAppearance": {
          const result = await game.appearance.set(playerId, intent.payload, position, this.district);
          if (result.ok) this.showAppearance(client, result.appearance);
          outcome = result;
          break;
        }
        case "move":
          return;
      }

      if (!outcome.ok) this.reject(client, intent.type, outcome.reason);
      await this.sendStats(client, live);
    }

    // ---- ticks -----------------------------------------------------------------

    /** Moves every player by their last direction, at the server's speed, inside the district. */
    private step(deltaMs: number): void {
      const seconds = Math.min(deltaMs / 1000, MAX_STEP_SECONDS);
      for (const [sessionId, live] of this.live) {
        if (live.dx === 0 && live.dz === 0) continue;
        const next = this.district.move(
          { x: live.x, z: live.z },
          {
            x: live.dx * PLAYER_SPEED_UNITS_PER_SECOND * seconds,
            z: live.dz * PLAYER_SPEED_UNITS_PER_SECOND * seconds,
          },
        );
        live.x = next.x;
        live.z = next.z;
        const synced = this.state.players.get(sessionId);
        if (synced) {
          synced.x = next.x;
          synced.z = next.z;
        }
        const client = this.clients.getById(sessionId);
        if (client) this.sendChunks(client, live);
      }
      this.updateViews();
    }

    private checkEventsForEveryone(): void {
      for (const [sessionId, live] of this.live) {
        const client = this.clients.find((candidate) => candidate.sessionId === sessionId);
        if (!client) continue;
        game.mutex
          .run(live.playerId, async () => {
            await this.catchUp(live.playerId);
            await this.sendStats(client, live);
          })
          .catch((error: unknown) => logError("event check failed", error));
      }
    }

    /**
     * Everything time has made due for one player: shift pay, expired requests,
     * random events and late rent fees. Each tells the player itself, through
     * the inbox. Run under the player's mutex.
     */
    private async catchUp(playerId: string): Promise<void> {
      const now = game.clock.now();
      await game.jobs.settleDueShifts(now, playerId);
      await game.choices.expireDue(playerId, now);
      await game.events.processDue(playerId, now);
      await game.rent.chargeLateFees(playerId, now);
    }

    // ---- messages to the client --------------------------------------------------

    private async sendStats(client: Client, live: LivePlayer): Promise<void> {
      const stats = await game.stats.build(live.playerId, game.clock.now());
      if (stats && this.live.get(client.sessionId) === live) {
        client.send(SERVER_MESSAGES.stats, stats);
      }
    }

    private reject(client: Client, intent: string, reason: RejectReason): void {
      client.send(SERVER_MESSAGES.rejected, { intent: intent.slice(0, 32), reason });
    }
  };
}
