import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { DISTRICT_ROOM_NAME } from "@japalife/shared";
import { registerHealthRoute } from "./health";
import { DistrictRoom } from "./rooms/DistrictRoom";

export function createGameServer(): Server {
  const transport = new WebSocketTransport();
  registerHealthRoute(transport.getExpressApp());

  const server = new Server({ transport, greet: false });
  server.define(DISTRICT_ROOM_NAME, DistrictRoom);
  return server;
}
