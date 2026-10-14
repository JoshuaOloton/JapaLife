import { Room } from "@colyseus/core";
import { MAX_PLAYERS_PER_ROOM } from "@japalife/shared";
import { DistrictState } from "./DistrictState";

export class DistrictRoom extends Room {
  override maxClients = MAX_PLAYERS_PER_ROOM;
  override state = new DistrictState();

  override onCreate(): void {
    this.state.districtId = "lagos-mainland";
  }
}
