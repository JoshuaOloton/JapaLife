import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { DISTRICT_ROOM_NAME } from "@japalife/shared";
import type { GameSystems } from "./game";
import { registerHealthRoute } from "./health";
import { createDistrictRoom } from "./rooms/DistrictRoom";

export function createGameServer(game: GameSystems): Server {
  const transport = new WebSocketTransport();
  registerHealthRoute(transport.getExpressApp());

  const server = new Server({ transport, greet: false });
  server.define(DISTRICT_ROOM_NAME, createDistrictRoom(game));
  return server;
}
